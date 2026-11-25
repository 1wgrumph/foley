// Shared run documents (DES-FOL-R14, R15), the spend summary (DES-FOL-R13) and the
// core-proof check. Validators return booleans; untrusted documents never throw.
import { createHash } from "node:crypto";
import { readFile, realpath, rename, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

export const ACTIONS = new Set([
	"click",
	"double_click",
	"drag",
	"move",
	"scroll",
	"type",
	"key_press",
	"wait",
	"screenshot",
]);
export const STATUSES = new Set([
	"no_usable_media",
	"unsupported_device",
	"excluded_sensitive_or_security",
	"eligible_not_attempted",
	"attempted_miss",
	"failure_observed",
	"proof_verified",
]);
const STATES = new Set([
	"empty",
	"running",
	"error",
	"disconnected",
	"finished",
]);

const isObject = (v) =>
	v !== null && typeof v === "object" && !Array.isArray(v);
const isText = (v) => typeof v === "string" && v !== "";
const isCount = (n) => Number.isSafeInteger(n) && n >= 0;
const isTime = (t) => typeof t === "number" && Number.isFinite(t) && t >= 0;
const isScalar = (v) => ["string", "number", "boolean"].includes(typeof v);
const optional = (v, check) => v === undefined || check(v);
const nullable = (v, check) => v === null || check(v);

// A relative path that stays inside the run folder (lexically; files are also
// resolved through symlinks where they are read).
export function insideRun(path) {
	if (!isText(path) || isAbsolute(path) || path.includes("\\")) return false;
	return path
		.split("/")
		.every((part) => part !== "" && part !== "." && part !== "..");
}

function validStep(s, index) {
	return (
		isObject(s) &&
		s.order === index + 1 &&
		isTime(s.t_s) &&
		ACTIONS.has(s.action) &&
		typeof s.target === "string" &&
		optional(s.selector, (v) => typeof v === "string") &&
		optional(s.value, (v) => typeof v === "string")
	);
}

function validPredicate(p) {
	return (
		isObject(p) &&
		isText(p.kind) &&
		optional(p.selector, (v) => typeof v === "string") &&
		isScalar(p.expected) &&
		isScalar(p.observed)
	);
}

export function validateSteps(document) {
	if (!isObject(document) || document.schema !== "foley.steps/1") return false;
	const steps = document.steps;
	if (!Array.isArray(steps) || !steps.every(validStep)) return false;
	const ordered = steps.every((s, i) => i === 0 || steps[i - 1].t_s <= s.t_s);
	return (
		ordered &&
		nullable(document.predicate, validPredicate) &&
		optional(document.mediaPath, (v) => v === "frames" || v === "video")
	);
}

function validReplay(r) {
	const shot = (s) =>
		isObject(s) &&
		insideRun(s.path) &&
		isTime(s.t_s) &&
		typeof s.action === "string";
	const bounded = (limit) => (v) => typeof v === "string" && v.length <= limit;
	// Model explanation text on an executed action (S4x): bounded plain strings.
	const explained = (e) =>
		e.type !== "action" ||
		(optional(e.observation, bounded(1024)) &&
			optional(e.reason, bounded(512)));
	const event = (e) =>
		isObject(e) && isText(e.type) && optional(e.t_s, isTime) && explained(e);
	return (
		isObject(r) &&
		Array.isArray(r.screenshots) &&
		r.screenshots.every(shot) &&
		Array.isArray(r.events) &&
		r.events.every(event)
	);
}

export function validateRun(run) {
	if (!isObject(run) || run.schema !== "foley.run/1") return false;
	const anchor = (a) =>
		isObject(a) &&
		insideRun(a.file) &&
		Number.isSafeInteger(a.line) &&
		a.line >= 1;
	const test = (t) => isObject(t) && insideRun(t.path) && isText(t.verdict);
	return (
		Number.isSafeInteger(run.issue) &&
		run.issue > 0 &&
		isText(run.issue_url) &&
		isText(run.target_revision) &&
		typeof run.fixture === "boolean" &&
		STATES.has(run.state) &&
		nullable(run.recording, insideRun) &&
		Array.isArray(run.steps) &&
		run.steps.every(validStep) &&
		nullable(run.predicate, validPredicate) &&
		Array.isArray(run.anchors) &&
		run.anchors.every(anchor) &&
		validReplay(run.replay) &&
		nullable(run.test, test) &&
		nullable(run.verdict, (v) => STATUSES.has(v)) &&
		isCount(run.cost_micro_usd) &&
		nullable(run.error, (v) => typeof v === "string")
	);
}

const sha256 = (data) => createHash("sha256").update(data).digest("hex");

async function readLines(path) {
	let text;
	try {
		text = await readFile(path, "utf8");
	} catch (error) {
		if (error.code === "ENOENT") return [];
		throw error;
	}
	return text
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line));
}

// Sums event deltas (never running totals) and refuses to write when the trace does
// not reconcile with the ledger. Stage comes from the event, then stage-spend.jsonl;
// unattributed amounts count in the totals only.
export async function writeSpendSummary(outDir) {
	const ledger = JSON.parse(
		await readFile(join(outDir, "ledger.json"), "utf8"),
	);
	const events = await readLines(join(outDir, "trace.jsonl"));
	const attribution = new Map(
		(await readLines(join(outDir, "stage-spend.jsonl"))).map((e) => [
			e.callId,
			e.stage,
		]),
	);
	const sum = (field) => events.reduce((s, e) => s + (e[field] ?? 0), 0);
	const settled = sum("cost_micro_usd");
	const booked = sum("booked_micro_usd");
	const baselines = events.filter((e) => e.type === "baseline");
	const ledgerBooked = ledger.open.reduce((s, o) => s + o.upperBound, 0);
	const reconciles =
		settled === ledger.settled &&
		booked === ledgerBooked &&
		baselines.length === (ledger.baseline === null ? 0 : 1) &&
		(ledger.baseline === null ||
			baselines[0].baseline_micro_usd === ledger.baseline);
	if (!reconciles)
		throw new Error("ledger and trace do not reconcile; summary not written");
	const per_stage = {};
	for (const e of events) {
		const amount = (e.cost_micro_usd ?? 0) + (e.booked_micro_usd ?? 0);
		const stage = e.stage ?? attribution.get(e.callId);
		if (amount && stage) per_stage[stage] = (per_stage[stage] ?? 0) + amount;
	}
	const baseline = ledger.baseline ?? 0;
	const summary = {
		baseline,
		settled,
		booked,
		total: baseline + settled + booked,
		per_stage,
	};
	const path = join(outDir, "spend-summary.json");
	await writeFile(`${path}.tmp`, `${JSON.stringify(summary, null, 2)}\n`);
	await rename(`${path}.tmp`, path);
	return summary;
}

const MANIFEST_FILES = new Set(["core-proof.json", "artifact-trace.jsonl"]);

// ok only when every artifact exists inside the run folder (after symlinks), matches
// its manifest digest and has a matching artifact-trace event.
export async function checkCoreProof(runDir) {
	let proof;
	let traced;
	try {
		proof = JSON.parse(await readFile(join(runDir, "core-proof.json"), "utf8"));
		traced = new Map(
			(await readLines(join(runDir, "artifact-trace.jsonl")))
				.filter((e) => e.type === "artifact")
				.map((e) => [e.path, e.sha256]),
		);
	} catch {
		return { status: "invalid" };
	}
	const entries = isObject(proof?.artifacts)
		? Object.entries(proof.artifacts)
		: [];
	if (proof?.schema !== "foley.core-proof/1" || entries.length === 0)
		return { status: "invalid" };
	const root = await realpath(runDir);
	for (const [path, digest] of entries) {
		if (
			!insideRun(path) ||
			MANIFEST_FILES.has(path) ||
			traced.get(path) !== digest
		)
			return { status: "digest_mismatch" };
		try {
			const real = await realpath(join(runDir, path));
			const rel = relative(root, real);
			if (rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel))
				return { status: "digest_mismatch" };
			if (sha256(await readFile(real)) !== digest)
				return { status: "digest_mismatch" };
		} catch {
			return { status: "digest_mismatch" };
		}
	}
	return { status: "ok" };
}

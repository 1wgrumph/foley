// Shared run documents (DES-FOL-R14, R15), the spend summary (DES-FOL-R13) and the
// core-proof check. Validators return booleans; untrusted documents never throw.
import { createHash } from "node:crypto";
import { readFile, realpath, rename, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { hasCredentialShape } from "./text-safety.mjs";

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
	"pointer_click",
	"pointer_double_click",
	"pointer_move",
	"pointer_drag",
]);
// The reproduction browser's fixed viewport (CSS pixels, device scale factor 1).
// Pointer actions name integer pixels of it: 0 <= x < width, 0 <= y < height.
export const VIEWPORT = { width: 1280, height: 720 };
const POINTS = {
	pointer_click: ["x", "y"],
	pointer_double_click: ["x", "y"],
	pointer_move: ["x", "y"],
	pointer_drag: ["x", "y", "to_x", "to_y"],
};
const inside = (n, limit) => Number.isSafeInteger(n) && n >= 0 && n < limit;
// Whether a pointer action's coordinates are integers inside the viewport;
// true for an action that is not a pointer action.
export function validPointer(a) {
	return (POINTS[a.action] ?? []).every((field) =>
		inside(a[field], field.endsWith("y") ? VIEWPORT.height : VIEWPORT.width),
	);
}
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

export function validStep(s, index) {
	return (
		isObject(s) &&
		s.order === index + 1 &&
		isTime(s.t_s) &&
		ACTIONS.has(s.action) &&
		typeof s.target === "string" &&
		validPointer(s) &&
		optional(s.selector, (v) => typeof v === "string") &&
		optional(s.value, (v) => typeof v === "string")
	);
}

const TEXT_LIMIT = 1024;
const isBounded = (v) => typeof v === "string" && v.length <= TEXT_LIMIT;
const isSelector = (v) => isText(v) && isBounded(v);
const isJsonScalar = (v) =>
	v === null ||
	isBounded(v) ||
	typeof v === "boolean" ||
	(typeof v === "number" && Number.isFinite(v));

// Predicate kinds with an independent page check (DES-FOL-R06, src/predicate.mjs).
// Each kind names its own fields; expected and observed must differ.
const PREDICATES = {
	visible_text: (p) =>
		isSelector(p.selector) &&
		isBounded(p.expected) &&
		isBounded(p.observed) &&
		p.expected.trim() !== p.observed.trim(),
	element_count: (p) =>
		isSelector(p.selector) && isCount(p.expected) && isCount(p.observed),
	console_error: (p) =>
		isSelector(p.message) &&
		typeof p.expected === "boolean" &&
		typeof p.observed === "boolean",
	canvas_state: (p) =>
		(p.source === "elements" || p.source === "appState") &&
		Array.isArray(p.path) &&
		p.path.length <= 32 &&
		p.path.every((key) => isSelector(key) || isCount(key)) &&
		isJsonScalar(p.expected) &&
		isJsonScalar(p.observed),
};

export function validPredicate(p) {
	return (
		isObject(p) &&
		Object.hasOwn(PREDICATES, p.kind) &&
		PREDICATES[p.kind](p) &&
		p.expected !== p.observed
	);
}

// Watch's uncertainty and narration-only facts (DES-FOL-R04): timestamped plain
// text, kept as data through steps, run, comment and replay.
const validEvidence = (list) =>
	Array.isArray(list) &&
	list.length <= 40 &&
	list.every(
		(e) =>
			isObject(e) &&
			typeof e.t_s === "number" &&
			Number.isFinite(e.t_s) &&
			e.t_s >= 0 &&
			e.t_s <= 120 &&
			isText(e.text) &&
			isBounded(e.text) &&
			!hasCredentialShape(e.text),
	);
const evidenceFields = (d) =>
	optional(d.uncertainty, validEvidence) &&
	optional(d.narration_evidence, validEvidence);

export function validateSteps(document) {
	if (!isObject(document) || document.schema !== "foley.steps/1") return false;
	const steps = document.steps;
	if (!Array.isArray(steps) || !steps.every(validStep)) return false;
	const ordered = steps.every((s, i) => i === 0 || steps[i - 1].t_s <= s.t_s);
	return (
		ordered &&
		nullable(document.predicate, validPredicate) &&
		evidenceFields(document) &&
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
		evidenceFields(run) &&
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
const readJsonFile = async (path) => JSON.parse(await readFile(path, "utf8"));

/**
 * The complete artifact inventory of a run folder: what each recorded stage
 * must have left, plus the report, run document and static page. Shared by the
 * pipeline's finalization and checkCoreProof.
 */
export function requiredArtifacts(run, stages, replay) {
	const has = (name) => Object.hasOwn(stages ?? {}, name);
	return [
		...new Set(
			[
				run?.recording,
				stages?.watch === "ok" && "steps.json",
				has("locate") && "anchors.json",
				has("repro") && "replay.json",
				...(has("repro")
					? (replay?.screenshots ?? []).map((s) => s?.path)
					: []),
				has("prove") && "proof.json",
				run?.test?.path,
				"comment.md",
				"run.json",
				"replay.html",
			].filter(Boolean),
		),
	].sort();
}

const exitOf = (result) => result?.exitCode;

// A verified proof: every stage passed, the browser observed the failure, and the
// accepted test failed on the bug build and passed on the fixed build when run.
function verifiedSemantics(manifest, run, replay, proof) {
	const st = manifest.stages ?? {};
	const rerun = proof?.rerun_without_ember;
	const bug = exitOf(rerun?.bug);
	const fixed = exitOf(rerun?.fixed);
	return (
		st.watch === "ok" &&
		["ok", "miss"].includes(st.locate) &&
		st.repro === "reproduced" &&
		st.prove === "verified" &&
		st.report === "ok" &&
		validateRun(run) &&
		isObject(run.predicate) &&
		// A run document that records its own stages must agree with the manifest.
		(run.stages === undefined ||
			JSON.stringify(run.stages) === JSON.stringify(st)) &&
		run.state === "finished" &&
		run.verdict === "proof_verified" &&
		run.test?.verdict === "verified" &&
		replay?.observed === true &&
		proof?.status === "verified" &&
		proof.path === run.test.path &&
		Number.isSafeInteger(bug) &&
		bug !== 0 &&
		(fixed === undefined || fixed === null || fixed === 0)
	);
}

async function sameDigest(root, runDir, path, digest) {
	try {
		const real = await realpath(join(runDir, path));
		const rel = relative(root, real);
		if (rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel))
			return false;
		return sha256(await readFile(real)) === digest;
	} catch {
		return false;
	}
}

/**
 * ok only for a complete verified proof: the manifest lists exactly the required
 * inventory, the trace covers exactly that inventory once, every file inside the
 * run folder (after symlinks) matches its digest, the run document's identity
 * matches the manifest, and the stage, predicate and runner results verify.
 * digest_mismatch: a listed file is missing or changed. incomplete: the inventory
 * or trace is not exact. not_verified: consistent record of a non-proof outcome.
 */
export async function checkCoreProof(runDir) {
	let proof;
	let events;
	try {
		proof = await readJsonFile(join(runDir, "core-proof.json"));
		events = (await readLines(join(runDir, "artifact-trace.jsonl"))).filter(
			(e) => e?.type === "artifact",
		);
	} catch {
		return { status: "invalid" };
	}
	const entries = isObject(proof?.artifacts)
		? Object.entries(proof.artifacts)
		: [];
	if (proof?.schema !== "foley.core-proof/1" || entries.length === 0)
		return { status: "invalid" };
	// A pair run binds its bug and fix commits in both the run and the manifest.
	let runDoc;
	try {
		runDoc = JSON.parse(await readFile(join(runDir, "run.json"), "utf8"));
	} catch {
		return { status: "invalid" };
	}
	if (
		JSON.stringify(proof.pair ?? null) !== JSON.stringify(runDoc?.pair ?? null)
	)
		return { status: "invalid" };
	const root = await realpath(runDir);
	const traced = new Map(events.map((e) => [e.path, e.sha256]));
	for (const [path, digest] of entries) {
		if (!insideRun(path) || MANIFEST_FILES.has(path))
			return { status: "digest_mismatch" };
		if (!(await sameDigest(root, runDir, path, digest)))
			return { status: "digest_mismatch" };
	}
	const optionalJson = (name) =>
		readJsonFile(join(runDir, name)).catch(() => null);
	const [run, replay, report] = await Promise.all(
		["run.json", "replay.json", "proof.json"].map(optionalJson),
	);
	const listed = entries.map(([path]) => path).sort();
	const required = requiredArtifacts(run, proof.stages, replay);
	const exact =
		events.length === traced.size &&
		traced.size === listed.length &&
		entries.every(([path, digest]) => traced.get(path) === digest) &&
		JSON.stringify(listed) === JSON.stringify(required);
	if (!exact) return { status: "incomplete" };
	const identity =
		run?.issue_url === proof.issue_url &&
		run?.target_revision === proof.target_revision &&
		run?.fixture === proof.fixture;
	if (!identity || !verifiedSemantics(proof, run, replay, report))
		return { status: "not_verified" };
	return { status: "ok", fixture: proof.fixture === true };
}

// The integrated pipeline (DES-FOL-R15): watch, locate, repro, prove and report
// for one issue, every artifact in out/runs/<issue>/. The same stage functions
// serve `foley run` and the backlog. Model calls go only through callEmber; each
// call is attributed to its stage in out/stage-spend.jsonl.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import {
	appendFile,
	copyFile,
	mkdir,
	readFile,
	rename,
	writeFile,
} from "node:fs/promises";
import { extname, isAbsolute, join, relative } from "node:path";
import { renderReplay } from "../ui/render.mjs";
import { callEmber } from "./ember.mjs";
import { locate } from "./locate.mjs";
import { prove } from "./prove.mjs";
import { report } from "./report.mjs";
import { repro } from "./repro.mjs";
import { validateRun } from "./run-schema.mjs";
import { watch } from "./watch.mjs";

export const STAGES = ["watch", "locate", "repro", "prove", "report"];
const BOUNDS = new URL("../fixtures/ember/bounds.json", import.meta.url);
const UI_PAGE = new URL("../ui/dist/replay.html", import.meta.url);
const TOOLS = ["git", "ffmpeg", "ffprobe", "cargo", "unshare", "flock"];
const RUNNERS = new Set(["node-test", "vitest"]);
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
const USAGE = [
	"input_tokens",
	"cached_input_tokens",
	"output_tokens",
	"reasoning_tokens",
	"cost_micro_usd",
	"booked_micro_usd",
];

/** A refused prerequisite or argument: the CLI prints it and exits 2. */
export class Refusal extends Error {
	constructor(code, message) {
		super(`${code}: ${message}`);
		this.code = code;
	}
}

const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const out = () => join(process.cwd(), "out");

async function writeJsonAtomic(path, value) {
	const temp = `${path}.${process.pid}.tmp`;
	await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`);
	await rename(temp, path);
}

async function readLines(path) {
	try {
		return (await readFile(path, "utf8"))
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line));
	} catch (error) {
		if (error.code === "ENOENT") return [];
		throw error;
	}
}

/** Resolves a command-line path; it must exist inside the working directory. */
export function insideCwd(path, name) {
	let real;
	try {
		real = realpathSync(path);
	} catch {
		throw new Refusal("missing_path", `${name} does not exist: ${path}`);
	}
	const rel = relative(realpathSync(process.cwd()), real);
	if (rel === ".." || rel.startsWith("../") || isAbsolute(rel))
		throw new Refusal(
			"outside_working_tree",
			`${name} is outside the working directory`,
		);
	return real;
}

const git = (dir, ...args) =>
	execFileSync("git", ["-C", dir, ...args], {
		encoding: "utf8",
		env: { PATH: process.env.PATH, HOME: process.env.HOME },
		stdio: ["ignore", "pipe", "ignore"],
		timeout: 30_000,
	}).trim();

function pinned(targetDir, revision, name) {
	try {
		const commit = git(
			targetDir,
			"rev-parse",
			"--verify",
			"--end-of-options",
			`${revision}^{commit}`,
		);
		if (git(targetDir, "rev-parse", "--verify", "HEAD") === commit) return;
	} catch {}
	throw new Refusal(
		"target_not_pinned",
		`${name} HEAD is not the pinned revision ${revision}`,
	);
}

// Only presence is checked: a spawn error means the tool is absent.
function tool(name) {
	const { error } = spawnSync(name, ["--version"], {
		stdio: "ignore",
		env: { PATH: process.env.PATH },
		timeout: 10_000,
	});
	if (error?.code === "ENOENT")
		throw new Refusal("tool_absent", `${name} is not available on PATH`);
}

/**
 * Every check that needs no model call. Returns normalised options; throws a
 * Refusal naming the first missing prerequisite.
 */
export function preflight(options) {
	const o = { ...options };
	if (!Number.isSafeInteger(o.issue) || o.issue <= 0)
		throw new Refusal("bad_argument", "issue must be a positive integer");
	if (!Number.isSafeInteger(o.caseBudget) || o.caseBudget <= 0)
		throw new Refusal(
			"bad_argument",
			"--case-budget must be a positive integer of micro-dollars",
		);
	if (!RUNNERS.has(o.runner))
		throw new Refusal("bad_argument", "--runner must be node-test or vitest");
	let origin;
	try {
		origin = new URL(o.appOrigin);
	} catch {
		throw new Refusal("bad_argument", "--app-origin must be a URL");
	}
	if (origin.protocol !== "http:" || !LOOPBACK.has(origin.hostname))
		throw new Refusal(
			"bad_argument",
			"--app-origin must be a loopback http origin",
		);
	o.appOrigin = origin.origin;
	for (const name of TOOLS) tool(name);
	if (!existsSync(UI_PAGE))
		throw new Refusal("ui_not_built", "run `npm run build:ui` first");
	const ledger = join(out(), "ledger.json");
	let baseline = null;
	try {
		baseline = JSON.parse(readFileSync(ledger, "utf8")).baseline;
	} catch {}
	if (!Number.isSafeInteger(baseline))
		throw new Refusal(
			"baseline_unset",
			"record the spend baseline with `foley baseline <micro-usd>`",
		);
	if (o.recording) o.recording = insideCwd(o.recording, "--recording");
	o.target = insideCwd(o.target, "--target");
	if (o.fixedTarget) o.fixedTarget = insideCwd(o.fixedTarget, "--fixed-target");
	if (typeof o.revision !== "string" || !/^[0-9a-f]{7,64}$/.test(o.revision))
		throw new Refusal("bad_argument", "--revision must be a commit id");
	pinned(o.target, o.revision, "--target");
	// Measured bounds win over a supplied probe once the live probe has run.
	o.probe = undefined;
	if (!existsSync(BOUNDS) && options.probe) {
		const path = insideCwd(options.probe, "--probe");
		try {
			o.probe = JSON.parse(readFileSync(path, "utf8"));
		} catch {
			throw new Refusal("bad_argument", "--probe is not JSON");
		}
	}
	return o;
}

/**
 * One foley run at a time per out/ folder, for the whole pipeline. The kernel
 * holds an flock(2) on out/foley-run.lock through a child process that lives
 * only while this process keeps its stdin open: a crash or kill of this process
 * closes the pipe and releases the lock, and only this process can release it
 * earlier. Any failure to take the lock refuses the run (fail closed).
 */
export async function lockRun() {
	await mkdir(out(), { recursive: true });
	const path = join(out(), "foley-run.lock");
	const holder = spawn(
		"flock",
		[
			"--exclusive",
			"--nonblock",
			"--conflict-exit-code",
			"75",
			path,
			"sh",
			"-c",
			"echo locked; exec cat",
		],
		{ stdio: ["pipe", "pipe", "ignore"], env: { PATH: process.env.PATH } },
	);
	const exited = new Promise((resolve) =>
		holder.once("close", (code) => resolve(code)),
	);
	holder.once("error", () => {}); // a spawn failure also closes: refused below
	const locked = await Promise.race([
		new Promise((resolve) =>
			holder.stdout.once("data", (chunk) =>
				resolve(String(chunk).startsWith("locked")),
			),
		),
		exited.then(() => false),
	]);
	if (!locked) {
		holder.kill("SIGKILL");
		const code = await exited;
		throw new Refusal(
			"run_active",
			code === 75
				? `another foley run holds ${path}`
				: `could not lock ${path}; is flock installed?`,
		);
	}
	holder.stdout.resume();
	return async () => {
		holder.stdin.end();
		await exited;
	};
}

function emptyRun(o) {
	return {
		schema: "foley.run/1",
		issue: o.issue,
		issue_url: o.issueUrl,
		target_revision: o.revision,
		fixture: Boolean(o.fixture),
		state: "running",
		recording: null,
		steps: [],
		predicate: null,
		anchors: [],
		replay: { screenshots: [], events: [] },
		test: null,
		verdict: null,
		cost_micro_usd: 0,
		case_budget_micro_usd: o.caseBudget,
		error: null,
		stages: {},
		model_calls: [],
	};
}

async function traceArtifacts(runDir, stage, paths) {
	const lines = [];
	for (const path of paths) {
		const digest = sha256(await readFile(join(runDir, path)));
		lines.push(
			JSON.stringify({ type: "artifact", stage, path, sha256: digest }),
		);
	}
	if (lines.length)
		await appendFile(
			join(runDir, "artifact-trace.jsonl"),
			`${lines.join("\n")}\n`,
		);
}

// Sums the usage fields of the trace events one call added.
function usageSum(call, events) {
	for (const event of events)
		for (const field of USAGE)
			if (Number.isSafeInteger(event[field]))
				call[field] = (call[field] ?? 0) + event[field];
	return call;
}

// Attributes every trace request event a call adds; runs are serial (lockRun).
async function attributedCall(ctx, stage, args) {
	const trace = join(out(), "trace.jsonl");
	const before = (await readLines(trace)).length;
	const reply = await callEmber(args);
	const added = (await readLines(trace))
		.slice(before)
		.filter((e) => e.type === "request" && e.callId);
	const callIds = added.map((e) => e.callId);
	const call = usageSum({ stage, status: reply.status, callIds }, added);
	if (added.length)
		await appendFile(
			join(out(), "stage-spend.jsonl"),
			callIds
				.map((callId) => `${JSON.stringify({ callId, stage })}\n`)
				.join(""),
		);
	if (stage === "repro" && typeof reply.output?.verdict === "string")
		call.verdict = reply.output.verdict;
	ctx.run.model_calls.push(call);
	ctx.run.cost_micro_usd += call.cost_micro_usd ?? 0;
	await ctx.publish();
	return reply;
}

/**
 * The per-issue context shared by the stages. A run.json left by an earlier
 * interrupted run is reloaded, so the backlog resumes from the run folder.
 */
export async function openRun(o) {
	const runDir = join(out(), "runs", String(o.issue));
	await mkdir(runDir, { recursive: true });
	let run = emptyRun(o);
	try {
		const saved = JSON.parse(await readFile(join(runDir, "run.json"), "utf8"));
		if (validateRun(saved) && saved.issue === o.issue) run = saved;
	} catch {}
	run.state = "running";
	const ctx = { o, runDir, run, caseId: `issue-${o.issue}` };
	const elapsed = run.elapsed_ms ?? 0;
	const opened = Date.now();
	ctx.publish = async () => {
		run.elapsed_ms = elapsed + Date.now() - opened;
		await writeJsonAtomic(join(runDir, "run.json"), run);
	};
	ctx.artifacts = (stage, paths) => traceArtifacts(runDir, stage, paths);
	ctx.ember = (stage) => (args) => attributedCall(ctx, stage, args);
	await ctx.publish();
	return ctx;
}

const usageOf = (call) =>
	Object.fromEntries(USAGE.filter((f) => f in call).map((f) => [f, call[f]]));

function callEvent(call, t_s) {
	return {
		type: "model_call",
		detail: `Ember ${call.stage} call: ${call.status}`,
		...(call.verdict && { reason: `model verdict: ${call.verdict}` }),
		...(t_s !== undefined && { t_s }),
		...usageOf(call),
	};
}

// Each repro model turn starts with an "observe" screenshot, so turn k matches
// observe shot k. Its usage goes on the first action it produced (that step's
// cost) and its status and verdict on a model_call event in the feed.
function reproEvents(replay, calls) {
	const turns = replay.screenshots.filter((s) => s.action === "observe");
	const events = replay.events.map((e) => ({ ...e }));
	const merged = [];
	let k = 0;
	const flush = (until) => {
		for (; k < calls.length && (turns[k]?.t_s ?? 0) <= until; k++) {
			const at = turns[k]?.t_s;
			const next = turns[k + 1]?.t_s ?? Number.POSITIVE_INFINITY;
			const step = events.find(
				(e) => e.type === "action" && e.t_s >= at && e.t_s < next,
			);
			const { stage, status, verdict } = calls[k];
			if (step) Object.assign(step, usageOf(calls[k]));
			merged.push(callEvent(step ? { stage, status, verdict } : calls[k], at));
		}
	};
	for (const event of events) {
		flush(event.t_s ?? 0);
		merged.push(event);
	}
	flush(Number.POSITIVE_INFINITY);
	return merged;
}

function rebuildEvents(ctx, replay) {
	const { run } = ctx;
	const of = (stage) => run.model_calls.filter((c) => c.stage === stage);
	run.replay = {
		// Executed-action frames only: the static page opens on the last one, and
		// observe and check captures stay listed in replay.json.
		screenshots: replay
			? replay.screenshots.filter(
					(s) => !["observe", "check"].includes(s.action),
				)
			: run.replay.screenshots,
		events: [
			...of("watch").map((c) => callEvent(c)),
			...(replay
				? reproEvents(replay, of("repro").slice(run.repro_calls_from ?? 0))
				: []),
			...of("prove").map((c) => callEvent(c)),
		],
	};
}

const stageCost = (ctx, stage, from) =>
	ctx.run.model_calls
		.slice(from)
		.filter((c) => c.stage === stage)
		.reduce((sum, c) => sum + (c.cost_micro_usd ?? 0), 0);

async function readJson(path) {
	return JSON.parse(await readFile(path, "utf8"));
}

/** Writes the draft report, final run document, static page and core proof. */
async function finish(ctx, verdict) {
	const { run, runDir } = ctx;
	run.verdict = verdict;
	run.state = "finished";
	run.error = null;
	run.stages.report = "ok";
	await report(run, { runDir });
	await ctx.publish();
	await renderReplay(runDir);
	await ctx.artifacts("report", ["comment.md", "run.json", "replay.html"]);
	const traced = new Map(
		(await readLines(join(runDir, "artifact-trace.jsonl"))).map((e) => [
			e.path,
			e.sha256,
		]),
	);
	let rerun = null;
	try {
		rerun =
			(await readJson(join(runDir, "proof.json"))).rerun_without_ember ?? null;
	} catch {}
	await writeJsonAtomic(join(runDir, "core-proof.json"), {
		schema: "foley.core-proof/1",
		issue_url: run.issue_url,
		target_revision: run.target_revision,
		fixture: run.fixture,
		stages: run.stages,
		rerun_without_ember: rerun,
		unedited: true,
		artifacts: Object.fromEntries(traced),
	});
}

/** Stage functions over the run folder; each returns {status, cost_micro_usd}. */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: one table of the five short stage functions sharing the run context
export function stages(ctx) {
	const { o, runDir, run } = ctx;
	const done = async (name, status, from, verdict) => {
		run.stages[name] = status;
		const cost = stageCost(ctx, name, from);
		if (verdict) await finish(ctx, verdict);
		else await ctx.publish();
		return { status, cost_micro_usd: cost };
	};
	return {
		async watch() {
			const from = run.model_calls.length;
			const name = `recording${extname(o.recording).toLowerCase()}`;
			await copyFile(o.recording, join(runDir, name));
			run.recording = name;
			await ctx.artifacts("watch", [name]);
			const result = await watch(join(runDir, name), {
				runDir,
				callEmber: ctx.ember("watch"),
				probe: o.probe,
				caseId: ctx.caseId,
				caseBudget: o.caseBudget,
			});
			rebuildEvents(ctx);
			if (result.status !== "ok")
				return done("watch", result.status, from, "attempted_miss");
			run.steps = result.document.steps;
			run.predicate = result.document.predicate;
			await ctx.artifacts("watch", ["steps.json"]);
			return done("watch", "ok", from);
		},
		async locate() {
			const result = await locate(join(runDir, "steps.json"), {
				targetDir: o.target,
				targetRevision: o.revision,
				runDir,
			});
			run.anchors = result.anchors;
			await ctx.artifacts("locate", ["anchors.json"]);
			return done("locate", result.status, run.model_calls.length);
		},
		async repro() {
			const from = run.model_calls.length;
			run.repro_calls_from = run.model_calls.filter(
				(c) => c.stage === "repro",
			).length;
			const replay = await repro(run.steps, run.predicate, o.appOrigin, {
				runDir,
				caseId: ctx.caseId,
				caseBudget: o.caseBudget,
				callEmber: ctx.ember("repro"),
			});
			rebuildEvents(ctx, replay);
			await ctx.artifacts("repro", [
				"replay.json",
				...replay.screenshots.map((s) => s.path),
			]);
			return done(
				"repro",
				replay.status,
				from,
				replay.status === "reproduced" ? null : "attempted_miss",
			);
		},
		async prove() {
			const from = run.model_calls.length;
			const result = await prove(run.steps, run.anchors, run.predicate, {
				runDir,
				targetDir: o.target,
				fixedTargetDir: o.fixedTarget,
				runner: o.runner,
				callEmber: ctx.ember("prove"),
				caseId: ctx.caseId,
				caseBudget: o.caseBudget,
			});
			const replay = await readJson(join(runDir, "replay.json"));
			rebuildEvents(ctx, replay);
			if (result.status === "verified")
				run.test = { path: result.path, verdict: "verified" };
			await ctx.artifacts("prove", [
				"proof.json",
				...(result.path ? [result.path] : []),
			]);
			return done("prove", result.status, from);
		},
		async report() {
			const verified = run.stages.prove === "verified";
			await finish(ctx, verified ? "proof_verified" : "failure_observed");
			return { status: "ok", cost_micro_usd: 0 };
		},
	};
}

/**
 * Runs the stages for one issue and returns the run document. Stages finished
 * by an interrupted earlier run are not repeated; a finished run is returned
 * unchanged (a second run changes nothing).
 */
export async function runIssue(o, { beforeStages = async () => {} } = {}) {
	const runDir = join(out(), "runs", String(o.issue));
	try {
		const saved = JSON.parse(await readFile(join(runDir, "run.json"), "utf8"));
		if (saved.state === "finished" && validateRun(saved)) return saved;
	} catch {}
	const ctx = await openRun(o);
	const steps = stages(ctx);
	await beforeStages(ctx.runDir);
	try {
		for (const name of STAGES) {
			if (ctx.run.state === "finished") break;
			if (!(name in ctx.run.stages)) await steps[name]();
		}
	} catch (error) {
		ctx.run.state = "error";
		ctx.run.error = String(error?.message ?? error).split("\n")[0];
		await ctx.publish();
		throw error;
	}
	return ctx.run;
}

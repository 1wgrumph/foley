// The integrated pipeline (DES-FOL-R15): watch, locate, repro, prove and report
// for one issue, every artifact in out/runs/<issue>/. The same stage functions
// serve `foley run` and the backlog, both through the one stage journal in
// src/backlog.mjs. Model calls go only through callEmber; each call record in the
// Ember trace carries its case and stage, and all spend shown here is rebuilt
// from those records.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	createReadStream,
	existsSync,
	readFileSync,
	realpathSync,
} from "node:fs";
import {
	appendFile,
	copyFile,
	mkdir,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { renderReplay } from "../ui/render.mjs";
import { runOne } from "./backlog.mjs";
import { callEmber } from "./ember.mjs";
import { locate } from "./locate.mjs";
import { prove, RUNNERS, serveBuild } from "./prove.mjs";
import { report } from "./report.mjs";
import { repro } from "./repro.mjs";
import {
	checkCoreProof,
	requiredArtifacts,
	validateRun,
	verdictAfterProve,
} from "./run-schema.mjs";
import { inspect, watch } from "./watch.mjs";

export const STAGES = ["watch", "locate", "repro", "prove", "report"];
const BOUNDS = new URL("../fixtures/ember/bounds.json", import.meta.url);
const UI_PAGE = new URL("../ui/dist/replay.html", import.meta.url);
const TOOLS = ["git", "ffmpeg", "ffprobe", "cargo", "unshare", "flock"];
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
		if (git(targetDir, "rev-parse", "--verify", "HEAD") === commit) {
			clean(targetDir, name);
			return;
		}
	} catch (error) {
		if (error instanceof Refusal) throw error;
	}
	throw new Refusal(
		"target_not_pinned",
		`${name} HEAD is not the pinned revision ${revision}`,
	);
}

// Tracked files must equal the commit; fsmonitor hooks of the target never run.
function clean(dir, name) {
	let dirty = "?";
	try {
		dirty = git(
			dir,
			"-c",
			"core.fsmonitor=false",
			"status",
			"--porcelain",
			"--untracked-files=no",
		);
	} catch {}
	if (dirty)
		throw new Refusal(
			"target_not_pinned",
			`${name} has tracked changes or is not a Git work tree`,
		);
}

const streamDigest = (path) =>
	new Promise((resolve, reject) => {
		const hash = createHash("sha256");
		createReadStream(path)
			.on("error", reject)
			.on("data", (chunk) => hash.update(chunk))
			.on("end", () => resolve(hash.digest("hex")));
	});

/**
 * Type, size, duration and content are checked (no full read) before the
 * recording is copied or hashed. Returns its SHA-256, read as a stream.
 */
export async function checkRecording(path) {
	if (!(await inspect(path)))
		throw new Refusal(
			"refused_input",
			"recording type, size, duration or content refused",
		);
	return streamDigest(path);
}

/** The inputs a run is bound to; a resume with any other value is refused. */
export const identityOf = (o) => ({
	target_revision: o.revision,
	recording_sha256: o.recordingSha256,
	runner: o.runner,
	fixture: Boolean(o.fixture),
	...(o.pair && { pair: o.pair }),
});

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

function loopbackOrigin(text) {
	let origin;
	try {
		origin = new URL(text);
	} catch {
		throw new Refusal("bad_argument", "--app-origin must be a URL");
	}
	if (origin.protocol !== "http:" || !LOOPBACK.has(origin.hostname))
		throw new Refusal(
			"bad_argument",
			"--app-origin must be a loopback http origin",
		);
	return origin.origin;
}

/**
 * Every check that needs no model call. Returns normalised options; throws a
 * Refusal naming the first missing prerequisite.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: a flat list of independent prerequisite checks, each refusing before any model call
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: same flat list of checks
export function preflight(options) {
	const o = { ...options };
	if (!Number.isSafeInteger(o.issue) || o.issue <= 0)
		throw new Refusal("bad_argument", "issue must be a positive integer");
	if (!Number.isSafeInteger(o.caseBudget) || o.caseBudget <= 0)
		throw new Refusal(
			"bad_argument",
			"--case-budget must be a positive integer of micro-dollars",
		);
	if (!Object.hasOwn(RUNNERS, o.runner ?? ""))
		throw new Refusal(
			"unsupported_runner",
			`--runner must be one of ${Object.keys(RUNNERS).join(", ")}`,
		);
	// A pair run serves its own bug page; the origin is set when it starts.
	if (!o.pair) o.appOrigin = loopbackOrigin(o.appOrigin);
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
	if (o.fixedTarget) {
		o.fixedTarget = insideCwd(o.fixedTarget, "--fixed-target");
		clean(o.fixedTarget, "--fixed-target");
	}
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

const PAIRS = "fixtures/pairs/pairs.json";
const SHA1 = /^[0-9a-f]{40}$/;
const PAIR_MEMORY_MIB = 1024;
const SHA256 = /^[0-9a-f]{64}$/;

function readPairJson(path, missing) {
	let text;
	try {
		text = readFileSync(path, "utf8");
	} catch {
		throw new Refusal(missing, `${path} is missing`);
	}
	try {
		return JSON.parse(text);
	} catch {
		throw new Refusal("pair_invalid", `${path} is not JSON`);
	}
}

// A real path inside `root` (after symlinks), or a refusal: absent is
// pair_build_missing, outside is pair_invalid.
function within(root, path, name) {
	let real;
	try {
		real = realpathSync(path);
	} catch {
		throw new Refusal("pair_build_missing", `${name} is missing`);
	}
	const rel = relative(root, real);
	if (rel === ".." || rel.startsWith("../") || isAbsolute(rel))
		throw new Refusal("pair_invalid", `${name} is outside the pair folder`);
	return real;
}

// The issue URL is shown and linked, never fetched.
const httpsUrl = (text) => {
	try {
		return text.length <= 2048 && new URL(text).protocol === "https:";
	} catch {
		return false;
	}
};

const headOf = (dir) => {
	try {
		return git(dir, "rev-parse", "--verify", "HEAD");
	} catch {
		return null;
	}
};

// One side of a pair: its single receipt build, its checkout at the manifest
// commit with no tracked changes, and its built page inside that checkout.
function pairSide({ folder, root, builds, side, commit }) {
	const build = builds.filter((b) => b?.side === side);
	if (
		build.length !== 1 ||
		typeof build[0].page !== "string" ||
		!SHA1.test(build[0].commit ?? "")
	)
		throw new Refusal(
			"pair_invalid",
			`receipt has no single valid ${side} build`,
		);
	if (build[0].commit !== commit)
		throw new Refusal(
			"pair_commit_mismatch",
			`receipt ${side} commit differs from the manifest`,
		);
	const checkout = within(folder, join(root, side), `${side} checkout`);
	if (headOf(checkout) !== commit)
		throw new Refusal(
			"pair_commit_mismatch",
			`${side} checkout is not at ${commit}`,
		);
	clean(checkout, `${side} checkout`);
	const page = within(checkout, resolve(build[0].page), `${side} page`);
	if (!existsSync(join(page, "index.html")))
		throw new Refusal("pair_build_missing", `${side} page has no index.html`);
	return { checkout, page };
}

/**
 * Resolves `foley run --pair <issue>` from fixtures/pairs/pairs.json and the
 * pair's build receipt under out/pairs/<issue>/. Pair fields are data: commits
 * and digests are checked by pattern, paths must stay inside the pair folder,
 * and nothing is fetched or built. Returns the run options a pair fixes.
 */
export function pairOptions(issue) {
	if (!Number.isSafeInteger(issue) || issue <= 0)
		throw new Refusal("bad_argument", "--pair must be a positive integer");
	const manifest = readPairJson(PAIRS, "pair_missing");
	if (manifest?.schema !== "foley.pairs/1" || !Array.isArray(manifest.pairs))
		throw new Refusal("pair_invalid", `${PAIRS} is not foley.pairs/1`);
	const pair = manifest.pairs.find((p) => p?.issue === issue);
	if (!pair) throw new Refusal("pair_missing", `issue ${issue} is not a pair`);
	const runner = pair.runner ?? "vitest";
	const memory = pair.memory_mib;
	// Test-API calls that set state directly; prove refuses a test that uses one.
	const refused = manifest.refused_test_calls ?? [];
	const valid =
		Array.isArray(refused) &&
		refused.length <= 32 &&
		refused.every((c) => typeof c === "string" && c !== "" && c.length <= 64) &&
		httpsUrl(pair.url) &&
		SHA1.test(pair.bug_commit ?? "") &&
		SHA1.test(pair.fix_commit ?? "") &&
		SHA256.test(pair.recording?.sha256 ?? "") &&
		Object.hasOwn(RUNNERS, runner) &&
		(memory === undefined ||
			(Number.isSafeInteger(memory) && memory >= 256 && memory <= 8192));
	if (!valid) throw new Refusal("pair_invalid", `pair ${issue} is malformed`);
	const root = join(out(), "pairs", String(issue));
	if (!existsSync(root))
		throw new Refusal("pair_build_missing", `${root} is missing`);
	const folder = realpathSync(root);
	const receipt = readPairJson(
		join(root, "receipt.json"),
		"pair_build_missing",
	);
	const builds = Array.isArray(receipt?.builds) ? receipt.builds : [];
	const sides = { bug: pair.bug_commit, fixed: pair.fix_commit };
	if (receipt?.issue !== issue || receipt.scan_verdict !== "PASS")
		throw new Refusal(
			"pair_invalid",
			"receipt is for another issue or its scan did not pass",
		);
	const resolved = {};
	for (const [side, commit] of Object.entries(sides))
		resolved[side] = pairSide({ folder, root, builds, side, commit });
	return {
		issue,
		issueUrl: pair.url,
		reportTitle: pair.title,
		testNotes:
			typeof manifest.test_notes === "string" ? manifest.test_notes : undefined,
		appNotes:
			typeof manifest.app_notes === "string" ? manifest.app_notes : undefined,
		refusedTestCalls: refused,
		revision: pair.bug_commit,
		runner,
		target: resolved.bug.checkout,
		fixedTarget: resolved.fixed.checkout,
		pageDirs: [resolved.bug.page, resolved.fixed.page],
		// A real target's Vitest needs more than prove's 256 MiB default; pairs
		// default to 1024 MiB, as test/pairs/prove-pair.mjs does.
		memoryMiB: memory ?? PAIR_MEMORY_MIB,
		recordingSha256: pair.recording.sha256,
		pair: { issue, bug_commit: pair.bug_commit, fix_commit: pair.fix_commit },
	};
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
		// This run's own calls; the case figure adds every earlier run of the issue.
		cost_micro_usd: 0,
		case_cost_micro_usd: 0,
		case_budget_micro_usd: o.caseBudget,
		...(o.pair && { pair: o.pair }),
		error: null,
		stages: {},
		model_calls: [],
		call_verdicts: {},
		// A round is one Watch document with the locate and reproduction run on
		// it. Every watch and repro call is recorded under the round it served.
		round: 1,
		call_rounds: {},
	};
}

const runDirOf = (issue) => join(out(), "runs", String(issue));
const caseOf = (issue) => `issue-${issue}`;

async function readJsonOptional(path) {
	try {
		return JSON.parse(await readFile(path, "utf8"));
	} catch {
		return null;
	}
}

// The authoritative call records of one issue: Ember trace events of its case.
async function caseEvents(issue) {
	const caseId = caseOf(issue);
	return (await readLines(join(out(), "trace.jsonl"))).filter(
		(e) => e.caseId === caseId && e.callId,
	);
}

const spendOf = (events) =>
	events.reduce(
		(sum, e) => sum + (e.cost_micro_usd ?? 0) + (e.booked_micro_usd ?? 0),
		0,
	);

/** Settled plus booked spend of one issue, rebuilt from the call records. */
export async function issueSpend(issue) {
	return spendOf(await caseEvents(issue));
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

const usageOf = (call) =>
	Object.fromEntries(USAGE.filter((f) => f in call).map((f) => [f, call[f]]));

// Records each call's round, and for repro the model's stated verdict (display
// evidence only; spend never uses it). The reply also names its call records,
// so reproduction can bind them to the frame the model was shown.
async function attributedCall(ctx, stage, args) {
	const trace = join(out(), "trace.jsonl");
	const before = (await readLines(trace)).length;
	const reply = await callEmber({ ...args, stage });
	const callIds = (await readLines(trace))
		.slice(before)
		.filter((e) => e.type === "request" && e.callId)
		.map((e) => e.callId);
	// Only a verdict from the closed set is kept on the run document.
	const verdict =
		stage === "repro" &&
		["reproduced", "not_reproduced"].includes(reply.output?.verdict) &&
		reply.output.verdict;
	for (const callId of callIds) {
		if (stage !== "prove") ctx.run.call_rounds[callId] = ctx.run.round;
		if (verdict) ctx.run.call_verdicts[callId] = verdict;
	}
	await ctx.publish();
	return { ...reply, callIds };
}

function callEvent(call, t_s) {
	return {
		type: "model_call",
		detail: `Ember ${call.stage} call: ${call.status}`,
		...(call.verdict && { reason: `model verdict: ${call.verdict}` }),
		...(call.round !== undefined && { round: call.round }),
		...(t_s !== undefined && { t_s }),
		...usageOf(call),
	};
}

// Each repro model turn starts with an "observe" frame that lists the turn's
// call records (two after a re-ask). The turn's summed usage goes on the first
// action it produced (that step's cost) and its status and verdict on a
// model_call event at the frame's time. Repro calls no kept frame lists, which
// are those of earlier rounds, come first, each under its round.
function reproEvents(replay, calls) {
	const byId = new Map(calls.map((c) => [c.callIds[0], c]));
	const turns = replay.screenshots.filter((s) => s.action === "observe");
	const bound = new Set(turns.flatMap((t) => t.calls ?? []));
	const events = replay.events.map((e) => ({ ...e }));
	const merged = calls
		.filter((c) => !bound.has(c.callIds[0]))
		.map((c) => callEvent(c));
	let k = 0;
	const flush = (until) => {
		for (; k < turns.length && turns[k].t_s <= until; k++) {
			const mine = (turns[k].calls ?? []).flatMap((id) => byId.get(id) ?? []);
			if (!mine.length) continue;
			const at = turns[k].t_s;
			const next = turns[k + 1]?.t_s ?? Number.POSITIVE_INFINITY;
			const step = events.find(
				(e) => e.type === "action" && e.t_s >= at && e.t_s < next,
			);
			const usage = Object.fromEntries(
				USAGE.filter((f) => mine.some((c) => f in c)).map((f) => [
					f,
					mine.reduce((sum, c) => sum + (c[f] ?? 0), 0),
				]),
			);
			const { stage, status, verdict, round } = mine.at(-1);
			if (step) Object.assign(step, usage);
			merged.push(
				callEvent({ stage, status, verdict, round, ...(!step && usage) }, at),
			);
		}
	};
	for (const event of events) {
		flush(event.t_s ?? 0);
		merged.push(event);
	}
	flush(Number.POSITIVE_INFINITY);
	return merged;
}

function rebuildEvents(run, replay) {
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
			...(replay ? reproEvents(replay, of("repro")) : []),
			...of("prove").map((c) => callEvent(c)),
		],
	};
}

/**
 * The per-issue context shared by the stages. A run.json left by an earlier
 * interrupted run is reloaded; every publication rebuilds the issue's calls and
 * spend from the call records, so it is idempotent after any interruption.
 */
async function openRun(o) {
	const runDir = runDirOf(o.issue);
	await mkdir(runDir, { recursive: true });
	let run = emptyRun(o);
	const saved = await readJsonOptional(join(runDir, "run.json"));
	if (validateRun(saved) && saved.issue === o.issue) run = saved;
	// Calls the issue's case made before this run folder existed are earlier
	// runs: they count in the case's spend and not in this run's.
	else run.case_calls_before = (await caseEvents(o.issue)).length;
	run.state = "running";
	run.call_verdicts ??= {};
	run.call_rounds ??= {};
	run.round ??= 1;
	const ctx = { o, runDir, run, caseId: caseOf(o.issue) };
	ctx.replay = run.stages.repro
		? await readJsonOptional(join(runDir, "replay.json"))
		: null;
	const elapsed = run.elapsed_ms ?? 0;
	const opened = Date.now();
	ctx.publish = async () => {
		const all = await caseEvents(o.issue);
		const events = all.slice(run.case_calls_before ?? 0);
		run.model_calls = events.map((e) => ({
			stage: e.stage,
			status: e.outcome ?? e.type,
			callIds: [e.callId],
			...usageOf(e),
			...(run.call_verdicts[e.callId] && {
				verdict: run.call_verdicts[e.callId],
			}),
			...(run.call_rounds[e.callId] && { round: run.call_rounds[e.callId] }),
		}));
		run.cost_micro_usd = spendOf(events);
		run.case_cost_micro_usd = spendOf(all);
		rebuildEvents(run, ctx.replay);
		run.elapsed_ms = elapsed + Date.now() - opened;
		await writeJsonAtomic(join(runDir, "run.json"), run);
	};
	ctx.artifacts = (stage, paths) => traceArtifacts(runDir, stage, paths);
	ctx.ember = (stage) => (args) => attributedCall(ctx, stage, args);
	await ctx.publish();
	return ctx;
}

const FINAL_FILES = new Set(["comment.md", "run.json", "replay.html"]);
const complete = async (runDir) =>
	(await readJsonOptional(join(runDir, "completion.json")))?.schema ===
	"foley.completion/1";

// Rewrites the artifact trace as exactly one record per inventory file. Each stage
// file must still match the digest its stage traced; report files are new here.
async function compactTrace(runDir, inventory) {
	const trace = join(runDir, "artifact-trace.jsonl");
	const traced = new Map((await readLines(trace)).map((e) => [e.path, e]));
	const artifacts = {};
	const lines = [];
	for (const path of inventory) {
		const digest = sha256(await readFile(join(runDir, path)));
		const prior = traced.get(path);
		if (!FINAL_FILES.has(path) && prior?.sha256 !== digest)
			throw new Error(`${path} changed after its stage recorded it`);
		artifacts[path] = digest;
		const stage = FINAL_FILES.has(path) ? "report" : prior.stage;
		lines.push(
			JSON.stringify({ type: "artifact", stage, path, sha256: digest }),
		);
	}
	await writeFile(`${trace}.tmp`, `${lines.join("\n")}\n`);
	await rename(`${trace}.tmp`, trace);
	return artifacts;
}

/**
 * Final export, in commit order: report, final run document, static page, the
 * artifact trace compacted to exactly the inventory (each stage file must still
 * match the digest its stage traced), core proof, its check, and last the
 * completion marker. Only the marker makes an issue complete; an interrupted
 * export is repeated in full and makes no model call.
 */
async function finish(ctx, verdict) {
	const { run, runDir } = ctx;
	if (await complete(runDir)) return;
	run.verdict = verdict;
	run.state = "finished";
	run.error = null;
	run.stages.report = "ok";
	await report(run, { runDir });
	await ctx.publish();
	await renderReplay(runDir);
	const replay = await readJsonOptional(join(runDir, "replay.json"));
	const artifacts = await compactTrace(
		runDir,
		requiredArtifacts(run, run.stages, replay),
	);
	await writeJsonAtomic(join(runDir, "core-proof.json"), {
		schema: "foley.core-proof/1",
		issue_url: run.issue_url,
		target_revision: run.target_revision,
		fixture: run.fixture,
		...(run.pair && { pair: run.pair }),
		stages: run.stages,
		rerun_without_ember: replay
			? ((await readJsonOptional(join(runDir, "proof.json")))
					?.rerun_without_ember ?? null)
			: null,
		unedited: true,
		artifacts,
	});
	const check = await checkCoreProof(runDir);
	const expected = verdict === "proof_verified" ? "ok" : "not_verified";
	if (check.status !== expected)
		throw new Error(`core proof check: ${check.status}, expected ${expected}`);
	await writeJsonAtomic(join(runDir, "completion.json"), {
		schema: "foley.completion/1",
		issue: run.issue,
		verdict,
		core_proof_sha256: sha256(await readFile(join(runDir, "core-proof.json"))),
	});
}

async function committed(ctx, name, status) {
	ctx.run.stages[name] = status;
	await ctx.publish();
	return { status };
}

const WATCH_ROUNDS = 2;
// Reproduction outcomes that point at Watch's steps or predicate. A refused,
// failed or over-budget model call is not retried with a new Watch round.
const WATCH_MISSES = new Set(["predicate_holds_before", "no_predicate"]);
const watchMissed = (replay) =>
	replay.events
		.filter((e) => e.type === "stopped")
		.every((e) => WATCH_MISSES.has(e.reason));

// What an earlier reproduction saw, as data for Watch's next round.
// After a reproduction that did not show the failure, an earlier predicate the
// page could read, which did not already hold on the fresh page, is kept: only
// the steps change in the next round.
// A predicate whose expected value the bug build showed is contradicted by the
// page and is not kept.
const readablePredicate = (replay, predicate) =>
	!replay.observed &&
	!replay.attempts.some((a) => a.observed_before) &&
	!replay.attempts.some((a) => a.predicate_value === predicate?.expected) &&
	replay.attempts.some(
		(a) =>
			a.predicate_value !== undefined && a.predicate_value !== "unavailable",
	);

function reproductionFeedback(run, replay) {
	const last = replay.events.findLast((e) => e.observation)?.observation;
	return {
		...(readablePredicate(replay, run.predicate) && {
			keep_predicate:
				"the page could read this predicate; change only the steps",
		}),
		earlier_steps: run.steps,
		earlier_predicate: run.predicate,
		reproduction: {
			status: replay.status,
			...(replay.fixed_build_shows_failure && {
				fixed_build_shows_failure: true,
			}),
			predicate_held_before: replay.attempts.some((a) => a.observed_before),
			attempts: replay.attempts.map((a) => ({
				observed: a.observed,
				predicate_value_after: a.predicate_value,
				model_verdict: a.model_verdict,
				actions: a.actions,
			})),
			...(last && { last_observation: last }),
		},
	};
}

// Pair runs: steps that also show the failure on the fixed build do not
// reproduce the reported bug. They are replayed there, without a model, and
// the result is kept in replay.json: the status becomes fixed_build_conflict,
// which is not a reproduction, so no proof is asked for and no success counted.
async function checkedOnFixed(ctx, replay) {
	const { o, runDir, run } = ctx;
	if (!o.pageDirs || !replay.reproduced_steps) return replay;
	const server = await serveBuild(o.pageDirs[1]);
	let check;
	try {
		check = await repro(replay.reproduced_steps, run.predicate, server.origin, {
			runDir: join(runDir, "fixed-check"),
			scripted: true,
		});
	} finally {
		await server.close();
	}
	const conflict = check.status === "reproduced";
	const checked = {
		...replay,
		...(conflict && { status: "fixed_build_conflict" }),
		fixed_build_shows_failure: conflict,
	};
	await writeFile(
		join(runDir, "replay.json"),
		`${JSON.stringify(checked, null, 2)}\n`,
	);
	return checked;
}

// Takes one Watch document as the run's steps, predicate and notes together,
// so notes never describe steps of another round.
function adoptWatch(run, document, predicate = document.predicate) {
	run.steps = document.steps;
	run.predicate = predicate;
	for (const field of ["uncertainty", "narration_evidence"])
		if (document[field]) run[field] = document[field];
		else delete run[field];
}

// One more Watch round with reproduction's feedback; false when it fails.
async function watchAgain(ctx, replay) {
	const { o, runDir, run } = ctx;
	const result = await watch(join(runDir, run.recording), {
		runDir,
		callEmber: ctx.ember("watch"),
		probe: o.probe,
		caseId: ctx.caseId,
		caseBudget: o.caseBudget,
		reportTitle: o.reportTitle,
		appNotes: o.appNotes,
		feedback: reproductionFeedback(run, replay),
	});
	if (result.status !== "ok") return false;
	const kept = readablePredicate(replay, run.predicate)
		? run.predicate
		: undefined;
	adoptWatch(run, result.document, kept);
	if (kept)
		await writeFile(
			join(runDir, "steps.json"),
			`${JSON.stringify({ ...result.document, predicate: kept }, null, 2)}\n`,
		);
	await ctx.artifacts("watch", ["steps.json"]);
	const located = await locate(join(runDir, "steps.json"), {
		targetDir: o.target,
		targetRevision: o.revision,
		runDir,
	});
	run.anchors = located.anchors;
	run.stages.locate = located.status;
	await ctx.artifacts("locate", ["anchors.json"]);
	await ctx.publish();
	return true;
}

// The five stages over one issue's run folder. Each returns {status}; the journal
// decides what comes next and when the issue is finished.
const STAGE_FNS = {
	async watch(ctx) {
		const { o, runDir, run } = ctx;
		const name = `recording${extname(o.recording).toLowerCase()}`;
		const copy = join(runDir, name);
		await copyFile(o.recording, copy);
		if ((await streamDigest(copy)) !== o.recordingSha256) {
			await rm(copy, { force: true });
			throw new Error("recording changed after its check");
		}
		const result = await watch(copy, {
			runDir,
			callEmber: ctx.ember("watch"),
			probe: o.probe,
			caseId: ctx.caseId,
			caseBudget: o.caseBudget,
			reportTitle: o.reportTitle,
			appNotes: o.appNotes,
		});
		if (result.status === "refused_input") {
			await rm(copy, { force: true }); // a refused recording is never embedded
			run.recording = null;
			return committed(ctx, "watch", result.status);
		}
		run.recording = name;
		await ctx.artifacts("watch", [name]);
		if (result.status !== "ok") return committed(ctx, "watch", result.status);
		adoptWatch(run, result.document);
		await ctx.artifacts("watch", ["steps.json"]);
		return committed(ctx, "watch", "ok");
	},
	async locate(ctx) {
		const { o, runDir, run } = ctx;
		const result = await locate(join(runDir, "steps.json"), {
			targetDir: o.target,
			targetRevision: o.revision,
			runDir,
		});
		run.anchors = result.anchors;
		await ctx.artifacts("locate", ["anchors.json"]);
		return committed(ctx, "locate", result.status);
	},
	async repro(ctx) {
		const { o, runDir, run } = ctx;
		// A stage that runs again after an interruption starts a new round.
		if (
			run.model_calls.some((c) => c.stage === "repro" && c.round === run.round)
		)
			run.round += 1;
		const once = () =>
			repro(run.steps, run.predicate, o.appOrigin, {
				runDir,
				caseId: ctx.caseId,
				caseBudget: o.caseBudget,
				callEmber: ctx.ember("repro"),
				...(o.reportTitle && { reportTitle: o.reportTitle }),
				...(o.appNotes && { appNotes: o.appNotes }),
				// Live viewers see each recorded action and frame as it happens.
				async onProgress(progress) {
					ctx.replay = progress;
					await ctx.publish();
				},
			});
		let replay = await checkedOnFixed(ctx, await once());
		// Bounded extra Watch rounds (FOL-R06): Watch is asked again with what
		// reproduction saw, then locate and reproduction run on its new steps.
		for (
			let round = 1;
			round <= WATCH_ROUNDS &&
			(replay.fixed_build_shows_failure ||
				(replay.status !== "reproduced" && watchMissed(replay)));
			round++
		) {
			run.round += 1;
			if (!(await watchAgain(ctx, replay))) break;
			replay = await checkedOnFixed(ctx, await once());
		}
		ctx.replay = replay;
		await ctx.artifacts("repro", [
			"replay.json",
			...replay.screenshots.map((s) => s.path),
		]);
		return committed(ctx, "repro", replay.status);
	},
	async prove(ctx) {
		const { o, runDir, run } = ctx;
		// The actions that reproduced the failure, when there are any.
		const replayed = await readFile(join(runDir, "replay.json"), "utf8")
			.then((text) => JSON.parse(text).reproduced_steps)
			.catch(() => undefined);
		const steps = Array.isArray(replayed) ? replayed : run.steps;
		const result = await prove(steps, run.anchors, run.predicate, {
			runDir,
			targetDir: o.target,
			fixedTargetDir: o.fixedTarget,
			...(o.pageDirs && { pageDirs: o.pageDirs }),
			...(o.memoryMiB && { memoryMiB: o.memoryMiB }),
			runner: o.runner,
			callEmber: ctx.ember("prove"),
			caseId: ctx.caseId,
			caseBudget: o.caseBudget,
			...(o.testNotes && { testNotes: o.testNotes }),
			...(o.reportTitle && { reportTitle: o.reportTitle }),
			...(o.refusedTestCalls && { refusedTestCalls: o.refusedTestCalls }),
		});
		if (["verified", "red_test"].includes(result.status))
			run.test = { path: result.path, verdict: result.status };
		await ctx.artifacts("prove", [
			"proof.json",
			...(result.path ? [result.path] : []),
			...(result.red_output ? [result.red_output] : []),
		]);
		return committed(ctx, "prove", result.status);
	},
	async report(ctx) {
		await finish(ctx, verdictAfterProve(ctx.run.stages.prove));
		return { status: "ok" };
	},
};

/**
 * Journal stage functions for the issues `optionsFor(candidate)` describes,
 * plus `finalize`, which the journal calls after recording a terminal status.
 * A stage that throws publishes the error on the run document and rethrows.
 */
export function issueStages(optionsFor) {
	const contexts = new Map();
	const contextFor = async (c) => {
		if (!contexts.has(c.issue))
			contexts.set(c.issue, await openRun(await optionsFor(c)));
		return contexts.get(c.issue);
	};
	const guarded =
		(fn) =>
		async (c, ...rest) => {
			const ctx = await contextFor(c);
			try {
				return await fn(ctx, ...rest);
			} catch (error) {
				ctx.run.state = "error";
				ctx.run.error = String(error?.message ?? error).split("\n")[0];
				await ctx.publish().catch(() => {});
				throw error;
			}
		};
	const fns = Object.fromEntries(
		STAGES.map((name) => [name, guarded(STAGE_FNS[name])]),
	);
	const finalize = guarded(finish);
	fns.finalize = async (c, status) => {
		if (!(await complete(runDirOf(c.issue)))) await finalize(c, status);
	};
	return fns;
}

/**
 * Runs one issue through the shared journal and returns its run document. A
 * complete issue is returned unchanged; a journal bound to other inputs is
 * refused before anything in the run folder changes.
 */
export async function runIssue(o) {
	const result = await runOne(
		{ issue: o.issue, url: o.issueUrl },
		{
			runRoot: join(out(), "runs"),
			stages: issueStages(() => o),
			identity: identityOf(o),
			cost: (c) => issueSpend(c.issue),
		},
	);
	if (result.status === "resume_mismatch")
		throw new Refusal(
			"resume_mismatch",
			`issue ${o.issue} was started with a different recording, revision, runner or fixture mode`,
		);
	if (result.status !== "ok")
		throw new Refusal(
			"refused_input",
			`issue ${o.issue} has an invalid stage journal`,
		);
	return JSON.parse(
		await readFile(join(runDirOf(o.issue), "run.json"), "utf8"),
	);
}

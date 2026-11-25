#!/usr/bin/env node
// Foley command line (DES-FOL-R13, R14, R15). Exit codes: 0 success or verified
// proof; 1 finished without a verified proof, or backlog interrupted; 2 refused
// (bad argument or missing prerequisite, before any model call); 3 error.
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { backlog } from "../src/backlog.mjs";
import { recordBaseline } from "../src/ember.mjs";
import {
	budget,
	CEILING,
	envelope,
	evaluate,
	HELD_OUT,
	heldOutIds,
	mergeReport,
	perIssueBudget,
	readOptional,
} from "../src/eval.mjs";
import { startLive } from "../src/live.mjs";
import {
	checkRecording,
	identityOf,
	insideCwd,
	issueSpend,
	issueStages,
	lockRun,
	preflight,
	Refusal,
	runIssue,
} from "../src/run.mjs";
import { writeSpendSummary } from "../src/run-schema.mjs";

const HELP = `usage: foley <command> [options]

  run <issue> --issue-url URL --recording FILE --target DIR --revision SHA
      --app-origin URL --runner node-test|vitest --case-budget MICRO_USD
      [--fixed-target DIR] [--probe FILE] [--fixture] [--live] [--dry-run]
  backlog <census.json> --target DIR --app-origin URL --runner NAME
      [--per-issue-usd USD | --case-budget MICRO_USD] [--budget-usd USD]
      [--fixed-target DIR] [--probe FILE] [--media-dir DIR] [--max-issues N]
      [--dry-run]
  eval [--labels FILE] [--budget-usd USD] [--max-issues N] [--dry-run]
      [--target DIR --app-origin URL --runner NAME and the backlog options]
  spend [--dry-run]
  baseline <micro-usd>
  --version | help

Exit codes: 0 success or verified proof; 1 finished without a verified proof
or backlog interrupted; 2 refused before any model call; 3 error.`;

const OPTIONS = {
	"issue-url": { type: "string" },
	recording: { type: "string" },
	target: { type: "string" },
	revision: { type: "string" },
	"fixed-target": { type: "string" },
	"app-origin": { type: "string" },
	runner: { type: "string" },
	"case-budget": { type: "string" },
	probe: { type: "string" },
	fixture: { type: "boolean" },
	live: { type: "boolean" },
	"dry-run": { type: "boolean" },
	"media-dir": { type: "string" },
	"max-issues": { type: "string" },
	labels: { type: "string" },
	"budget-usd": { type: "string" },
	"per-issue-usd": { type: "string" },
	version: { type: "boolean" },
};
const MEDIA_EXT = {
	"video/mp4": ".mp4",
	"video/quicktime": ".mov",
	"video/webm": ".webm",
};
const OUT = () => join(process.cwd(), "out");
const integer = (text) =>
	/^\d+$/.test(text ?? "") ? Number(text) : Number.NaN;
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

function common(v) {
	return {
		target: v.target,
		revision: v.revision,
		fixedTarget: v["fixed-target"],
		appOrigin: v["app-origin"],
		runner: v.runner,
		caseBudget: integer(v["case-budget"]),
		probe: v.probe,
	};
}

async function run([issue, ...extra], v) {
	if (extra.length) throw new Refusal("bad_argument", "run takes one issue");
	if (!v["issue-url"] || !v.recording)
		throw new Refusal(
			"bad_argument",
			"--issue-url and --recording are required",
		);
	const o = preflight({
		...common(v),
		issue: integer(issue),
		issueUrl: v["issue-url"],
		recording: v.recording,
		fixture: v.fixture,
	});
	o.recordingSha256 = await checkRecording(o.recording);
	if (v["dry-run"]) {
		console.log(`dry run: issue ${o.issue} ready; no model call made`);
		return 0;
	}
	const unlock = await lockRun();
	let live;
	const stop = async () => {
		await live?.close().catch(() => {});
		await unlock();
		process.exit(143);
	};
	process.once("SIGTERM", stop);
	process.once("SIGINT", stop);
	try {
		if (v.live) {
			const runDir = join(OUT(), "runs", String(o.issue));
			await mkdir(runDir, { recursive: true });
			live = await startLive(runDir);
			console.log(`LIVE_URL=${live.origin}`);
		}
		const result = await runIssue(o);
		console.log(`issue ${o.issue}: ${result.verdict} (out/runs/${o.issue}/)`);
		return result.verdict === "proof_verified" ? 0 : 1;
	} finally {
		await live?.close().catch(() => {});
		await unlock();
	}
}

// Media come from the census and are never fetched here: each must already sit
// in the media folder under its census digest, and is checked before use.
async function cachedMedia(candidate, dir) {
	const media = candidate.media?.[0];
	const ext = MEDIA_EXT[media?.media_type];
	if (!ext || !/^[0-9a-f]{64}$/.test(media?.sha256 ?? ""))
		throw new Refusal(
			"media_missing",
			`issue ${candidate.issue} has no usable media`,
		);
	const path = join(dir, `${media.sha256}${ext}`);
	if (!existsSync(path))
		throw new Refusal(
			"media_missing",
			`issue ${candidate.issue}: ${path} not found`,
		);
	// Confinement, then type, size and content, before the bytes are hashed.
	const real = insideCwd(path, `issue ${candidate.issue} media`);
	if ((await checkRecording(real)) !== media.sha256)
		throw new Refusal(
			"media_digest",
			`issue ${candidate.issue}: ${path} digest differs`,
		);
	return real;
}

// Envelopes are checked before anything else, including dry runs.
function envelopes(v, ceiling) {
	return {
		total: budget(v["budget-usd"], ceiling, "--budget-usd"),
		perIssue: perIssueBudget(v),
	};
}

async function runBacklog([censusPath, ...extra], v) {
	if (!censusPath || extra.length)
		throw new Refusal("bad_argument", "backlog takes one census file");
	const limits = envelopes(v, CEILING.backlog);
	const census = await readJson(insideCwd(censusPath, "census"));
	const population = (census.candidates ?? []).map((c) => c.issue);
	const result = await processCensus(census, v, { ...limits, population });
	if (result === null) return 0;
	console.log(
		`backlog ${result.status}: ${result.report.length} issues (out/backlog-report.json)`,
	);
	return result.status === "ok" ? 0 : 1;
}

// Runs the census through the stages under the run lock. Each issue's case budget
// is its per-issue limit capped by what the envelope has left for the population.
// Returns null for a dry run.
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: linear sequence of media checks, lock and backlog call
async function processCensus(census, v, { total, perIssue, population }) {
	const mediaDir = insideCwd(v["media-dir"] ?? "media/cache", "--media-dir");
	const maxIssues =
		v["max-issues"] === undefined ? undefined : integer(v["max-issues"]);
	const base = preflight({
		...common(v),
		caseBudget: perIssue,
		revision: census.target_revision,
		issue: 1,
		fixture: v.fixture,
	});
	const eligible = (census.candidates ?? []).filter(
		(c) => c.status === "eligible_not_attempted",
	);
	const recordings = new Map();
	for (const c of eligible.slice(0, maxIssues ?? eligible.length))
		recordings.set(c.issue, await cachedMedia(c, mediaDir));
	if (v["dry-run"]) {
		console.log(
			`dry run: ${eligible.length} eligible issues ready; no model call made`,
		);
		return null;
	}
	const caseBudget = envelope({ outDir: OUT(), population, total, perIssue });
	const unlock = await lockRun();
	const options = async (c) => ({
		...base,
		caseBudget: await caseBudget(c.issue),
		issue: c.issue,
		issueUrl: c.url,
		recording: recordings.get(c.issue) ?? (await cachedMedia(c, mediaDir)),
		recordingSha256: c.media?.[0]?.sha256,
	});
	try {
		const result = await backlog(census, {
			runRoot: join(OUT(), "runs"),
			stages: issueStages(options),
			identity: (c) =>
				identityOf({ ...base, recordingSha256: c.media?.[0]?.sha256 }),
			cost: (c) => issueSpend(c.issue),
			...(maxIssues !== undefined && { maxIssues }),
		});
		if (result.status === "resume_mismatch")
			throw new Refusal(
				"resume_mismatch",
				"a census issue was started with a different recording, revision, runner or fixture mode",
			);
		if (result.status === "refused_input")
			throw new Refusal(
				"bad_census",
				"census or saved backlog state is invalid",
			);
		return result;
	} finally {
		await unlock();
	}
}

// Evaluation subject: exactly the frozen held-out issues. New attempts run only
// with --target and a non-zero --max-issues, on held-out census rows only.
async function runEval(_, v) {
	const limits = envelopes(v, CEILING.eval);
	const { ids, labels } = await heldOutIds(
		insideCwd(v.labels ?? HELD_OUT, "--labels"),
		process.cwd(),
	);
	const attempt = v.target !== undefined && v["max-issues"] !== "0";
	if (attempt) {
		const census = await readJson(insideCwd(labels.census, "census"));
		const held = new Set(ids);
		const selected = {
			...census,
			candidates: (census.candidates ?? []).filter((c) => held.has(c.issue)),
		};
		const before = await readOptional(join(OUT(), "backlog-report.json"), []);
		const result = await processCensus(selected, v, {
			...limits,
			population: ids,
		});
		if (result) await mergeReport(OUT(), before, result.report);
	}
	const report = await evaluate({
		outDir: OUT(),
		ids,
		labels,
		write: !v["dry-run"],
	});
	if (v["dry-run"]) {
		const { results: _rows, ...summary } = report;
		console.log(JSON.stringify(summary));
		return 0;
	}
	console.log("eval written to out/eval-report.json");
	return 0;
}

async function spend(_, v) {
	if (v["dry-run"]) {
		console.log("dry run: spend reads out/ledger.json and out/trace.jsonl");
		return 0;
	}
	try {
		const summary = await writeSpendSummary(OUT());
		console.log(JSON.stringify(summary));
		return 0;
	} catch (error) {
		console.error(`foley spend: ${error.message}`);
		return 3;
	}
}

async function baseline([amount]) {
	const value = integer(amount);
	if (!Number.isSafeInteger(value))
		throw new Refusal("bad_argument", "baseline takes integer micro-dollars");
	await recordBaseline(value);
	console.log(`baseline recorded: ${value} micro-USD`);
	return 0;
}

const COMMANDS = { run, backlog: runBacklog, eval: runEval, spend, baseline };

async function main(argv) {
	let parsed;
	try {
		parsed = parseArgs({
			args: argv,
			options: OPTIONS,
			allowPositionals: true,
			strict: true,
		});
	} catch (error) {
		throw new Refusal("bad_argument", error.message);
	}
	const { values, positionals } = parsed;
	if (values.version) {
		const pkg = JSON.parse(
			readFileSync(new URL("../package.json", import.meta.url)),
		);
		console.log(`foley ${pkg.version}`);
		return 0;
	}
	const [command, ...rest] = positionals;
	if (command === "help" || command === undefined) {
		console.log(HELP);
		return command ? 0 : 2;
	}
	if (!Object.hasOwn(COMMANDS, command))
		throw new Refusal("unknown_command", `${command}\n${HELP}`);
	return COMMANDS[command](rest, values);
}

try {
	process.exitCode = await main(process.argv.slice(2));
} catch (error) {
	if (error instanceof Refusal) {
		console.error(`foley: refused: ${error.message}`);
		process.exitCode = 2;
	} else {
		console.error(
			`foley: error: ${String(error?.message ?? error).split("\n")[0]}`,
		);
		process.exitCode = 3;
	}
}

#!/usr/bin/env node
// Foley command line (DES-FOL-R13, R14, R15). Exit codes: 0 success or verified
// proof; 1 finished without a verified proof, or backlog interrupted; 2 refused
// (bad argument or missing prerequisite, before any model call); 3 error.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { backlog } from "../src/backlog.mjs";
import { recordBaseline } from "../src/ember.mjs";
import { startLive } from "../src/live.mjs";
import {
	insideCwd,
	lockRun,
	openRun,
	preflight,
	Refusal,
	runIssue,
	STAGES,
	stages,
} from "../src/run.mjs";
import { writeSpendSummary } from "../src/run-schema.mjs";
import { score } from "../src/score.mjs";

const HELP = `usage: foley <command> [options]

  run <issue> --issue-url URL --recording FILE --target DIR --revision SHA
      --app-origin URL --runner node-test|vitest --case-budget MICRO_USD
      [--fixed-target DIR] [--probe FILE] [--fixture] [--live] [--dry-run]
  backlog <census.json> --target DIR --app-origin URL --runner NAME
      --case-budget MICRO_USD [--fixed-target DIR] [--probe FILE]
      [--media-dir DIR] [--max-issues N] [--dry-run]
  eval [--labels FILE] [--dry-run]
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
		const result = await runIssue(o, {
			async beforeStages(runDir) {
				if (!v.live) return;
				live = await startLive(runDir);
				console.log(`LIVE_URL=${live.origin}`);
			},
		});
		console.log(`issue ${o.issue}: ${result.verdict} (out/runs/${o.issue}/)`);
		return result.verdict === "proof_verified" ? 0 : 1;
	} finally {
		await live?.close().catch(() => {});
		await unlock();
	}
}

// Media come from the census and are never fetched here: each must already sit
// in the media folder under its census digest, and is checked before use.
function cachedMedia(candidate, dir) {
	const media = candidate.media?.[0];
	const ext = MEDIA_EXT[media?.media_type];
	if (!ext || !/^[0-9a-f]{64}$/.test(media?.sha256 ?? ""))
		throw new Refusal(
			"media_missing",
			`issue ${candidate.issue} has no usable media`,
		);
	const path = join(dir, `${media.sha256}${ext}`);
	let bytes;
	try {
		bytes = readFileSync(path);
	} catch {
		throw new Refusal(
			"media_missing",
			`issue ${candidate.issue}: ${path} not found`,
		);
	}
	if (createHash("sha256").update(bytes).digest("hex") !== media.sha256)
		throw new Refusal(
			"media_digest",
			`issue ${candidate.issue}: ${path} digest differs`,
		);
	return path;
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: linear sequence of census checks, media checks, lock and backlog call
async function runBacklog([censusPath, ...extra], v) {
	if (!censusPath || extra.length)
		throw new Refusal("bad_argument", "backlog takes one census file");
	const census = await readJson(insideCwd(censusPath, "census"));
	const mediaDir = insideCwd(v["media-dir"] ?? "media/cache", "--media-dir");
	const maxIssues =
		v["max-issues"] === undefined ? undefined : integer(v["max-issues"]);
	const base = preflight({
		...common(v),
		revision: census.target_revision,
		issue: 1,
	});
	const eligible = (census.candidates ?? []).filter(
		(c) => c.status === "eligible_not_attempted",
	);
	for (const c of eligible.slice(0, maxIssues ?? eligible.length))
		cachedMedia(c, mediaDir);
	if (v["dry-run"]) {
		console.log(
			`dry run: ${eligible.length} eligible issues ready; no model call made`,
		);
		return 0;
	}
	const unlock = await lockRun();
	const contexts = new Map();
	const contextFor = async (c) => {
		if (!contexts.has(c.issue))
			contexts.set(
				c.issue,
				stages(
					await openRun({
						...base,
						issue: c.issue,
						issueUrl: c.url,
						recording: cachedMedia(c, mediaDir),
						fixture: false,
					}),
				),
			);
		return contexts.get(c.issue);
	};
	const stageFns = Object.fromEntries(
		STAGES.map((name) => [name, async (c) => (await contextFor(c))[name]()]),
	);
	try {
		const result = await backlog(census, {
			runRoot: join(OUT(), "runs"),
			stages: stageFns,
			...(maxIssues !== undefined && { maxIssues }),
		});
		if (result.status === "refused_input")
			throw new Refusal(
				"bad_census",
				"census or saved backlog state is invalid",
			);
		console.log(
			`backlog ${result.status}: ${result.report.length} issues (out/backlog-report.json)`,
		);
		return result.status === "ok" ? 0 : 1;
	} finally {
		await unlock();
	}
}

async function runEval(_, v) {
	const labels = await readJson(
		insideCwd(v.labels ?? "fixtures/eval/held-out.json", "--labels"),
	);
	let rows;
	try {
		rows = await readJson(join(OUT(), "backlog-report.json"));
	} catch {
		if (v["dry-run"]) {
			console.log("dry run: no backlog report yet; nothing to score");
			return 0;
		}
		throw new Refusal("missing_report", "run `foley backlog` first");
	}
	const results = [];
	for (const row of rows) {
		let saved = {};
		try {
			saved = await readJson(
				join(OUT(), "runs", String(row.issue), "run.json"),
			);
		} catch {}
		results.push({
			...row,
			anchors: saved.anchors ?? [],
			elapsed_ms: saved.elapsed_ms ?? 0,
		});
	}
	const summary = score(results, labels);
	if (v["dry-run"]) {
		console.log(JSON.stringify(summary));
		return 0;
	}
	await writeFile(
		join(OUT(), "eval-report.json"),
		`${JSON.stringify(summary, null, 2)}\n`,
	);
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

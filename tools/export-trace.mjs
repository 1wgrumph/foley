#!/usr/bin/env node
// Writes the publishable prompt and token trace of one finished run.
//   node tools/export-trace.mjs <issue> <out-dir> [label] [run-dir]
// Reads out/runs/<issue>/ (or run-dir) and the call records of that run only (run.json
// lists them), so the trace and the run folder are the same run. Requests come
// from out/prompts/, where media are already digests. Check the result with
// tools/check-public.mjs before committing it.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [issue, outDir, label = "", runDirArg] = process.argv.slice(2);
if (!/^\d+$/.test(issue ?? "") || !outDir) {
	console.error("usage: export-trace.mjs <issue> <out-dir> [label] [run-dir]");
	process.exit(2);
}
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const runDir = runDirArg ?? join("out", "runs", issue);
const run = readJson(join(runDir, "run.json"));
const events = new Map(
	readFileSync(join("out", "trace.jsonl"), "utf8")
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line))
		.filter((e) => e.type === "request" && e.callId)
		.map((e) => [e.callId, e]),
);
const TOKENS = [
	"input_tokens",
	"cached_input_tokens",
	"output_tokens",
	"reasoning_tokens",
	"cost_micro_usd",
];
const calls = run.model_calls.map((call, i) => {
	const event = events.get(call.callIds[0]);
	return {
		n: i + 1,
		stage: call.stage,
		...(call.round !== undefined && { round: call.round }),
		outcome: call.status,
		request_digest: event.request_digest,
		...Object.fromEntries(TOKENS.map((f) => [f, event[f] ?? 0])),
		request: readJson(join("out", "prompts", `${event.request_digest}.json`)),
	};
});
const total = (field) => calls.reduce((sum, call) => sum + call[field], 0);
const replay = readJson(join(runDir, "replay.json"));
const proof = readJson(join(runDir, "proof.json"));
const write = (name, value) =>
	writeFileSync(join(outDir, name), `${JSON.stringify(value, null, "\t")}\n`);
mkdirSync(outDir, { recursive: true });
write("summary.json", {
	schema: "foley.trace/1",
	issue: run.issue,
	run: label,
	verdict: run.verdict,
	model: "muse-ember-1.0",
	calls: calls.length,
	...Object.fromEntries(TOKENS.map((f) => [f, total(f)])),
	case_cost_micro_usd: run.case_cost_micro_usd,
	redaction:
		"No key; images and media appear only as SHA-256 digests; no local paths.",
});
write("calls.json", calls);
write("replies.json", {
	note: "Foley keeps each reply only as its validated record: Watch as steps.json, reproduction as the actions, observations and reasons it executed, proof as the accepted test and the runner results. Raw reply text is not stored.",
	watch_steps: readJson(join(runDir, "steps.json")),
	reproduction: {
		status: replay.status,
		attempts: replay.attempts,
		fixed_build_shows_failure: replay.fixed_build_shows_failure,
		reproduced_steps: replay.reproduced_steps,
		events: replay.events,
	},
	proof: {
		...proof,
		// The scratch folder of each attempt is a local path and is left out.
		attempts: (proof.attempts ?? []).map(
			({ sandboxPath: _local, ...attempt }) => attempt,
		),
		...(run.test && {
			test: readFileSync(join(runDir, run.test.path), "utf8"),
		}),
	},
});
console.log(
	`trace written: ${outDir} (${calls.length} calls, ${total("cost_micro_usd")} micro-USD)`,
);

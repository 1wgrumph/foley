// Live protocol probe (slice S3, FOL-R01 to R04): one paid step per run, through
// src/ember.mjs only, on the owned clip. Each step writes out/probe/<step>.json with
// the API's own usage beside the ledger's record of the same call.
// Usage: node test/probe.live.mjs <text|frames|frames-again|video|audio>
// Needs MODEL_API_KEY in the environment and a recorded ledger baseline.
import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { callEmber } from "../src/ember.mjs";

const CLIP = "fixtures/recordings/owned-basic-flow.mp4";
const PRICE = { input: 0.1, cached: 0.004, output: 0.5 }; // USD per million tokens, published
const SYSTEM = "Reply with one JSON object and nothing else.";
const toolEnv = { PATH: process.env.PATH };
const b64 = (bytes) => bytes.toString("base64");

function frames() {
	const dir = mkdtempSync(join(tmpdir(), "foley-probe-"));
	try {
		execFileSync(
			"ffmpeg",
			["-v", "error", "-i", CLIP, "-vf", "fps=1", join(dir, "%03d.png")],
			{ env: toolEnv },
		);
		return readdirSync(dir)
			.sort()
			.flatMap((name, i) => [
				{ type: "text", text: `Frame at ${i} s:` },
				{
					type: "image_url",
					image_url: {
						url: `data:image/png;base64,${b64(readFileSync(join(dir, name)))}`,
					},
				},
			]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// Ten seconds of a 440 Hz tone, then two of silence: owned, no speech.
function tone() {
	return execFileSync(
		"ffmpeg",
		[
			"-v",
			"error",
			"-f",
			"lavfi",
			"-i",
			"sine=frequency=440:duration=10",
			"-af",
			"apad=pad_dur=2",
			"-ac",
			"1",
			"-ar",
			"16000",
			"-f",
			"wav",
			"pipe:1",
		],
		{ env: toolEnv, maxBuffer: 1 << 24 },
	);
}

const STEPS = {
	text: () => [{ type: "text", text: 'Return {"ok": true}.' }],
	frames: () => [
		{
			type: "text",
			text: 'These are frames of a screen recording, one per second. Reply {"frames": <how many frames you received>, "summary": <one sentence>}.',
		},
		...frames(),
	],
	video: () => [
		{
			type: "text",
			text: 'This is a screen recording. Reply {"seconds": <its length in seconds>, "summary": <one sentence>}.',
		},
		{
			type: "video_url",
			video_url: { url: `data:video/mp4;base64,${b64(readFileSync(CLIP))}` },
		},
	],
	audio: () => [
		{
			type: "text",
			text: 'Describe this audio. Reply {"seconds": <its length in seconds>, "heard": <one sentence>}.',
		},
		{ type: "input_audio", input_audio: { format: "wav", data: b64(tone()) } },
	],
};
STEPS["frames-again"] = STEPS.frames; // the same request again, to observe caching

const step = process.argv[2];
if (!STEPS[step]) {
	console.error(`usage: probe.live.mjs <${Object.keys(STEPS).join("|")}>`);
	process.exit(2);
}
const traceLines = () =>
	readFileSync("out/trace.jsonl", "utf8").trim().split("\n");
const before = traceLines().length;
const started = performance.now();
const result = await callEmber({
	messages: [
		{ role: "system", content: SYSTEM },
		{ role: "user", content: STEPS[step]() },
	],
	max_output_tokens: 4000,
	caseId: `probe-${step}`,
	stage: "probe",
});
const wall_s = Math.round(performance.now() - started) / 1000;
const events = traceLines()
	.slice(before)
	.map((line) => JSON.parse(line));
const call = events.find((e) => e.type === "request");
const usage = result.api?.usage;
const apiCost = usage
	? (usage.prompt_tokens - (usage.prompt_tokens_details?.cached_tokens ?? 0)) *
			PRICE.input +
		(usage.prompt_tokens_details?.cached_tokens ?? 0) * PRICE.cached +
		usage.completion_tokens * PRICE.output
	: null;
const record = {
	step,
	clip: CLIP,
	wall_s,
	status: result.status,
	message: result.message,
	output: result.output,
	api: result.api,
	ledger_events: events,
	reconciliation: call &&
		usage && {
			api_prompt_tokens: usage.prompt_tokens,
			ledger_input_plus_cached: call.input_tokens + call.cached_input_tokens,
			api_completion_tokens: usage.completion_tokens,
			ledger_output_tokens: call.output_tokens,
			api_cost_usd: apiCost / 1e6,
			ledger_cost_usd: call.cost_micro_usd / 1e6,
			tokens_match:
				usage.prompt_tokens === call.input_tokens + call.cached_input_tokens &&
				usage.completion_tokens === call.output_tokens,
			cost_match: call.cost_micro_usd === Math.ceil(apiCost),
		},
};
mkdirSync("out/probe", { recursive: true });
writeFileSync(`out/probe/${step}.json`, `${JSON.stringify(record, null, 2)}\n`);
console.log(
	JSON.stringify({
		step,
		status: result.status,
		wall_s,
		usage,
		reconciliation: record.reconciliation,
		output: result.output,
		finish: result.api?.finish_reason,
		head: result.api?.content_head?.slice(0, 300),
	}),
);

// Watch: one screen recording to ordered reproduction steps and one failure
// predicate (DES-FOL-R04). The recording and the model reply are untrusted: the
// file is checked before any request, and the reply must pass validateSteps.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import {
	appendFile,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rename,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { ACTIONS, validateSteps } from "./run-schema.mjs";

const run = promisify(execFile);
const MAX_BYTES = 50 * 1024 * 1024;
const MAX_SECONDS = 120;
const MAX_FRAMES = 40;
const MAX_FRAME_PX = 1280;
const MAX_OUTPUT_TOKENS = 4000;
const TYPES = { ".mp4": ["mp4", "video/mp4"], ".webm": ["webm", "video/webm"] };
// Measured media bounds are written by the live protocol probe (slice S3).
const BOUNDS = new URL("../fixtures/ember/bounds.json", import.meta.url);
const NO_MEDIA = { video: { accepted: false }, audio: { accepted: false } };
// Media tools get no model credential and may read only local files.
const toolEnv = () => ({ PATH: process.env.PATH });

const bounded = (m) =>
	m?.accepted === true &&
	typeof m.tokensPerSecond === "number" &&
	m.tokensPerSecond > 0;

async function loadProbe() {
	if (!existsSync(BOUNDS)) return NO_MEDIA;
	try {
		const probe = JSON.parse(await readFile(BOUNDS, "utf8"));
		return { video: probe.video ?? {}, audio: probe.audio ?? {} };
	} catch {
		return NO_MEDIA;
	}
}

// Type, size and duration are checked before any request. Returns null when the
// recording is refused.
async function inspect(path) {
	const type = TYPES[extname(path).toLowerCase()];
	if (!type) return null;
	try {
		const info = await stat(path);
		if (!info.isFile() || info.size > MAX_BYTES) return null;
		const { stdout } = await run(
			"ffprobe",
			[
				"-v",
				"error",
				"-protocol_whitelist",
				"file",
				"-show_entries",
				"format=format_name,duration:stream=codec_type",
				"-of",
				"json",
				`file:${path}`,
			],
			{ env: toolEnv(), timeout: 30000 },
		);
		const probe = JSON.parse(stdout);
		const duration = Number(probe.format?.duration);
		const streams = (probe.streams ?? []).map((s) => s.codec_type);
		const ok =
			String(probe.format?.format_name).split(",").includes(type[0]) &&
			streams.includes("video") &&
			duration > 0 &&
			duration <= MAX_SECONDS;
		return ok
			? { duration, audio: streams.includes("audio"), mime: type[1] }
			: null;
	} catch {
		return null;
	}
}

// One frame per second (fewer for long clips, at most 40), at most 1280 px per axis.
async function sampleFrames(path, duration) {
	const rate = Math.min(1, MAX_FRAMES / duration);
	const dir = await mkdtemp(join(tmpdir(), "foley-frames-"));
	try {
		const scale = `scale=w='min(${MAX_FRAME_PX},iw)':h='min(${MAX_FRAME_PX},ih)':force_original_aspect_ratio=decrease`;
		await run(
			"ffmpeg",
			[
				"-v",
				"error",
				"-protocol_whitelist",
				"file",
				"-i",
				`file:${path}`,
				"-vf",
				`fps=${rate},${scale}`,
				"-frames:v",
				String(MAX_FRAMES),
				join(dir, "%03d.png"),
			],
			{ env: toolEnv(), timeout: 120000 },
		);
		const names = (await readdir(dir)).filter((n) => n.endsWith(".png")).sort();
		return Promise.all(
			names.map(async (name, i) => ({
				t_s: Math.round((i / rate) * 10) / 10,
				png: await readFile(join(dir, name)),
			})),
		);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

async function extractAudio(path) {
	const { stdout } = await run(
		"ffmpeg",
		[
			"-v",
			"error",
			"-protocol_whitelist",
			"file",
			"-i",
			`file:${path}`,
			"-vn",
			"-ac",
			"1",
			"-ar",
			"16000",
			"-f",
			"wav",
			"pipe:1",
		],
		{
			env: toolEnv(),
			timeout: 120000,
			encoding: "buffer",
			maxBuffer: MAX_BYTES * 2,
		},
	);
	return stdout;
}

const SYSTEM = [
	"You turn a screen recording of a web application into reproduction steps.",
	"Reply with one JSON object and nothing else:",
	'{"schema":"foley.steps/1","steps":[{"order":1,"t_s":<seconds>,"action":<action>,',
	'"target":<visible text of the element>,"value":<typed text, only for type>,',
	'"selector":<CSS selector, optional>}],"predicate":null or',
	'{"kind":"visible_text","selector":<CSS selector>,"expected":<what should be shown>,',
	'"observed":<what is shown instead>}}.',
	`Actions: ${[...ACTIONS].join(", ")}. Number steps from 1 and order them by time.`,
	"Use null for predicate when the recording shows correct behaviour.",
	"Describe only what is visible; if narration disagrees with the screen, follow the screen.",
].join(" ");

const dataUrl = (mime, bytes) =>
	`data:${mime};base64,${bytes.toString("base64")}`;

// Keeps only declared fields, so nothing else from the reply reaches the run folder.
function steps(output, mediaPath) {
	if (
		output === null ||
		typeof output !== "object" ||
		!Array.isArray(output.steps)
	)
		return null;
	const pick = (s) => ({
		order: s?.order,
		t_s: s?.t_s,
		action: s?.action,
		target: s?.target,
		...(s?.value !== undefined && { value: s.value }),
		...(s?.selector !== undefined && { selector: s.selector }),
	});
	const p = output.predicate;
	const document = {
		schema: output.schema,
		steps: output.steps.map(pick),
		predicate:
			p && typeof p === "object"
				? {
						kind: p.kind,
						...(p.selector !== undefined && { selector: p.selector }),
						expected: p.expected,
						observed: p.observed,
					}
				: p,
		mediaPath,
	};
	return validateSteps(document) ? document : null;
}

export async function watch(
	recordingPath,
	{ runDir, callEmber, probe, caseId, caseBudget },
) {
	const path = resolve(recordingPath);
	const media = await inspect(path);
	if (!media)
		return {
			status: "refused_input",
			message: "recording type, size, duration or content refused",
		};
	const limits = probe ?? (await loadProbe());
	await mkdir(runDir, { recursive: true });
	const traceFile = join(runDir, "watch.trace.jsonl");
	const header = {
		type: "text",
		text: `Recording of ${media.duration.toFixed(1)} s.`,
	};
	const audio =
		media.audio && bounded(limits.audio)
			? [
					{
						type: "audio_url",
						audio_url: { url: dataUrl("audio/wav", await extractAudio(path)) },
					},
				]
			: [];
	const attempt = async (mediaPath, content) => {
		const result = await callEmber({
			messages: [
				{ role: "system", content: SYSTEM },
				{ role: "user", content: [header, ...content, ...audio] },
			],
			max_output_tokens: MAX_OUTPUT_TOKENS,
			caseId,
			...(caseBudget !== undefined && { caseBudget }),
		});
		await appendFile(
			traceFile,
			`${JSON.stringify({ type: "watch", path: mediaPath, status: result.status })}\n`,
		);
		return result;
	};
	let mediaPath = "video";
	let result;
	if (bounded(limits.video))
		result = await attempt("video", [
			{
				type: "video_url",
				video_url: { url: dataUrl(media.mime, await readFile(path)) },
			},
		]);
	if (
		!result ||
		result.status === "refused_input" ||
		result.status === "budget_refused"
	) {
		mediaPath = "frames";
		let frames;
		try {
			frames = await sampleFrames(path, media.duration);
		} catch {
			return {
				status: "refused_input",
				message: "frames could not be sampled",
			};
		}
		if (frames.length === 0)
			return { status: "refused_input", message: "no frames sampled" };
		result = await attempt(
			"frames",
			frames.flatMap((f) => [
				{ type: "text", text: `Frame at ${f.t_s} s:` },
				{ type: "image_url", image_url: { url: dataUrl("image/png", f.png) } },
			]),
		);
	}
	if (result.status !== "ok") return { status: result.status };
	const document = steps(result.output, mediaPath);
	if (!document)
		return {
			status: "malformed_output",
			message: "reply is not a valid steps document",
		};
	const file = join(runDir, "steps.json");
	await writeFile(`${file}.tmp`, `${JSON.stringify(document, null, 2)}\n`);
	await rename(`${file}.tmp`, file);
	return { status: "ok", document };
}

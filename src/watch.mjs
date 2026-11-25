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
import { ACTIONS, VIEWPORT, validateSteps } from "./run-schema.mjs";

const run = promisify(execFile);
const MAX_BYTES = 50 * 1024 * 1024;
const MAX_SECONDS = 120;
const MAX_FRAMES = 40;
const MAX_FRAME_PX = 1280;
const MAX_OUTPUT_TOKENS = 4000;
// Census media are MP4, QuickTime and WebM; ffprobe names QuickTime "mov".
const TYPES = {
	".mp4": ["mp4", "video/mp4"],
	".mov": ["mov", "video/quicktime"],
	".webm": ["webm", "video/webm"],
};
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
export async function inspect(path) {
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
	'"selector":<CSS selector, optional>}],"predicate":<null or one predicate>,',
	'"uncertainty":[{"t_s":<seconds>,"text":<what is unclear>}],',
	'"narration_evidence":[{"t_s":<seconds>,"text":<a fact only the narration states>}]}.',
	"A predicate is one of:",
	'{"kind":"visible_text","selector":<CSS>,"expected":<text>,"observed":<text shown instead>};',
	'{"kind":"element_count","selector":<CSS>,"expected":<count>,"observed":<count>};',
	'{"kind":"console_error","message":<exact console error text>,"expected":false,"observed":true};',
	'{"kind":"canvas_state","source":"elements" or "appState","path":[<keys or indices>],',
	'"expected":<JSON scalar>,"observed":<JSON scalar>}. Expected and observed must differ.',
	`Actions: ${[...ACTIONS].join(", ")}. Number steps from 1 and order them by time.`,
	"Pointer actions (pointer_click, pointer_double_click, pointer_move: x, y;",
	"pointer_drag: x, y, to_x, to_y) are for what is drawn on a canvas and has no",
	`visible text or selector; give integer pixels of a ${VIEWPORT.width} by ${VIEWPORT.height} viewport,`,
	"scaling the frame's position to it. Prefer target text or a selector otherwise.",
	"Use null for predicate when the recording shows correct behaviour.",
	"Describe only what is visible; if narration disagrees with the screen, follow the screen",
	"and record the conflict in uncertainty. Each list has at most 40 entries of at most",
	"1,024 characters; omit a list when it would be empty.",
].join(" ");

// Every field any predicate kind declares; validateSteps checks them per kind.
const PREDICATE_FIELDS = [
	"kind",
	"selector",
	"message",
	"source",
	"path",
	"expected",
	"observed",
];

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
		...fields(s, ["x", "y", "to_x", "to_y"]),
	});
	const p = output.predicate;
	const fields = (o, names) =>
		Object.fromEntries(
			names.filter((n) => o?.[n] !== undefined).map((n) => [n, o[n]]),
		);
	const evidence = (list) =>
		Array.isArray(list) ? list.map((e) => fields(e, ["t_s", "text"])) : list;
	const document = {
		schema: output.schema,
		steps: output.steps.map(pick),
		predicate: p && typeof p === "object" ? fields(p, PREDICATE_FIELDS) : p,
		mediaPath,
		...(output.uncertainty !== undefined && {
			uncertainty: evidence(output.uncertainty),
		}),
		...(output.narration_evidence !== undefined && {
			narration_evidence: evidence(output.narration_evidence),
		}),
	};
	return validateSteps(document) ? document : null;
}

// The frames path as message parts: a time label before each frame, or null when
// no frame can be sampled.
async function framesContent(path, duration) {
	let frames;
	try {
		frames = await sampleFrames(path, duration);
	} catch {
		return null;
	}
	if (frames.length === 0) return null;
	return frames.flatMap((f) => [
		{ type: "text", text: `Frame at ${f.t_s} s:` },
		{ type: "image_url", image_url: { url: dataUrl("image/png", f.png) } },
	]);
}

// Narration is sent only when the clip has audio and the probe bounds audio.
async function audioParts(path, media, limits) {
	if (!media.audio || !bounded(limits.audio)) return [];
	const url = dataUrl("audio/wav", await extractAudio(path));
	return [{ type: "audio_url", audio_url: { url } }];
}

async function saveSteps(runDir, document) {
	const file = join(runDir, "steps.json");
	await writeFile(`${file}.tmp`, `${JSON.stringify(document, null, 2)}\n`);
	await rename(`${file}.tmp`, file);
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: one ordered pipeline (check media, try bounded video, fall back to frames, validate, save) reads best whole
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
	let audio;
	try {
		audio = await audioParts(path, media, limits);
	} catch {
		return {
			status: "refused_input",
			message: "audio track could not be extracted",
		};
	}
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
		const content = await framesContent(path, media.duration);
		if (!content)
			return {
				status: "refused_input",
				message: "frames could not be sampled",
			};
		result = await attempt("frames", content);
	}
	if (result.status !== "ok") return { status: result.status };
	const document = steps(result.output, mediaPath);
	if (!document)
		return {
			status: "malformed_output",
			message: "reply is not a valid steps document",
		};
	await saveSteps(runDir, document);
	return { status: "ok", document };
}

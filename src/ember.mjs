// The only Foley module that calls the network (DES-FOL-R01 to R03, R12).
// It enforces the $9.00 stop: every request reserves its priced upper bound in
// out/ledger.json under an exclusive lock before it is sent, and settles from
// the reply's usage. Unknown spend stays booked. Paths are relative to the cwd.
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import {
	appendFile,
	link,
	mkdir,
	readFile,
	rename,
	truncate,
	unlink,
	writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const BASE_URL = "https://api.meta.ai/v1";
const MODEL = "muse-ember-1.0";
const CAP = 9_000_000; // micro-dollars; a larger cap in the ledger is ignored
const MAX_INPUT_TOKENS = 200_000; // keeps every request in one price tier
const FRAME_TOKENS = 1_600;
const PRICE = { input: 100, cached: 4, output: 500 }; // thousandths of a micro-dollar per token
// A request above 200,000 input tokens is billed at this rate in full.
const PRICE_OVER_TIER = { input: 300, cached: 12, output: 1500 };
const MAX_INLINE_MEDIA = 50_000_000; // bytes, the API's inline media limit
// Video and audio ceilings come only from the live probe's bounds file.
const BOUNDS = new URL("../fixtures/ember/bounds.json", import.meta.url);
const LOCK_WAIT_MS = 10_000;
const LOCK_POLL_MS = 10;
const MAX_RETRY_AFTER_S = 60;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_FRAME_PX = 1_280;
const MAX_CASE_ID = 256;
const ROLES = new Set(["system", "user", "assistant"]);
// Ember defaults to "max", which can spend the whole output limit on reasoning.
const JSON_OBJECT = { type: "json_object" };
const EFFORTS = new Set(["minimal", "low", "medium", "high", "xhigh", "max"]);
const LOOPBACK = new Set(["127.0.0.1", "[::1]"]);
const PNG_SIGNATURE = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

const isCount = (n) => Number.isSafeInteger(n) && n >= 0;
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const micro = (milli) => Math.ceil(milli / 1000);
const booked = (ledger) => ledger.open.reduce((s, o) => s + o.upperBound, 0);
const total = (ledger) =>
	(ledger.baseline ?? 0) + ledger.settled + booked(ledger);

function paths() {
	const out = join(process.cwd(), "out");
	return {
		out,
		ledger: join(out, "ledger.json"),
		lock: join(out, "ledger.json.lock"),
		trace: join(out, "trace.jsonl"),
		prompts: join(out, "prompts"),
	};
}

// Configuration is read per call. Only the fixed model is allowed. Live calls use
// the fixed endpoint and MODEL_API_KEY; test mode uses its own synthetic
// FOLEY_TEST_API_KEY and only a literal loopback address.
function config() {
	const env = process.env;
	if (env.FOLEY_EMBER_MODEL && env.FOLEY_EMBER_MODEL !== MODEL) return null;
	if (env.FOLEY_OFFLINE !== "1") {
		if (env.FOLEY_EMBER_BASE_URL || !env.MODEL_API_KEY) return null;
		return { baseUrl: BASE_URL, live: true, key: env.MODEL_API_KEY };
	}
	const key = env.FOLEY_TEST_API_KEY;
	let url;
	try {
		url = new URL(env.FOLEY_EMBER_BASE_URL);
	} catch {
		return null;
	}
	const loopback =
		url.protocol === "http:" &&
		LOOPBACK.has(url.hostname) &&
		!url.username &&
		!url.password &&
		!url.search &&
		url.pathname.replace(/\/$/, "") === "/v1";
	return key && loopback
		? { baseUrl: `${url.origin}/v1`, live: false, key }
		: null;
}

// A frame is bounded only as an inline PNG of at most 1280 px on each axis.
function boundedFrame(url) {
	const data =
		typeof url === "string" &&
		/^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(url);
	if (!data) return null;
	const png = Buffer.from(data[1], "base64");
	if (
		png.length < 24 ||
		!png.subarray(0, 8).equals(PNG_SIGNATURE) ||
		png.toString("latin1", 12, 16) !== "IHDR"
	)
		return null;
	const width = png.readUInt32BE(16);
	const height = png.readUInt32BE(20);
	const bounded =
		width >= 1 &&
		height >= 1 &&
		width <= MAX_FRAME_PX &&
		height <= MAX_FRAME_PX;
	return bounded ? png : null;
}

// Duration in seconds from an MP4's movie header, or null when it has none.
function mp4Seconds(buf) {
	const box = (from, to, type) => {
		for (let at = from; at + 8 <= to; ) {
			let size = buf.readUInt32BE(at);
			let head = 8;
			if (size === 1) {
				if (at + 16 > to) return null;
				size = Number(buf.readBigUInt64BE(at + 8));
				head = 16;
			} else if (size === 0) size = to - at;
			if (size < head || at + size > to) return null;
			if (buf.toString("latin1", at + 4, at + 8) === type)
				return { start: at + head, end: at + size };
			at += size;
		}
		return null;
	};
	if (buf.length < 8 || buf.toString("latin1", 4, 8) !== "ftyp") return null;
	const moov = box(0, buf.length, "moov");
	const mvhd = moov && box(moov.start, moov.end, "mvhd");
	if (!mvhd) return null;
	const v1 = buf[mvhd.start] === 1;
	const at = mvhd.start + (v1 ? 20 : 12);
	if (at + (v1 ? 12 : 8) > mvhd.end) return null;
	const scale = buf.readUInt32BE(at);
	const length = v1
		? Number(buf.readBigUInt64BE(at + 4))
		: buf.readUInt32BE(at + 4);
	return scale > 0 && length > 0 ? length / scale : null;
}

// Duration in seconds of a PCM WAV; a streamed WAV's unknown data size is
// clipped to the bytes present.
function wavSeconds(buf) {
	if (
		buf.length < 12 ||
		buf.toString("latin1", 0, 4) !== "RIFF" ||
		buf.toString("latin1", 8, 12) !== "WAVE"
	)
		return null;
	let rate = 0;
	for (let at = 12; at + 8 <= buf.length; ) {
		const type = buf.toString("latin1", at, at + 4);
		const size = buf.readUInt32LE(at + 4);
		if (type === "fmt " && size >= 16 && at + 24 <= buf.length)
			rate = buf.readUInt32LE(at + 16);
		if (type === "data") {
			const bytes = Math.min(size, buf.length - at - 8);
			return rate > 0 && bytes > 0 ? bytes / rate : null;
		}
		at += 8 + size + (size % 2);
	}
	return null;
}

function mediaBounds() {
	try {
		return JSON.parse(readFileSync(BOUNDS, "utf8"));
	} catch {
		return {};
	}
}

const MEDIA = {
	video_url: {
		kind: "video",
		bytes: (part) =>
			/^data:video\/mp4;base64,([A-Za-z0-9+/]+={0,2})$/.exec(
				part.video_url?.url ?? "",
			)?.[1],
		seconds: mp4Seconds,
		blank: (part) => ({ ...part, video_url: { ...part.video_url, url: "" } }),
	},
	input_audio: {
		kind: "audio",
		bytes: (part) =>
			part.input_audio?.format === "wav" &&
			typeof part.input_audio.data === "string" &&
			/^[A-Za-z0-9+/]+={0,2}$/.test(part.input_audio.data)
				? part.input_audio.data
				: undefined,
		seconds: wavSeconds,
		blank: (part) => ({ ...part, input_audio: { format: "wav", data: "" } }),
	},
};

// A video or audio part is priced at its whole seconds times the probe's
// per-second ceiling, and refused without a ceiling or above its duration limit.
function mediaPart(part, bounds) {
	const media = MEDIA[part?.type];
	const limit = media && bounds[media.kind];
	const b64 = media?.bytes(part);
	const ok =
		b64 &&
		Number.isSafeInteger(limit?.ceilingTokensPerSecond) &&
		limit.ceilingTokensPerSecond > 0 &&
		typeof limit.maxSeconds === "number" &&
		b64.length * 0.75 <= MAX_INLINE_MEDIA;
	if (!ok) return { status: "budget_refused" };
	const bytes = Buffer.from(b64, "base64");
	const seconds = media.seconds(bytes);
	if (!seconds || seconds > limit.maxSeconds)
		return { status: "budget_refused" };
	const wire = { type: part.type, [part.type]: part[part.type] };
	return {
		tokens: Math.ceil(seconds) * limit.ceilingTokensPerSecond,
		wire,
		priced: media.blank(wire),
		kept: { type: part.type, sha256: sha256(bytes), seconds },
	};
}

// One content part as its wire, priced and kept views, or a refusal status.
// tokens is the part's priced allowance beyond its serialized bytes.
function copyPart(part, bounds) {
	if (part?.type === "text") {
		if (typeof part.text !== "string") return { status: "refused_input" };
		const copy = { type: "text", text: part.text };
		return { wire: copy, priced: copy, kept: copy };
	}
	if (MEDIA[part?.type]) return mediaPart(part, bounds);
	const url = part?.type === "image_url" && part.image_url?.url;
	const frame = boundedFrame(url);
	if (!frame) return { status: "budget_refused" };
	return {
		tokens: FRAME_TOKENS,
		wire: { type: "image_url", image_url: { url } },
		priced: { type: "image_url", image_url: { url: "" } },
		kept: { type: "image_url", sha256: sha256(frame) },
	};
}

// Validates the caller's messages once into an owned snapshot: the exact wire body
// as a string (later caller mutation cannot change what is sent or retried), its
// digest, its priced upper bound and the prompt record kept on disk.
// Bound: every UTF-8 byte of the serialized body counts as one input token at the
// uncached price, with each frame's URL counted as empty plus 1,600 tokens, plus
// the full output ceiling. Video and audio are bounded by the probe's ceilings.
function prepare(messages, maxOutput, key, effort) {
	if (!Array.isArray(messages) || messages.length === 0)
		return { status: "refused_input" };
	const lists = { wire: [], priced: [], kept: [] };
	const bounds = mediaBounds();
	let extra = 0;
	for (const message of messages) {
		if (!ROLES.has(message?.role)) return { status: "refused_input" };
		const { role, content } = message;
		if (typeof content === "string") {
			for (const list of Object.values(lists)) list.push({ role, content });
			continue;
		}
		if (!Array.isArray(content) || content.length === 0)
			return { status: "refused_input" };
		const parts = content.map((part) => copyPart(part, bounds));
		const refused = parts.find((part) => part.status);
		if (refused) return refused;
		extra += parts.reduce((sum, part) => sum + (part.tokens ?? 0), 0);
		for (const [view, list] of Object.entries(lists))
			list.push({ role, content: parts.map((part) => part[view]) });
	}
	const wire = lists.wire;
	const priced = lists.priced;
	const kept = lists.kept;
	if (!Number.isSafeInteger(maxOutput) || maxOutput <= 0)
		return { status: "budget_refused" };
	const body = (list) =>
		JSON.stringify({
			model: MODEL,
			messages: list,
			max_completion_tokens: maxOutput,
			// Every caller needs a JSON object; live, a reply once came back as prose.
			response_format: JSON_OBJECT,
			...(effort && { reasoning_effort: effort }),
		});
	const text = body(wire);
	if (text.includes(key)) return { status: "refused_input" };
	const tokens = Buffer.byteLength(body(priced)) + extra;
	if (tokens > MAX_INPUT_TOKENS) return { status: "budget_refused" };
	return {
		wire: text,
		digest: sha256(text),
		bound: micro(tokens * PRICE.input + maxOutput * PRICE.output),
		record: JSON.stringify({
			model: MODEL,
			max_completion_tokens: maxOutput,
			response_format: JSON_OBJECT,
			...(effort && { reasoning_effort: effort }),
			messages: kept,
		}),
	};
}

// Usage fields must be non-negative safe integers, or the cost is unknown.
function usageCost(usage) {
	const prompt = usage?.prompt_tokens;
	const output = usage?.completion_tokens;
	const cached = usage?.prompt_tokens_details?.cached_tokens ?? 0;
	const reasoning = usage?.completion_tokens_details?.reasoning_tokens ?? 0;
	if (![prompt, output, cached, reasoning].every(isCount) || cached > prompt)
		return null;
	const tokens = {
		input_tokens: prompt - cached,
		cached_input_tokens: cached,
		output_tokens: output, // already includes reasoning; reasoning is not charged again
		reasoning_tokens: reasoning,
	};
	const price = prompt > MAX_INPUT_TOKENS ? PRICE_OVER_TIER : PRICE;
	const cost = micro(
		tokens.input_tokens * price.input +
			cached * price.cached +
			output * price.output,
	);
	return { tokens, cost };
}

function alive(pid) {
	if (!Number.isSafeInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error.code === "EPERM";
	}
}

// Process start time in clock ticks (Linux /proc), so a reused pid is not mistaken
// for the process that made a reservation.
function processStart(pid) {
	try {
		const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
		return Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19]);
	} catch {
		return null;
	}
}

const START = processStart(process.pid);
const inFlight = new Set(); // reservations this process is still waiting on

// A reservation is owned only while its own process (same pid and start time) runs
// and, for this process, while the call still waits on it. Anything else, including
// a legacy record without a start time, is traced as recovery and stays booked.
function owned(o) {
	if (o.pid === process.pid && o.start === START && START !== null)
		return inFlight.has(o.callId);
	return (
		typeof o.start === "number" &&
		alive(o.pid) &&
		processStart(o.pid) === o.start
	);
}

// Exclusive lock: a complete owner record is hard-linked into place, so the lock
// never appears half-written. Every wait is bounded by monotonic time. A lock whose
// owner is dead fails closed and is never removed here: an operator quarantines it.
async function acquire(p) {
	const mine = `${p.lock}.${process.pid}.${randomUUID()}`;
	await writeFile(mine, JSON.stringify({ pid: process.pid }));
	try {
		const deadline = performance.now() + LOCK_WAIT_MS;
		while (performance.now() <= deadline) {
			try {
				await link(mine, p.lock);
				return true;
			} catch (error) {
				if (error.code !== "EEXIST") throw error;
			}
			let owner;
			try {
				owner = JSON.parse(await readFile(p.lock, "utf8")).pid;
			} catch (error) {
				if (error.code === "ENOENT") continue; // released meanwhile
				return false;
			}
			if (!alive(owner)) return false;
			await sleep(LOCK_POLL_MS);
		}
		return false;
	} finally {
		await unlink(mine).catch(() => {});
	}
}

// Every accounting field is validated; a malformed entry makes the ledger unreadable.
// Case counters move to a null-prototype object, so any case id is an ordinary key.
function validLedger(l) {
	if (!l || typeof l !== "object" || Array.isArray(l)) return false;
	if (!isCount(l.cap) || !isCount(l.settled) || !Array.isArray(l.open))
		return false;
	if (l.baseline !== null && !isCount(l.baseline)) return false;
	const ids = new Set();
	for (const o of l.open) {
		const valid =
			typeof o?.callId === "string" &&
			o.callId !== "" &&
			!ids.has(o.callId) &&
			isCount(o.upperBound) &&
			typeof o.caseId === "string";
		if (!valid) return false;
		ids.add(o.callId);
	}
	const cases = l.cases ?? {};
	const journal = l.journal ?? { seq: 0, pending: [] };
	return (
		typeof cases === "object" &&
		!Array.isArray(cases) &&
		Object.values(cases).every(isCount) &&
		isCount(journal.seq) &&
		Array.isArray(journal.pending) &&
		journal.pending.every(
			(e) => isCount(e?.event_id) && e.event_id <= journal.seq,
		) &&
		(l.stop === undefined || (typeof l.stop === "object" && l.stop !== null))
	);
}

async function readLedger(p) {
	try {
		const l = JSON.parse(await readFile(p.ledger, "utf8"));
		if (!validLedger(l)) return null;
		l.cases = Object.assign(Object.create(null), l.cases);
		return l;
	} catch {
		return null;
	}
}

async function writeLedger(p, ledger) {
	const tmp = `${p.ledger}.${process.pid}.${randomUUID()}.tmp`;
	await writeFile(tmp, JSON.stringify(ledger));
	await rename(tmp, p.ledger);
}

async function appendTrace(p, events) {
	await appendFile(
		p.trace,
		events.map((e) => `${JSON.stringify(e)}\n`).join(""),
	);
}

// Reads the trace, first cutting off a partial last line left by an interrupted append.
async function readTrace(p) {
	let text;
	try {
		text = await readFile(p.trace, "utf8");
	} catch (error) {
		if (error.code === "ENOENT") return [];
		throw error;
	}
	const end = text.lastIndexOf("\n") + 1;
	if (end < text.length) await truncate(p.trace, end);
	return text
		.slice(0, end)
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line));
}

const refusalEvent = (outcome) => ({ type: "refusal", outcome });

// One ledger transaction under the lock. fn(ledger, healthy) returns
// { value, write?, events?, refusal?, ledger? }. Events that record a ledger change
// are journaled in the ledger before they are appended, so a lost or partial append
// is replayed by the next transaction (by event id, without duplicates). Recovery
// events are derived again from ledger and trace. A refusal is appended directly and
// journaled only if that append fails. Storage errors throw to the caller.
async function transaction(p, fn) {
	await mkdir(p.out, { recursive: true });
	if (!(await acquire(p))) return { value: "ledger_unreadable" };
	try {
		return await locked(p, fn);
	} finally {
		await unlink(p.lock);
	}
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one locked read-replay-apply-write transaction; recovery tracing must stay inside the lock
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: same transaction as above
async function locked(p, fn) {
	const ledger = await readLedger(p);
	const journal = ledger?.journal ?? { seq: 0, pending: [] };
	let pending = journal.pending;
	let healthy = Boolean(ledger);
	if (ledger) {
		try {
			const events = await readTrace(p);
			const last = events.reduce((m, e) => Math.max(m, e.event_id ?? 0), 0);
			pending = pending.filter((e) => e.event_id > last);
			if (pending.length) await appendTrace(p, pending);
			events.push(...pending);
			pending = [];
			const traced = new Set(
				events.filter((e) => e.booked_micro_usd).map((e) => e.callId),
			);
			const recoveries = ledger.open
				.filter((o) => !traced.has(o.callId) && !owned(o))
				.map((o) => ({
					type: "recovery",
					callId: o.callId,
					caseId: o.caseId,
					...(o.stage && { stage: o.stage }),
					booked_micro_usd: o.upperBound,
					cap_ledger_micro_usd: total(ledger),
				}));
			if (recoveries.length) await appendTrace(p, recoveries);
		} catch {
			healthy = false;
		}
	}
	const r = fn(ledger, healthy);
	const target = r.ledger ?? ledger;
	if (!target) {
		if (r.refusal) await appendTrace(p, [r.refusal]).catch(() => {});
		return { value: r.value };
	}
	let { seq } = journal;
	const stamp = (e) =>
		Object.assign(e, { event_id: ++seq, cap_ledger_micro_usd: total(target) });
	const events = (r.events ?? []).map(stamp);
	if (r.write || events.length) {
		target.journal = { seq, pending: [...pending, ...events] };
		await writeLedger(p, target);
		try {
			if (target.journal.pending.length)
				await appendTrace(p, target.journal.pending);
		} catch {
			return { value: r.value, traceFailed: true };
		}
	}
	if (r.refusal) {
		const refusal = { ...r.refusal, cap_ledger_micro_usd: total(target) };
		try {
			await appendTrace(p, [refusal]);
		} catch {
			stamp(refusal); // before reading seq, which stamp advances
			target.journal = { seq, pending: [...pending, refusal] };
			await writeLedger(p, target);
			return { value: "ledger_unreadable" };
		}
	}
	return { value: r.value };
}

async function reserve(p, { callId, bound, caseId, stage, caseBudget, live }) {
	try {
		const { value } = await transaction(p, (ledger, healthy) => {
			if (!ledger || !healthy)
				return {
					value: "ledger_unreadable",
					refusal: refusalEvent("ledger_unreadable"),
				};
			const caseOpen = ledger.open
				.filter((o) => o.caseId === caseId)
				.reduce((s, o) => s + o.upperBound, 0);
			const caseSpent = (ledger.cases[caseId] ?? 0) + caseOpen;
			const refused =
				ledger.stop !== undefined ||
				(live && ledger.baseline === null) ||
				total(ledger) + bound > Math.min(ledger.cap, CAP) ||
				(caseBudget !== undefined && caseSpent + bound > caseBudget);
			if (refused)
				return {
					value: "budget_refused",
					refusal: refusalEvent("budget_refused"),
				};
			ledger.open.push({
				callId,
				upperBound: bound,
				caseId,
				...(stage && { stage }),
				pid: process.pid,
				start: START,
			});
			inFlight.add(callId);
			return { value: "ok", write: true };
		});
		if (value !== "ok") inFlight.delete(callId);
		return value;
	} catch (error) {
		inFlight.delete(callId);
		throw error;
	}
}

// Known usage moves the reservation to settled, in full even above its bound; a
// bound violation stops all later admission until an operator clears ledger.stop.
// Unknown usage keeps the reservation booked. Returns false if not fully recorded.
async function settle(p, callId, usage, meta) {
	const { value, traceFailed } = await transaction(p, (ledger) => {
		const open = ledger?.open.find((o) => o.callId === callId);
		if (!open) return { value: false };
		// The case and stage travel with the call record, in the same transaction.
		const event = {
			...meta,
			callId,
			caseId: open.caseId,
			...(open.stage && { stage: open.stage }),
			...usage?.tokens,
		};
		if (!usage)
			return {
				value: true,
				events: [{ ...event, booked_micro_usd: open.upperBound }],
			};
		ledger.open = ledger.open.filter((o) => o !== open);
		ledger.settled += usage.cost;
		ledger.cases[open.caseId] = (ledger.cases[open.caseId] ?? 0) + usage.cost;
		event.cost_micro_usd = usage.cost;
		if (usage.cost > open.upperBound) {
			event.bound_violated = true;
			ledger.stop = {
				callId,
				upper_bound_micro_usd: open.upperBound,
				cost_micro_usd: usage.cost,
			};
		}
		return { value: true, events: [event] };
	});
	return value === true && !traceFailed;
}

const MAX_IMAGES = 50; // per request, the API's limit

// Copies a JSON value, replacing each string with fn(string); fn may throw.
const mapStrings = (value, fn) =>
	typeof value === "string"
		? fn(value)
		: Array.isArray(value)
			? value.map((v) => mapStrings(v, fn))
			: value !== null && typeof value === "object"
				? Object.fromEntries(
						Object.entries(value).map(([k, v]) => [k, mapStrings(v, fn)]),
					)
				: value;

// Native computer use on the Responses API, stateless (store false): the caller
// replays the whole history, so every input token is in the priced body. Each
// data: URL must be a bounded PNG frame; it is priced at 1,600 tokens and kept
// on disk as its digest.
function prepareResponses(o, key) {
	const { input, instructions, max_output_tokens: maxOutput } = o;
	const effort = o.reasoning_effort;
	if (
		!Array.isArray(input) ||
		input.length === 0 ||
		(instructions !== undefined && typeof instructions !== "string")
	)
		return { status: "refused_input" };
	if (!Number.isSafeInteger(maxOutput) || maxOutput < 16)
		return { status: "budget_refused" };
	let frames = 0;
	const view = (blank) => (text) => {
		if (!text.startsWith("data:")) return text;
		const frame = boundedFrame(text);
		if (!frame) throw new RangeError("unbounded media");
		if (blank) frames++;
		return blank ? "" : `sha256:${sha256(frame)}`;
	};
	let priced;
	let kept;
	try {
		priced = mapStrings(input, view(true));
		kept = mapStrings(input, view(false));
	} catch {
		return { status: "budget_refused" };
	}
	const body = (items) =>
		JSON.stringify({
			model: MODEL,
			...(instructions !== undefined && { instructions }),
			input: items,
			tools: [{ type: "computer" }],
			max_output_tokens: maxOutput,
			...(effort && { reasoning: { effort } }),
			store: false,
			include: ["reasoning.encrypted_content"],
		});
	const text = body(input);
	if (text.includes(key)) return { status: "refused_input" };
	const tokens = Buffer.byteLength(body(priced)) + frames * FRAME_TOKENS;
	if (tokens > MAX_INPUT_TOKENS || frames > MAX_IMAGES)
		return { status: "budget_refused" };
	return {
		wire: text,
		digest: sha256(text),
		bound: micro(tokens * PRICE.input + maxOutput * PRICE.output),
		record: body(kept),
	};
}

// The reply must carry a JSON object as a string. Live, Ember often writes a
// sentence before the object even in JSON mode; the object is taken from the
// first "{" that starts one, and the leading text is discarded.
function chatOutput(reply) {
	const content = reply?.choices?.[0]?.message?.content;
	if (typeof content !== "string") return { content };
	const end = content.lastIndexOf("}");
	for (let at = content.indexOf("{"); at >= 0 && at < end; ) {
		try {
			const output = JSON.parse(content.slice(at, end + 1));
			const object =
				output !== null && typeof output === "object" && !Array.isArray(output);
			return { output: object ? output : undefined, content };
		} catch {
			at = content.indexOf("{", at + 1);
		}
	}
	return { content };
}

const PROTOCOLS = {
	chat: {
		path: "/chat/completions",
		prepare: (o, key) =>
			prepare(o.messages, o.max_output_tokens, key, o.reasoning_effort),
		usage: (u) => u,
		finish: (reply) => reply?.choices?.[0]?.finish_reason,
		output: chatOutput,
	},
	responses: {
		path: "/responses",
		prepare: prepareResponses,
		usage: (u) => ({
			prompt_tokens: u?.input_tokens,
			completion_tokens: u?.output_tokens,
			prompt_tokens_details: {
				cached_tokens: u?.input_tokens_details?.cached_tokens,
			},
			completion_tokens_details: {
				reasoning_tokens: u?.output_tokens_details?.reasoning_tokens,
			},
		}),
		finish: (reply) => reply?.incomplete_details?.reason ?? reply?.status,
		// The output items (computer calls, messages, reasoning) are returned as
		// data for the caller to validate.
		output: (reply) =>
			Array.isArray(reply?.output)
				? { output: { status: reply.status, items: reply.output } }
				: {},
	},
};

// One HTTP exchange. Error text never includes the reply body, which may echo the key.
async function send(cfg, wire, timeoutMs, protocol) {
	let res;
	try {
		res = await fetch(`${cfg.baseUrl}${protocol.path}`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${cfg.key}`,
			},
			body: wire,
			signal: AbortSignal.timeout(timeoutMs),
			redirect: "error",
		});
	} catch (error) {
		return {
			status: error.name === "TimeoutError" ? "timeout" : "api_error",
			message: "request failed",
		};
	}
	if (!res.ok) {
		await res.body?.cancel().catch(() => {});
		if (res.status === 429)
			return {
				status: "rate_limited",
				retryAfter: res.headers.get("retry-after"),
			};
		return {
			status: res.status === 400 ? "refused_input" : "api_error",
			message: `HTTP ${res.status}`,
		};
	}
	let reply;
	try {
		reply = await res.json();
	} catch (error) {
		return {
			status: error.name === "TimeoutError" ? "timeout" : "malformed_output",
			message: "unreadable reply",
		};
	}
	const usage = usageCost(protocol.usage(reply?.usage));
	if (!usage)
		return { status: "malformed_output", message: "reply has no usage" };
	// The API's own usage and stop reason, for reconciliation; counts only.
	const api = JSON.parse(
		JSON.stringify({
			usage: reply.usage,
			finish_reason: protocol.finish(reply),
		}),
	);
	// The output must not echo the key.
	const { output, content } = protocol.output(reply);
	const valid =
		output !== undefined && !JSON.stringify(output).includes(cfg.key);
	if (!valid) {
		if (typeof content === "string" && !content.includes(cfg.key))
			api.content_head = content.slice(0, 2000);
		return {
			status: "malformed_output",
			usage,
			api,
			message: "reply content is not a JSON object",
		};
	}
	return { status: "ok", usage, api, output };
}

// Never throws: storage and lock failures become ledger_unreadable, with booked
// spend left in the ledger and no exception text returned.
export async function callEmber(options = {}) {
	try {
		return await call(options, PROTOCOLS.chat);
	} catch {
		return { status: "ledger_unreadable", message: "ledger storage failed" };
	}
}

// Native computer use: { input, instructions?, max_output_tokens, reasoning_effort?,
// caseId, caseBudget?, stage?, timeoutMs? }, with the same reservation, settlement
// and refusals as callEmber. Its output is { status, items } from the response.
export async function callEmberComputer(options = {}) {
	try {
		return await call(options, PROTOCOLS.responses);
	} catch {
		return { status: "ledger_unreadable", message: "ledger storage failed" };
	}
}

async function refuse(p, status) {
	const { value } = await transaction(p, (ledger) => ({
		value: status,
		refusal: refusalEvent(status),
		ledger,
	}));
	return { status: value };
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: one validated reserve-send-settle sequence with its single retry
async function call(options, protocol) {
	const {
		reasoning_effort,
		caseId,
		caseBudget,
		stage,
		timeoutMs = DEFAULT_TIMEOUT_MS,
	} = options;
	const p = paths();
	const cfg = config();
	const valid =
		cfg &&
		typeof caseId === "string" &&
		caseId !== "" &&
		caseId.length <= MAX_CASE_ID &&
		!caseId.includes(cfg.key) &&
		(stage === undefined || /^[a-z]{1,32}$/.test(stage)) &&
		(caseBudget === undefined || isCount(caseBudget)) &&
		(reasoning_effort === undefined || EFFORTS.has(reasoning_effort)) &&
		Number.isSafeInteger(timeoutMs) &&
		timeoutMs > 0;
	if (!valid) return refuse(p, "refused_input");
	const req = protocol.prepare(options, cfg.key);
	if (req.status) return refuse(p, req.status);
	await mkdir(p.prompts, { recursive: true });
	await writeFile(join(p.prompts, `${req.digest}.json`), req.record);
	const meta = { type: "request", model: MODEL, request_digest: req.digest };
	for (let attempt = 0; ; attempt++) {
		const callId = randomUUID();
		const reserved = await reserve(p, {
			callId,
			bound: req.bound,
			caseId,
			stage,
			caseBudget,
			live: cfg.live,
		});
		if (reserved !== "ok")
			return attempt
				? { status: "rate_limited", message: "retry not sent" }
				: { status: reserved };
		let r;
		let recorded;
		try {
			r = await send(cfg, req.wire, timeoutMs, protocol);
			recorded = await settle(p, callId, r.usage, {
				...meta,
				outcome: r.status,
			});
		} finally {
			inFlight.delete(callId);
		}
		if (!recorded)
			return {
				status: "ledger_unreadable",
				message: "settlement not recorded",
			};
		const wait = Number(r.retryAfter ?? 0);
		const retry =
			r.status === "rate_limited" &&
			attempt === 0 &&
			wait >= 0 &&
			wait <= MAX_RETRY_AFTER_S;
		if (!retry)
			return {
				status: r.status,
				...(r.output !== undefined && { output: r.output }),
				...(r.api &&
					!JSON.stringify(r.api).includes(cfg.key) && { api: r.api }),
				...(r.message && { message: r.message }),
			};
		await sleep(wait * 1000); // one retry, honouring Retry-After, with its own reservation
	}
}

// Records the owner's spend before Foley's first live call. Creates the ledger when
// absent; refuses to overwrite a recorded baseline or an unreadable ledger. A baseline
// committed while the trace append fails is replayed by the next locked call.
export async function recordBaseline(microUsd) {
	if (!isCount(microUsd))
		throw new TypeError(
			"baseline must be a non-negative integer of micro-dollars",
		);
	const p = paths();
	const { value, traceFailed } = await transaction(p, (current) => {
		if (!current && existsSync(p.ledger))
			throw new Error("ledger is unreadable");
		const ledger = current ?? {
			cap: CAP,
			baseline: null,
			settled: 0,
			open: [],
			cases: Object.create(null),
		};
		if (ledger.baseline !== null)
			throw new Error("baseline is already recorded");
		ledger.baseline = microUsd;
		const event = { type: "baseline", baseline_micro_usd: microUsd };
		return { value: { baseline: microUsd }, events: [event], ledger };
	});
	if (value === "ledger_unreadable")
		throw new Error("ledger lock is held by a dead or stuck process");
	if (traceFailed)
		throw new Error(
			"baseline recorded; trace append failed and will be replayed",
		);
	return value;
}

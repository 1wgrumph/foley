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
const LOCK_WAIT_MS = 10_000;
const LOCK_POLL_MS = 10;
const MAX_RETRY_AFTER_S = 60;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_FRAME_PX = 1_280;
const MAX_CASE_ID = 256;
const ROLES = new Set(["system", "user", "assistant"]);
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

// Validates the caller's messages once into an owned snapshot: the exact wire body
// as a string (later caller mutation cannot change what is sent or retried), its
// digest, its priced upper bound and the prompt record kept on disk.
// Bound: every UTF-8 byte of the serialized body counts as one input token at the
// uncached price, with each frame's URL counted as empty plus 1,600 tokens, plus
// the full output ceiling. Video, audio and other parts have no measured bound.
function prepare(messages, maxOutput, key) {
	if (!Array.isArray(messages) || messages.length === 0)
		return { status: "refused_input" };
	const wire = [];
	const priced = [];
	const kept = [];
	let frames = 0;
	for (const message of messages) {
		if (!ROLES.has(message?.role)) return { status: "refused_input" };
		const role = message.role;
		if (typeof message.content === "string") {
			const copy = { role, content: message.content };
			wire.push(copy);
			priced.push(copy);
			kept.push(copy);
			continue;
		}
		if (!Array.isArray(message.content) || message.content.length === 0)
			return { status: "refused_input" };
		const parts = { wire: [], priced: [], kept: [] };
		for (const part of message.content) {
			if (part?.type === "text") {
				if (typeof part.text !== "string") return { status: "refused_input" };
				const copy = { type: "text", text: part.text };
				parts.wire.push(copy);
				parts.priced.push(copy);
				parts.kept.push(copy);
				continue;
			}
			const url = part?.type === "image_url" && part.image_url?.url;
			const frame = boundedFrame(url);
			if (!frame) return { status: "budget_refused" };
			frames++;
			parts.wire.push({ type: "image_url", image_url: { url } });
			parts.priced.push({ type: "image_url", image_url: { url: "" } });
			parts.kept.push({ type: "image_url", sha256: sha256(frame) });
		}
		wire.push({ role, content: parts.wire });
		priced.push({ role, content: parts.priced });
		kept.push({ role, content: parts.kept });
	}
	if (!Number.isSafeInteger(maxOutput) || maxOutput <= 0)
		return { status: "budget_refused" };
	const body = (list) =>
		JSON.stringify({
			model: MODEL,
			messages: list,
			max_completion_tokens: maxOutput,
		});
	const text = body(wire);
	if (text.includes(key)) return { status: "refused_input" };
	const tokens = Buffer.byteLength(body(priced)) + frames * FRAME_TOKENS;
	if (tokens > MAX_INPUT_TOKENS) return { status: "budget_refused" };
	return {
		wire: text,
		digest: sha256(text),
		bound: micro(tokens * PRICE.input + maxOutput * PRICE.output),
		record: JSON.stringify({
			model: MODEL,
			max_completion_tokens: maxOutput,
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
	const cost = micro(
		tokens.input_tokens * PRICE.input +
			cached * PRICE.cached +
			output * PRICE.output,
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

async function reserve(p, { callId, bound, caseId, caseBudget, live }) {
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
		const event = { ...meta, callId, ...usage?.tokens };
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

// One HTTP exchange. Error text never includes the reply body, which may echo the key.
async function send(cfg, wire, timeoutMs) {
	let res;
	try {
		res = await fetch(`${cfg.baseUrl}/chat/completions`, {
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
	const usage = usageCost(reply?.usage);
	if (!usage)
		return { status: "malformed_output", message: "reply has no usage" };
	// The reply must carry a JSON object as a string, and must not echo the key.
	const content = reply?.choices?.[0]?.message?.content;
	let output;
	try {
		output = typeof content === "string" ? JSON.parse(content) : undefined;
	} catch {
		output = undefined;
	}
	const valid =
		output !== null &&
		typeof output === "object" &&
		!Array.isArray(output) &&
		!JSON.stringify(output).includes(cfg.key);
	if (!valid)
		return {
			status: "malformed_output",
			usage,
			message: "reply content is not a JSON object",
		};
	return { status: "ok", usage, output };
}

// Never throws: storage and lock failures become ledger_unreadable, with booked
// spend left in the ledger and no exception text returned.
export async function callEmber(options = {}) {
	try {
		return await call(options);
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

async function call({
	messages,
	max_output_tokens,
	caseId,
	caseBudget,
	timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
	const p = paths();
	const cfg = config();
	const valid =
		cfg &&
		typeof caseId === "string" &&
		caseId !== "" &&
		caseId.length <= MAX_CASE_ID &&
		!caseId.includes(cfg.key) &&
		(caseBudget === undefined || isCount(caseBudget)) &&
		Number.isSafeInteger(timeoutMs) &&
		timeoutMs > 0;
	if (!valid) return refuse(p, "refused_input");
	const req = prepare(messages, max_output_tokens, cfg.key);
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
			r = await send(cfg, req.wire, timeoutMs);
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

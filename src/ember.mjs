// The only Foley module that calls the network (DES-FOL-R01 to R03, R12).
// It enforces the $9.00 stop: every request reserves its priced upper bound in
// out/ledger.json under an exclusive lock before it is sent, and settles from
// the reply's usage. Unknown spend stays booked. Paths are relative to the cwd.
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
	appendFile,
	link,
	mkdir,
	readFile,
	rename,
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

// Configuration is read per call. Only the fixed model is allowed; the base URL
// override exists only in test mode and only for a loopback address.
function config() {
	const env = process.env;
	const key = env.MODEL_API_KEY;
	const test = env.FOLEY_OFFLINE === "1";
	if (!key || (env.FOLEY_EMBER_MODEL && env.FOLEY_EMBER_MODEL !== MODEL))
		return null;
	if (!env.FOLEY_EMBER_BASE_URL)
		return test ? null : { baseUrl: BASE_URL, live: true, key };
	if (!test) return null;
	let url;
	try {
		url = new URL(env.FOLEY_EMBER_BASE_URL);
	} catch {
		return null;
	}
	const loopback =
		url.protocol === "http:" &&
		["127.0.0.1", "[::1]", "localhost"].includes(url.hostname) &&
		url.pathname.replace(/\/$/, "") === "/v1";
	return loopback ? { baseUrl: `${url.origin}/v1`, live: false, key } : null;
}

// Upper bound in micro-dollars: text counts one token per UTF-8 byte, each frame
// 1,600 tokens, all input at the uncached price, plus the full output limit.
// Video, audio and unknown parts have no measured bound yet, so they refuse.
function priceBound(messages, maxOutput) {
	if (!Number.isSafeInteger(maxOutput) || maxOutput <= 0) return null;
	let tokens = 0;
	for (const message of messages) {
		const parts =
			typeof message?.content === "string"
				? [{ type: "text", text: message.content }]
				: message?.content;
		if (!Array.isArray(parts)) return null;
		for (const part of parts) {
			if (part?.type === "text" && typeof part.text === "string")
				tokens += Buffer.byteLength(part.text);
			else if (
				part?.type === "image_url" &&
				typeof part.image_url?.url === "string"
			)
				tokens += FRAME_TOKENS;
			else return null;
		}
	}
	if (tokens > MAX_INPUT_TOKENS) return null;
	return micro(tokens * PRICE.input + maxOutput * PRICE.output);
}

function usageCost(usage) {
	const prompt = usage?.prompt_tokens;
	const output = usage?.completion_tokens;
	const cached = usage?.prompt_tokens_details?.cached_tokens ?? 0;
	if (
		!isCount(prompt) ||
		!isCount(output) ||
		!isCount(cached) ||
		cached > prompt
	)
		return null;
	const tokens = {
		input_tokens: prompt - cached,
		cached_input_tokens: cached,
		output_tokens: output, // already includes reasoning; reasoning is not charged again
		reasoning_tokens: usage.completion_tokens_details?.reasoning_tokens ?? 0,
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

// Exclusive lock: a complete owner record is hard-linked into place, so the lock
// never appears half-written. A lock whose owner is dead is reported, never removed.
async function withLock(p, fn) {
	await mkdir(p.out, { recursive: true });
	const mine = `${p.lock}.${process.pid}.${randomUUID()}`;
	await writeFile(mine, JSON.stringify({ pid: process.pid }));
	try {
		const deadline = Date.now() + LOCK_WAIT_MS;
		for (;;) {
			try {
				await link(mine, p.lock);
				break;
			} catch (error) {
				if (error.code !== "EEXIST") throw error;
			}
			let owner;
			try {
				owner = JSON.parse(await readFile(p.lock, "utf8")).pid;
			} catch (error) {
				if (error.code === "ENOENT") continue; // released meanwhile
				return null;
			}
			if (!alive(owner) || Date.now() > deadline) return null;
			await sleep(LOCK_POLL_MS);
		}
	} finally {
		await unlink(mine).catch(() => {});
	}
	try {
		return { value: await fn() };
	} finally {
		await unlink(p.lock);
	}
}

async function readLedger(p) {
	try {
		const l = JSON.parse(await readFile(p.ledger, "utf8"));
		const valid =
			isCount(l?.cap) &&
			(l.baseline === null || isCount(l.baseline)) &&
			isCount(l.settled) &&
			Array.isArray(l.open) &&
			l.open.every(
				(o) => typeof o?.callId === "string" && isCount(o.upperBound),
			);
		return valid ? l : null;
	} catch {
		return null;
	}
}

async function writeLedger(p, ledger) {
	const tmp = `${p.ledger}.${process.pid}.${randomUUID()}.tmp`;
	await writeFile(tmp, JSON.stringify(ledger));
	await rename(tmp, p.ledger);
}

async function trace(p, event) {
	try {
		await appendFile(p.trace, `${JSON.stringify(event)}\n`);
	} catch {
		// The ledger stays authoritative; the next locked call traces the difference.
	}
}

async function refusal(p, outcome) {
	const ledger = await readLedger(p);
	await trace(p, {
		type: "refusal",
		outcome,
		...(ledger && { cap_ledger_micro_usd: total(ledger) }),
	});
	return { status: outcome };
}

// Under the lock: trace settled cost the trace lacks, and reservations left open
// by dead processes. The ledger itself is not changed.
async function recover(p, ledger) {
	let events;
	try {
		events = (await readFile(p.trace, "utf8"))
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line));
	} catch (error) {
		if (error.code !== "ENOENT") return;
		events = [];
	}
	const cost = events.reduce((s, e) => s + (e.cost_micro_usd ?? 0), 0);
	if (ledger.settled > cost)
		await trace(p, {
			type: "recovery",
			cost_micro_usd: ledger.settled - cost,
			cap_ledger_micro_usd: total(ledger),
		});
	const traced = new Set(
		events.filter((e) => e.booked_micro_usd).map((e) => e.callId),
	);
	for (const o of ledger.open) {
		if (traced.has(o.callId) || alive(o.pid)) continue;
		await trace(p, {
			type: "recovery",
			callId: o.callId,
			booked_micro_usd: o.upperBound,
			cap_ledger_micro_usd: total(ledger),
		});
	}
}

async function reserve(p, { callId, bound, caseId, caseBudget, live }) {
	const locked = await withLock(p, async () => {
		const ledger = await readLedger(p);
		if (!ledger) return "ledger_unreadable";
		await recover(p, ledger);
		const caseOpen = ledger.open
			.filter((o) => o.caseId === caseId)
			.reduce((s, o) => s + o.upperBound, 0);
		const caseSpent = (ledger.cases?.[caseId] ?? 0) + caseOpen;
		const refused =
			(live && ledger.baseline === null) ||
			total(ledger) + bound > Math.min(ledger.cap, CAP) ||
			(caseBudget !== undefined && caseSpent + bound > caseBudget);
		if (refused) return "budget_refused";
		ledger.open.push({ callId, upperBound: bound, caseId, pid: process.pid });
		await writeLedger(p, ledger);
		return "ok";
	});
	const status = locked?.value ?? "ledger_unreadable";
	if (status !== "ok") await refusal(p, status);
	return status;
}

// Known usage moves the reservation to settled; unknown usage keeps it booked.
async function settle(p, callId, cost, event) {
	await withLock(p, async () => {
		const ledger = await readLedger(p);
		const open = ledger?.open.find((o) => o.callId === callId);
		if (!open) return;
		if (cost === null) {
			await trace(p, {
				...event,
				callId,
				booked_micro_usd: open.upperBound,
				cap_ledger_micro_usd: total(ledger),
			});
			return;
		}
		ledger.open = ledger.open.filter((o) => o !== open);
		ledger.settled += cost;
		ledger.cases = {
			...ledger.cases,
			[open.caseId]: (ledger.cases?.[open.caseId] ?? 0) + cost,
		};
		await writeLedger(p, ledger);
		await trace(p, {
			...event,
			callId,
			cost_micro_usd: cost,
			cap_ledger_micro_usd: total(ledger),
		});
	});
}

// Prompt text is kept by digest; media is kept only as the SHA-256 of its bytes.
async function storePrompt(p, messages, maxOutput) {
	const mediaDigest = (url) => {
		const data = /^data:[^,]*;base64,(.*)$/s.exec(url);
		return sha256(data ? Buffer.from(data[1], "base64") : url);
	};
	const redacted = messages.map((m) => ({
		role: m.role,
		content:
			typeof m.content === "string"
				? m.content
				: m.content.map((part) =>
						part.type === "text"
							? part
							: { type: part.type, sha256: mediaDigest(part.image_url.url) },
					),
	}));
	const text = JSON.stringify({
		model: MODEL,
		max_output_tokens: maxOutput,
		messages: redacted,
	});
	const digest = sha256(text);
	await mkdir(p.prompts, { recursive: true });
	await writeFile(join(p.prompts, `${digest}.json`), text);
	return digest;
}

// One HTTP exchange. Error text never includes the reply body, which may echo the key.
async function send(cfg, body, timeoutMs) {
	let res;
	try {
		res = await fetch(`${cfg.baseUrl}/chat/completions`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${cfg.key}`,
			},
			body: JSON.stringify(body),
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
	try {
		return {
			status: "ok",
			usage,
			output: JSON.parse(reply.choices[0].message.content),
		};
	} catch {
		return {
			status: "malformed_output",
			usage,
			message: "reply content is not JSON",
		};
	}
}

export async function callEmber({
	messages,
	max_output_tokens,
	caseId,
	caseBudget,
	timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
	const p = paths();
	const cfg = config();
	const valid =
		cfg &&
		typeof caseId === "string" &&
		caseId !== "" &&
		(caseBudget === undefined || isCount(caseBudget)) &&
		Number.isSafeInteger(timeoutMs) &&
		timeoutMs > 0 &&
		Array.isArray(messages) &&
		messages.length > 0;
	if (!valid) return refusal(p, "refused_input");
	const bound = priceBound(messages, max_output_tokens);
	if (bound === null) return refusal(p, "budget_refused");
	const digest = await storePrompt(p, messages, max_output_tokens);
	const body = {
		model: MODEL,
		messages,
		max_completion_tokens: max_output_tokens,
	};
	for (let attempt = 0; ; attempt++) {
		const callId = randomUUID();
		const reserved = await reserve(p, {
			callId,
			bound,
			caseId,
			caseBudget,
			live: cfg.live,
		});
		if (reserved !== "ok")
			return attempt
				? { status: "rate_limited", message: `retry not sent: ${reserved}` }
				: { status: reserved };
		const r = await send(cfg, body, timeoutMs);
		await settle(p, callId, r.usage?.cost ?? null, {
			type: "request",
			model: MODEL,
			request_digest: digest,
			outcome: r.status,
			...r.usage?.tokens,
		});
		const wait = Number(r.retryAfter ?? 0);
		if (
			r.status !== "rate_limited" ||
			attempt > 0 ||
			!(wait >= 0 && wait <= MAX_RETRY_AFTER_S)
		)
			return {
				status: r.status,
				...(r.output !== undefined && { output: r.output }),
				...(r.message && { message: r.message }),
			};
		await sleep(wait * 1000); // one retry, honouring Retry-After, with its own reservation
	}
}

// Records the owner's spend before Foley's first live call. Creates the ledger
// when absent; refuses to overwrite a recorded baseline or an unreadable ledger.
export async function recordBaseline(microUsd) {
	if (!isCount(microUsd))
		throw new TypeError(
			"baseline must be a non-negative integer of micro-dollars",
		);
	const p = paths();
	const locked = await withLock(p, async () => {
		let ledger = await readLedger(p);
		if (!ledger) {
			if (existsSync(p.ledger)) throw new Error("ledger is unreadable");
			ledger = { cap: CAP, baseline: null, settled: 0, open: [] };
		}
		if (ledger.baseline !== null)
			throw new Error("baseline is already recorded");
		ledger.baseline = microUsd;
		await writeLedger(p, ledger);
		await trace(p, {
			type: "baseline",
			baseline_micro_usd: microUsd,
			cap_ledger_micro_usd: total(ledger),
		});
		return { baseline: microUsd, cap_ledger_micro_usd: total(ledger) };
	});
	if (!locked)
		throw new Error("ledger lock is held by a dead or stuck process");
	return locked.value;
}

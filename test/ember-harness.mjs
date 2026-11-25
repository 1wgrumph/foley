/*
 * Public contract selected where the design leaves names open:
 * callEmber({messages, max_output_tokens, caseId, caseBudget?, timeoutMs?})
 * -> Promise<{status: closed result, output?: parsed JSON, message?: string}>.
 * recordBaseline(microUsd) records the owner-supplied baseline.
 * Each call reads MODEL_API_KEY or FOLEY_TEST_API_KEY, FOLEY_OFFLINE (1 enables the local test URL),
 * FOLEY_EMBER_BASE_URL and FOLEY_EMBER_MODEL (only the fixed model is allowed).
 * Relative to cwd: out/ledger.json, out/ledger.json.lock, out/trace.jsonl,
 * out/prompts/<request_digest>.json (media stored by SHA-256 of decoded bytes).
 * Ledger open entries: callId, upperBound,
 * caseId; lock owner: {pid}. Baseline null means unset.
 * Count serialized UTF-8 wire bytes including framing; bounded images add
 * 1600 tokens instead of their encoded URL bytes. Use integer micro-dollar
 * arithmetic; never trust a caller's dollar estimate. Unknown media bounds and missing output limits refuse.
 * Trace: type, outcome, model, request_digest, input_tokens (uncached),
 * cached_input_tokens, output_tokens, reasoning_tokens, cost_micro_usd,
 * booked_micro_usd, baseline_micro_usd (baseline event), cap_ledger_micro_usd.
 * Cost and booked fields are event deltas; recovery adds only untraced amounts.
 * Resource group: ephemeral loopback port and unique temporary directory.
 */
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { EventEmitter, once } from "node:events";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { startFakeServer } from "./fake-server.mjs";

const cap = 9_000_000;
const model = "muse-ember-1.0";
const secret = "synthetic-ember-test-only";
const moduleUrl = new URL("../src/ember.mjs", import.meta.url);
const workerPath = fileURLToPath(
	new URL("../fixtures/ember/worker.mjs", import.meta.url),
);
const smallUsage = { prompt_tokens: 10, completion_tokens: 2 };
const originalFetch = globalThis.fetch;
let activeOrigin;
let attemptedExternal = [];
let simulateLive = false;
let liveTargets = [];
let redirectViolations = [];
globalThis.fetch = (input, init) => {
	const url = new URL(input.url ?? input);
	if ((init?.redirect ?? input.redirect) !== "error")
		redirectViolations.push(url.pathname);
	// A positive live-mode control observes the fixed URL but sends only to loopback.
	if (
		simulateLive &&
		url.origin === "https://api.meta.ai" &&
		["/v1/chat/completions", "/v1/responses"].includes(url.pathname)
	) {
		liveTargets.push(url.href);
		const local = new URL(url.pathname, activeOrigin);
		return originalFetch(
			input instanceof Request ? new Request(local, input) : local,
			{ ...init, redirect: "error" },
		);
	}
	if (url.origin !== activeOrigin) {
		attemptedExternal.push(url.origin);
		throw new Error("Unexpected network destination");
	}
	return originalFetch(input, { ...init, redirect: "error" });
};
const wireBody = (options) => ({
	model,
	messages: options.messages,
	max_completion_tokens: options.max_output_tokens,
	response_format: { type: "json_object" },
});
const inputBound = (options) => {
	let frames = 0;
	const body = wireBody(options);
	body.messages = body.messages.map((message) => ({
		...message,
		content: Array.isArray(message.content)
			? message.content.map((part) => {
					if (part.type !== "image_url") return part;
					frames++;
					return { ...part, image_url: { ...part.image_url, url: "" } };
				})
			: message.content,
	}));
	return Buffer.byteLength(JSON.stringify(body)) + 1600 * frames;
};
const priced = (options) =>
	Math.ceil(
		(inputBound(options) * 100 + options.max_output_tokens * 500) / 1000,
	);
const exactUsage = (bound) => {
	const options = request(bound);
	return {
		prompt_tokens: inputBound(options),
		completion_tokens: options.max_output_tokens,
	};
};
const ok = (usage = smallUsage, hold = false) => ({ mode: "ok", usage, hold });

async function loadEmber() {
	try {
		const ember = await import(moduleUrl);
		assert.equal(typeof ember.callEmber, "function");
		return ember;
	} catch (error) {
		if (
			error.code === "ERR_MODULE_NOT_FOUND" &&
			!existsSync(fileURLToPath(moduleUrl))
		) {
			assert.fail("src/ember.mjs is not implemented");
		}
		throw error;
	}
}

function request(bound = 1000, extra = {}) {
	const options = {
		messages: [{ role: "user", content: "abcdefghij" }],
		max_output_tokens: 2 * bound,
		caseId: "case-a",
		timeoutMs: 15000,
		...extra,
	};
	if (extra.max_output_tokens === undefined) {
		// Invert the independently priced fixture, including decimal digit rounding.
		options.max_output_tokens -= 2 * Math.max(0, priced(options) - bound - 1);
		while (priced(options) > bound) options.max_output_tokens--;
		assert.ok(options.max_output_tokens > 0);
		assert.equal(priced(options), bound);
	}
	return options;
}

const parse = (path) => JSON.parse(readFileSync(path, "utf8"));
const booked = (ledger) =>
	ledger.open.reduce((sum, item) => sum + item.upperBound, 0);
const total = (ledger) =>
	(ledger.baseline ?? 0) + ledger.settled + booked(ledger);

function resultIs(result, status) {
	assert.equal(result.status, status);
	assert.ok(!JSON.stringify(result).includes(secret), "Credential in result");
}

function reconcile(ctx) {
	const ledger = ctx.ledger();
	const events = ctx.events();
	const baseline = events.filter((event) => event.type === "baseline");
	assert.equal(baseline.length, 1);
	assert.equal(baseline[0].baseline_micro_usd, ledger.baseline);
	const settled = events.reduce(
		(sum, event) => sum + (event.cost_micro_usd ?? 0),
		0,
	);
	const liability = events.reduce(
		(sum, event) => sum + (event.booked_micro_usd ?? 0),
		0,
	);
	assert.equal(settled, ledger.settled);
	assert.equal(liability, booked(ledger));
	assert.equal(
		baseline[0].baseline_micro_usd + settled + liability,
		total(ledger),
	);
	assert.equal(
		events.at(-1).cap_ledger_micro_usd,
		total(ledger),
		"Last trace running total differs from ledger",
	);
}

async function scenario(options, run) {
	const previousCwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "foley-ember-"));
	const ledgerPath = join(root, "out", "ledger.json");
	const tracePath = join(root, "out", "trace.jsonl");
	const lockPath = `${ledgerPath}.lock`;
	const workers = [];
	const inFlight = [];
	let server;
	try {
		mkdirSync(join(root, "out", "prompts"), { recursive: true });
		const baseline = options.baseline === undefined ? 0 : options.baseline;
		const ledger = {
			cap,
			baseline,
			settled: options.settled ?? 0,
			open: options.open ?? [],
		};
		writeFileSync(ledgerPath, JSON.stringify(ledger));
		const seed =
			baseline === null
				? []
				: [
						{
							type: "baseline",
							baseline_micro_usd: baseline,
							cap_ledger_micro_usd: baseline,
						},
					];
		if (ledger.settled)
			seed.push({
				type: "request",
				cost_micro_usd: ledger.settled,
				cap_ledger_micro_usd: baseline + ledger.settled,
			});
		for (const item of ledger.open)
			seed.push({
				type: "recovery",
				callId: item.callId,
				booked_micro_usd: item.upperBound,
				cap_ledger_micro_usd: total(ledger),
			});
		writeFileSync(
			tracePath,
			seed.map((event) => `${JSON.stringify(event)}\n`).join(""),
		);
		server = await startFakeServer(options.script ?? [ok()]);
		// The process is isolated by node --test. Never read or forward an inherited key.
		process.env.MODEL_API_KEY = secret;
		process.env.FOLEY_TEST_API_KEY = secret;
		process.env.FOLEY_OFFLINE = "1";
		process.env.FOLEY_EMBER_BASE_URL = server.baseUrl;
		delete process.env.FOLEY_EMBER_MODEL;
		process.chdir(root);
		attemptedExternal = [];
		redirectViolations = [];
		simulateLive = options.simulateLive === true;
		liveTargets = [];
		activeOrigin = new URL(server.baseUrl).origin;
		const ember = await loadEmber();
		const ctx = {
			server,
			liveTargets,
			ledgerPath,
			tracePath,
			lockPath,
			ledger: () => parse(ledgerPath),
			events: () =>
				readFileSync(tracePath, "utf8")
					.trim()
					.split("\n")
					.filter(Boolean)
					.map(JSON.parse),
			ember,
			call(options) {
				const running = (async () => ember.callEmber(options))().then(
					(result) => {
						assert.deepEqual(
							attemptedExternal,
							[],
							"Client attempted a non-test destination",
						);
						return result;
					},
				);
				// A failed pre-settlement assertion can leave a request outstanding.
				// Retain it for cleanup without hiding a rejection from its caller.
				running.catch(() => {});
				inFlight.push(running);
				return running;
			},
			async worker() {
				const child = fork(workerPath, [], {
					cwd: root,
					execArgv: [],
					env: {
						MODEL_API_KEY: secret,
						FOLEY_TEST_API_KEY: secret,
						FOLEY_OFFLINE: "1",
						FOLEY_EMBER_BASE_URL: server.baseUrl,
					},
					stdio: ["ignore", "pipe", "pipe", "ipc"],
				});
				workers.push(child);
				let output = "";
				child.stdout.on("data", (chunk) => {
					output += chunk.toString();
				});
				child.stderr.on("data", (chunk) => {
					output += chunk.toString();
				});
				let closed = false;
				child.once("close", () => {
					closed = true;
				});
				const changes = new EventEmitter();
				const messages = [];
				child.on("message", (message) => {
					messages.push(message);
					changes.emit("change");
				});
				let launchError;
				child.on("error", (error) => {
					launchError = error;
					changes.emit("change");
				});
				async function exited() {
					if (child.exitCode !== null || child.signalCode !== null) {
						return [child.exitCode, child.signalCode];
					}
					return once(child, "exit", { signal: AbortSignal.timeout(20000) });
				}
				// Wake a waiter on failure as well as on IPC.
				child.on("exit", () => changes.emit("change"));
				async function waitFor(type) {
					const signal = AbortSignal.timeout(20000);
					while (!messages.some((message) => message.type === type)) {
						if (launchError) throw launchError;
						assert.equal(child.exitCode, null, `Worker exited before ${type}`);
						assert.equal(
							child.signalCode,
							null,
							`Worker killed before ${type}`,
						);
						assert.ok(
							!messages.some((message) => message.type === "error"),
							"Worker call threw",
						);
						await once(changes, "change", { signal });
					}
					return messages.find((message) => message.type === type);
				}
				await waitFor("ready");
				return {
					pid: child.pid,
					start: (options, fault) => child.send({ options, fault }),
					waitFor,
					async result() {
						const message = await waitFor("result");
						assert.deepEqual(message.unexpected, []);
						assert.deepEqual(
							message.redirectViolations,
							[],
							"Product omitted redirect error policy",
						);
						assert.deepEqual(await exited(), [0, null]);
						if (!closed)
							await once(child, "close", {
								signal: AbortSignal.timeout(15000),
							});
						assert.ok(!output.includes(secret), "Credential in process output");
						return message.result;
					},
					async kill() {
						child.kill("SIGKILL");
						assert.deepEqual(await exited(), [null, "SIGKILL"]);
					},
					exited,
				};
			},
		};
		await run(ctx);
		assert.deepEqual(attemptedExternal, []);
		assert.deepEqual(
			redirectViolations,
			[],
			"Product omitted redirect error policy",
		);
	} finally {
		try {
			for (const child of workers) {
				if (child.pid && child.exitCode === null && child.signalCode === null) {
					const exited = once(child, "exit", {
						signal: AbortSignal.timeout(15000),
					});
					child.kill("SIGKILL");
					await exited;
				}
			}
			await server?.close();
			await Promise.race([
				Promise.allSettled(inFlight),
				new Promise((_, reject) => {
					const signal = AbortSignal.timeout(20000);
					signal.addEventListener("abort", () => reject(signal.reason), {
						once: true,
					});
				}),
			]);
		} finally {
			activeOrigin = undefined;
			simulateLive = false;
			process.chdir(previousCwd);
			rmSync(root, { recursive: true, force: true });
		}
	}
}

function contract(id, run) {
	test(id, { timeout: 60000 }, run);
}

async function refuse(ctx, options, status = "budget_refused") {
	const before = readFileSync(ctx.ledgerPath);
	const count = ctx.server.requests.length;
	resultIs(await ctx.call(options), status);
	assert.deepEqual(
		readFileSync(ctx.ledgerPath),
		before,
		"Refusal changed ledger bytes",
	);
	assert.equal(
		ctx.server.requests.length,
		count,
		"Refusal transmitted a request",
	);
	const event = ctx.events().at(-1);
	assert.equal(event.type, "refusal");
	assert.equal(event.outcome, status);
	assert.equal(event.request_digest, undefined);
}

export {
	booked,
	cap,
	contract,
	exactUsage,
	inputBound,
	model,
	ok,
	priced,
	reconcile,
	refuse,
	request,
	resultIs,
	scenario,
	secret,
	smallUsage,
	total,
	wireBody,
};

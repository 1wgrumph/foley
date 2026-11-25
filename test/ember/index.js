/*
 * Public contract selected where the design leaves names open:
 * callEmber({messages, max_output_tokens, caseId, caseBudget?, timeoutMs?})
 * -> Promise<{status: closed result, output?: parsed JSON, message?: string}>.
 * recordBaseline(microUsd) records the owner-supplied baseline.
 * Each call reads MODEL_API_KEY, FOLEY_OFFLINE (1 enables the local test URL),
 * FOLEY_EMBER_BASE_URL and FOLEY_EMBER_MODEL (only the fixed model is allowed).
 * Relative to cwd: out/ledger.json, out/ledger.json.lock, out/trace.jsonl,
 * out/prompts/<request_digest>.json (media stored by SHA-256 of decoded bytes).
 * Ledger open entries: callId, upperBound,
 * caseId; lock owner: {pid}. Baseline null means unset.
 * Count text UTF-8 bytes as the conservative text-token bound; images add 1600
 * each. The fixtures use ASCII text and integer costs. Never trust a caller's
 * dollar estimate. Unknown media bounds and missing output limits refuse.
 * Trace: type, outcome, model, request_digest, input_tokens (uncached),
 * cached_input_tokens, output_tokens, reasoning_tokens, cost_micro_usd,
 * booked_micro_usd, baseline_micro_usd (baseline event), cap_ledger_micro_usd.
 * Cost and booked fields are event deltas; recovery adds only untraced amounts.
 * Resource group: ephemeral loopback port and unique temporary directory.
 */
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter, once } from "node:events";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { sampleUsage, startFakeServer } from "../fake-server.mjs";

const cap = 9_000_000;
const model = "muse-ember-1.0";
const secret = "synthetic-ember-test-only";
const moduleUrl = new URL("../../src/ember.mjs", import.meta.url);
const workerPath = fileURLToPath(
	new URL("../../fixtures/ember/worker.mjs", import.meta.url),
);
const smallUsage = { prompt_tokens: 10, completion_tokens: 2 };
const originalFetch = globalThis.fetch;
let activeOrigin;
let attemptedExternal = [];
let simulateLive = false;
let liveTargets = [];
globalThis.fetch = (input, init) => {
	const url = new URL(input.url ?? input);
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
const exactUsage = (bound) => ({
	prompt_tokens: 10,
	completion_tokens: 2 * (bound - 1),
});
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
	return {
		messages: [{ role: "user", content: "abcdefghij" }],
		max_output_tokens: 2 * (bound - 1),
		caseId: "case-a",
		timeoutMs: 15000,
		...extra,
	};
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
	assert.equal(events.at(-1).cap_ledger_micro_usd, total(ledger));
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
		process.env.FOLEY_OFFLINE = "1";
		process.env.FOLEY_EMBER_BASE_URL = server.baseUrl;
		delete process.env.FOLEY_EMBER_MODEL;
		process.chdir(root);
		attemptedExternal = [];
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
				const running = Promise.resolve()
					.then(() => ember.callEmber(options))
					.then((result) => {
						assert.deepEqual(
							attemptedExternal,
							[],
							"Client attempted a non-test destination",
						);
						return result;
					});
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
					start: (options) => child.send(options),
					async result() {
						const message = await waitFor("result");
						assert.deepEqual(message.unexpected, []);
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

contract("TC-R01-1", async () => {
	await scenario({ baseline: 8_999_000 }, async (ctx) => {
		await refuse(ctx, request(1001));
		resultIs(await ctx.call(request(1000)), "ok");
		assert.equal(ctx.server.requests.length, 1);
	});
	// Global cap also includes settled spend and existing liability.
	await scenario(
		{
			baseline: 8_998_000,
			settled: 600,
			open: [{ callId: "prior", upperBound: 400, caseId: "prior-case" }],
		},
		async (ctx) => {
			await refuse(ctx, request(1001));
		},
	);
});

contract("TC-R01-2", async () => {
	for (const bound of [1000, 1001]) {
		await scenario(
			{
				baseline: 8_998_000,
				settled: 500,
				open: [{ callId: "prior", upperBound: 500, caseId: "prior-case" }],
				script: [ok(exactUsage(1000))],
			},
			async (ctx) => {
				resultIs(
					await ctx.call(request(bound)),
					bound === 1000 ? "ok" : "budget_refused",
				);
				assert.equal(ctx.server.requests.length, bound === 1000 ? 1 : 0);
				assert.equal(total(ctx.ledger()), bound === 1000 ? cap : cap - 1000);
			},
		);
	}
});

function checkRace(ctx, results, count) {
	assert.deepEqual(
		results.map((result) => result.status).sort(),
		count === 1 ? ["budget_refused", "ok"] : ["ok", "ok"],
	);
	assert.equal(ctx.server.requests.length, count);
	const ledger = ctx.ledger();
	assert.equal(ledger.settled, count * 40000);
	assert.equal(ledger.open.length, 0);
	assert.ok(total(ledger) <= cap);
	assert.equal(
		ctx.events().filter((event) => event.type === "refusal").length,
		2 - count,
	);
	assert.equal(existsSync(ctx.lockPath), false, "Ledger lock not released");
}

contract("TC-R01-3", async () => {
	for (const baseline of [8_950_000, 8_910_000]) {
		await scenario(
			{ baseline, script: [ok(exactUsage(40000)), ok(exactUsage(40000))] },
			async (ctx) => {
				const results = await Promise.all([
					ctx.call(request(40000)),
					ctx.call(request(40000)),
				]);
				checkRace(ctx, results, baseline === 8_950_000 ? 1 : 2);
			},
		);
	}
});

contract("TC-R01-4", async () => {
	await scenario(
		{
			baseline: 8_950_000,
			script: [ok(exactUsage(40000)), ok(exactUsage(40000))],
		},
		async (ctx) => {
			const [first, second] = await Promise.all([ctx.worker(), ctx.worker()]);
			first.start(request(40000));
			second.start(request(40000));
			checkRace(ctx, await Promise.all([first.result(), second.result()]), 1);
		},
	);
	await scenario({}, async (ctx) => {
		// A dead owner is created by this test; the stale lock must not be silently removed.
		const worker = await ctx.worker();
		await worker.kill();
		const lock = JSON.stringify({ pid: worker.pid });
		writeFileSync(ctx.lockPath, lock);
		resultIs(await ctx.call(request()), "ledger_unreadable");
		assert.equal(ctx.server.requests.length, 0);
		assert.equal(readFileSync(ctx.lockPath, "utf8"), lock);
	});
});

async function crashAfterSend(ctx, bound = 40000) {
	const worker = await ctx.worker();
	const count = ctx.server.requests.length;
	worker.start(request(bound));
	await ctx.server.waitForRequests(count + 1);
	const ledger = ctx.ledger();
	assert.equal(ledger.open.length, 1);
	const reservation = ledger.open[0];
	assert.equal(reservation.upperBound, bound);
	assert.equal(reservation.caseId, "case-a");
	assert.ok(reservation.callId);
	await worker.kill();
	assert.deepEqual(ctx.ledger().open, [reservation]);
	return reservation;
}

async function restartCall(ctx, options) {
	const worker = await ctx.worker();
	worker.start(options);
	return worker.result();
}

contract("TC-R01-5", async () => {
	await scenario(
		{ baseline: 8_950_000, script: [{ mode: "slow" }] },
		async (ctx) => {
			const reservation = await crashAfterSend(ctx);
			resultIs(await restartCall(ctx, request(40000)), "budget_refused");
			assert.equal(ctx.server.requests.length, 1);
			assert.deepEqual(ctx.ledger().open, [reservation]);
			assert.equal(ctx.ledger().settled, 0);
			assert.ok(
				ctx
					.events()
					.some(
						(event) =>
							event.type === "recovery" && event.callId === reservation.callId,
					),
			);
			reconcile(ctx);
		},
	);
	await scenario({}, async (ctx) => {
		resultIs(await restartCall(ctx, request()), "ok");
		assert.equal(ctx.ledger().open.length, 0);
	});
});

contract("TC-R01-6", async () => {
	await scenario({ script: [ok(sampleUsage, true)] }, async (ctx) => {
		const worker = await ctx.worker();
		worker.start(
			request(1000, {
				messages: [{ role: "user", content: "a".repeat(1000) }],
			}),
		);
		await ctx.server.waitForRequests(1);
		// Make the append fail at the public trace path after the request is sent.
		const savedTrace = `${ctx.tracePath}.saved`;
		const before = readFileSync(ctx.tracePath);
		renameSync(ctx.tracePath, savedTrace);
		mkdirSync(ctx.tracePath);
		ctx.server.release(0);
		await worker.exited();
		assert.deepEqual(
			readFileSync(savedTrace),
			before,
			"Trace append did not fail",
		);
		assert.equal(
			ctx.ledger().settled,
			152,
			"Settlement rename was not durable",
		);
		assert.equal(booked(ctx.ledger()), 0);
		rmSync(ctx.tracePath, { recursive: true });
		renameSync(savedTrace, ctx.tracePath);
		resultIs(
			await restartCall(ctx, request(1001, { caseBudget: 1000 })),
			"budget_refused",
		);
		assert.equal(ctx.server.requests.length, 1);
		assert.equal(ctx.ledger().settled, 152);
		assert.ok(ctx.events().some((event) => event.type === "recovery"));
		reconcile(ctx);
	});
});

contract("TC-R01-7", async () => {
	await scenario(
		{ script: [{ mode: "missing_usage", hold: true }] },
		async (ctx) => {
			const running = ctx.call(request(1000));
			await ctx.server.waitForRequests(1);
			assert.equal(
				booked(ctx.ledger()),
				1000,
				"Request sent without reservation",
			);
			assert.equal(ctx.ledger().settled, 0);
			ctx.server.release(0);
			resultIs(await running, "malformed_output");
			assert.equal(booked(ctx.ledger()), 1000);
			assert.equal(ctx.ledger().settled, 0);
			assert.equal(ctx.server.requests.length, 1);
			reconcile(ctx);
		},
	);
	await scenario({ script: [ok(smallUsage, true)] }, async (ctx) => {
		const running = ctx.call(request(1000));
		await ctx.server.waitForRequests(1);
		assert.equal(booked(ctx.ledger()), 1000);
		ctx.server.release(0);
		resultIs(await running, "ok");
		assert.equal(booked(ctx.ledger()), 0);
		assert.equal(ctx.ledger().settled, 2);
	});
});

function mediaRequest(type) {
	const url =
		type === "image"
			? "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII="
			: `data:${type}/${type === "video" ? "mp4" : "wav"};base64,YQ==`;
	return request(1000, {
		messages: [
			{
				role: "user",
				content: [
					{ type: "text", text: "abcdefghij" },
					{ type: `${type}_url`, [`${type}_url`]: { url } },
				],
			},
		],
	});
}

contract("TC-R01-8", async () => {
	await scenario({}, async (ctx) => {
		await refuse(ctx, mediaRequest("video"));
		await refuse(ctx, mediaRequest("audio"));
		const missingLimit = request();
		delete missingLimit.max_output_tokens;
		await refuse(ctx, missingLimit);
		await refuse(
			ctx,
			request(1000, {
				messages: [{ role: "user", content: "a".repeat(200001) }],
			}),
		);
	});
	await scenario(
		{
			baseline: cap - 1160,
			script: [ok({ prompt_tokens: 1610, completion_tokens: 2 }, true)],
		},
		async (ctx) => {
			const input = mediaRequest("image");
			const encoded = input.messages[0].content[1].image_url.url.split(",")[1];
			const running = ctx.call(input);
			await ctx.server.waitForRequests(1);
			assert.equal(
				booked(ctx.ledger()),
				1160,
				"Frame bound must add 1600 input tokens",
			);
			ctx.server.release(0);
			resultIs(await running, "ok");
			assert.equal(ctx.server.requests.length, 1);
			const event = ctx.events().find((entry) => entry.type === "request");
			const prompt = readFileSync(
				join(process.cwd(), "out", "prompts", `${event.request_digest}.json`),
				"utf8",
			);
			assert.ok(!prompt.includes(encoded), "Raw media stored in prompt");
			assert.ok(
				prompt.includes(
					createHash("sha256")
						.update(Buffer.from(encoded, "base64"))
						.digest("hex"),
				),
			);
		},
	);
});

contract("TC-R01-9", async () => {
	for (const baseline of [null, cap + 1]) {
		await scenario({ baseline }, async (ctx) => {
			delete process.env.FOLEY_OFFLINE;
			delete process.env.FOLEY_EMBER_BASE_URL;
			await refuse(ctx, request());
			// No live network is possible: the fetch guard records and blocks any attempt.
			process.env.FOLEY_OFFLINE = "1";
			process.env.FOLEY_EMBER_BASE_URL = ctx.server.baseUrl;
			if (baseline === null) {
				resultIs(await ctx.call(request()), "ok");
				assert.equal(ctx.server.requests.length, 1);
			} else {
				await refuse(ctx, request());
			}
		});
	}
	await scenario({ baseline: 0, simulateLive: true }, async (ctx) => {
		delete process.env.FOLEY_OFFLINE;
		delete process.env.FOLEY_EMBER_BASE_URL;
		resultIs(await ctx.call(request()), "ok");
		assert.equal(ctx.server.requests.length, 1);
		assert.equal(ctx.liveTargets.length, 1);
		assert.match(
			ctx.liveTargets[0],
			/^https:\/\/api\.meta\.ai\/v1\/(?:chat\/completions|responses)$/,
		);
	});
});

contract("TC-R01-10", async () => {
	await scenario(
		{ baseline: 8_950_000, script: [{ mode: "rate_limited" }] },
		async (ctx) => {
			resultIs(await ctx.call(request(40000)), "rate_limited");
			assert.equal(ctx.server.requests.length, 1);
			assert.equal(booked(ctx.ledger()), 40000);
			assert.ok(ctx.events().some((event) => event.type === "refusal"));
		},
	);
	await scenario(
		{
			baseline: 8_910_000,
			script: [
				{ mode: "rate_limited", retryAfter: "1" },
				ok(exactUsage(40000)),
			],
		},
		async (ctx) => {
			resultIs(await ctx.call(request(40000)), "ok");
			assert.equal(ctx.server.requests.length, 2);
			// Allow small timer granularity; a retry without waiting fails.
			assert.ok(
				ctx.server.requests[1].receivedAt - ctx.server.requests[0].receivedAt >=
					950,
			);
			assert.equal(booked(ctx.ledger()), 40000);
			assert.equal(ctx.ledger().settled, 40000);
			assert.ok(total(ctx.ledger()) <= cap);
		},
	);
});

contract("TC-R01-11", async () => {
	await scenario(
		{ script: [ok(exactUsage(6000)), ok(exactUsage(5000))] },
		async (ctx) => {
			await refuse(ctx, request(10001, { caseBudget: 10000 }));
			resultIs(await ctx.call(request(6000, { caseBudget: 10000 })), "ok");
			await refuse(ctx, request(5000, { caseBudget: 10000 }));
			resultIs(
				await ctx.call(request(5000, { caseId: "case-b", caseBudget: 10000 })),
				"ok",
			);
			assert.equal(ctx.server.requests.length, 2);
		},
	);
});

contract("TC-R01-12", async () => {
	for (const invalid of [null, "{broken"]) {
		await scenario({}, async (ctx) => {
			if (invalid === null) rmSync(ctx.ledgerPath);
			else writeFileSync(ctx.ledgerPath, invalid);
			resultIs(await ctx.call(request()), "ledger_unreadable");
			assert.equal(ctx.server.requests.length, 0);
			if (invalid === null) assert.equal(existsSync(ctx.ledgerPath), false);
			else assert.equal(readFileSync(ctx.ledgerPath, "utf8"), invalid);
		});
	}
	await scenario({}, async (ctx) => {
		resultIs(await ctx.call(request()), "ok");
		assert.equal(ctx.server.requests.length, 1);
	});
});

contract("TC-R02-1", async () => {
	await scenario({ script: [ok(sampleUsage)] }, async (ctx) => {
		const prompt = "abcde".repeat(200);
		const result = await ctx.call(
			request(1000, { messages: [{ role: "user", content: prompt }] }),
		);
		resultIs(result, "ok");
		assert.deepEqual(result.output, { answer: "ok" });
		assert.equal(ctx.ledger().settled, 152);
		assert.equal(booked(ctx.ledger()), 0);
		const events = ctx.events().filter((event) => event.type === "request");
		assert.equal(events.length, 1);
		const [event] = events;
		assert.equal(event.model, model);
		assert.equal(event.input_tokens, 500);
		assert.equal(event.cached_input_tokens, 500);
		assert.equal(event.output_tokens, 200);
		assert.equal(event.reasoning_tokens, 120);
		assert.equal(event.cost_micro_usd, 152);
		assert.match(event.request_digest, /^[a-f0-9]{64}$/);
		const prompts = join(process.cwd(), "out", "prompts");
		assert.ok(
			readFileSync(
				join(prompts, `${event.request_digest}.json`),
				"utf8",
			).includes(prompt),
		);
		reconcile(ctx);
	});
});

contract("TC-R02-2", async () => {
	await scenario(
		{ baseline: null, script: [ok(sampleUsage), { mode: "slow" }] },
		async (ctx) => {
			assert.equal(typeof ctx.ember.recordBaseline, "function");
			await ctx.ember.recordBaseline(1_230_000);
			assert.equal(ctx.ledger().baseline, 1_230_000);
			resultIs(
				await ctx.call(
					request(1000, {
						messages: [{ role: "user", content: "a".repeat(1000) }],
					}),
				),
				"ok",
			);
			await refuse(ctx, request(1001, { caseBudget: 1000 }));
			const reservation = await crashAfterSend(ctx);
			resultIs(
				await restartCall(ctx, request(1001, { caseBudget: 1000 })),
				"budget_refused",
			);
			assert.equal(ctx.server.requests.length, 2);
			assert.equal(total(ctx.ledger()), 1_270_152);
			const events = ctx.events();
			for (const type of ["baseline", "request", "refusal", "recovery"]) {
				assert.ok(
					events.some((event) => event.type === type),
					`Missing ${type} event`,
				);
			}
			assert.ok(
				events.some(
					(event) =>
						event.type === "recovery" && event.callId === reservation.callId,
				),
			);
			for (const event of events.filter((event) => event.type === "refusal")) {
				assert.equal(event.request_digest, undefined);
			}
			reconcile(ctx);
		},
	);
});

contract("TC-R03-1", async () => {
	await scenario({}, async (ctx) => {
		process.env.FOLEY_EMBER_MODEL = "other";
		await refuse(ctx, request(), "refused_input");
		delete process.env.FOLEY_EMBER_MODEL;
		process.env.FOLEY_EMBER_BASE_URL = "https://example.invalid/v1";
		await refuse(ctx, request(), "refused_input");
		process.env.FOLEY_EMBER_BASE_URL = ctx.server.baseUrl;
		delete process.env.FOLEY_OFFLINE;
		await refuse(ctx, request(), "refused_input");
		process.env.FOLEY_OFFLINE = "1";
		resultIs(await ctx.call(request()), "ok");
		assert.equal(ctx.server.requests.length, 1);
		assert.equal(ctx.server.requests[0].body.model, model);
		assert.equal(
			ctx.server.requests[0].headers.authorization,
			`Bearer ${secret}`,
		);
	});
});

contract("TC-R12-1", async () => {
	const cases = [
		["api_error", "api_error"],
		["rate_limited", "rate_limited"],
		["slow", "timeout"],
		["malformed_json", "malformed_output"],
		["invalid_output", "malformed_output"],
		["refused_input", "refused_input"],
		["missing_usage", "malformed_output"],
		["ok", "ok"],
	];
	for (const [mode, status] of cases) {
		const script = mode === "ok" ? [ok()] : [{ mode }, { mode }];
		await scenario({ script }, async (ctx) => {
			resultIs(
				await restartCall(
					ctx,
					request(1000, { timeoutMs: mode === "slow" ? 3000 : 15000 }),
				),
				status,
			);
			assert.equal(ctx.server.requests.length, mode === "rate_limited" ? 2 : 1);
			const events = ctx.events().filter((event) => event.type === "request");
			assert.equal(events.length, ctx.server.requests.length);
			assert.ok(events.every((event) => event.outcome === status));
			assert.ok(total(ctx.ledger()) <= cap);
			reconcile(ctx);
			for (const file of [ctx.ledgerPath, ctx.tracePath]) {
				assert.ok(
					!readFileSync(file, "utf8").includes(secret),
					"Credential leaked to disk",
				);
			}
			const prompts = join(process.cwd(), "out", "prompts");
			for (const file of readdirSync(prompts)) {
				assert.ok(
					!readFileSync(join(prompts, file), "utf8").includes(secret),
					"Credential leaked to prompt",
				);
			}
		});
	}
});

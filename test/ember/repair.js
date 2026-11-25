import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { dirname, join } from "node:path";
import { sampleUsage } from "../fake-server.mjs";
import {
	cap, model, secret, smallUsage, ok, request, wireBody, priced, booked, total,
	resultIs, reconcile, scenario, contract,
} from "../ember-harness.mjs";

const digest = (raw) => createHash("sha256").update(raw).digest("hex");
const requestEvents = (ctx) => ctx.events().filter((e) => e.type === "request");
const closed = new Set([
	"ok", "budget_refused", "ledger_unreadable", "api_error", "rate_limited",
	"timeout", "malformed_output", "refused_input",
]);

// Inject errors only at actual file-system operations on this scenario's paths.
// Node's ESM bindings are live after syncBuiltinESMExports.
async function withFsOverrides(overrides, run) {
	const originals = {};
	for (const [name, wrap] of Object.entries(overrides)) {
		originals[name] = fs[name];
		fs[name] = (...args) => wrap(originals[name], ...args);
	}
	syncBuiltinESMExports();
	try {
		return await run();
	} finally {
		Object.assign(fs, originals);
		syncBuiltinESMExports();
	}
}

function deny() {
	throw Object.assign(new Error("controlled storage failure"), { code: "EACCES" });
}

function traceWrites(ctx, intercept) {
	return {
		appendFile: (next, path, data, ...args) => path === ctx.tracePath
			? intercept(() => next(path, data, ...args), data) : next(path, data, ...args),
		writeFile: (next, path, data, ...args) => path === ctx.tracePath
			? intercept(() => next(path, data, ...args), data) : next(path, data, ...args),
		rename: (next, from, to) => to === ctx.tracePath
			? intercept(() => next(from, to), readFileSync(from, "utf8")) : next(from, to),
	};
}

async function resultWithoutThrow(promise) {
	const result = await promise.catch(() => assert.fail("Public call threw instead of returning a closed result"));
	assert.ok(closed.has(result?.status), "Result outside closed set");
	return result;
}

function noCredential(ctx, result) {
	assert.ok(!JSON.stringify(result).includes(secret), "Credential in result");
	const inspect = (folder) => {
		for (const entry of readdirSync(folder, { withFileTypes: true })) {
			const path = join(folder, entry.name);
			if (entry.isDirectory()) inspect(path);
			else assert.ok(!readFileSync(path, "utf8").includes(secret), "Credential persisted in output files");
		}
	};
	inspect(dirname(ctx.ledgerPath));
}

contract("TC-R01-2/bound-violation", async () => {
	const usage = { prompt_tokens: 12000, completion_tokens: 200 };
	await scenario({ script: [ok(usage), ok()] }, async (ctx) => {
		const result = await ctx.call(request(1000));
		assert.ok(closed.has(result.status));
		assert.equal(ctx.ledger().settled, 1300, "Actual usage must not be clamped");
		const event = requestEvents(ctx)[0];
		assert.equal(event.cost_micro_usd, 1300);
		const later = await ctx.call(request());
		assert.equal(later.status, "budget_refused", "Bound violation did not stop later admission");
		assert.equal(ctx.server.requests.length, 1);
		assert.equal(event.bound_violated, true, "Missing bound-violation receipt");
		reconcile(ctx);
	});
});

contract("TC-R01-1/wire-framing", async () => {
	const options = request(1000, {
		messages: [{ role: "user", content: 'a"\\b\nc' }, { role: "assistant", content: "previous" }],
	});
	await scenario({ baseline: cap - priced(options) + 1 }, async (ctx) => {
		resultIs(await ctx.call(options), "budget_refused");
		assert.equal(ctx.server.requests.length, 0, "Message framing omitted from admission bound");
	});
});

contract("TC-R01-8/unbounded-image", async () => {
	const options = request(1000, { max_output_tokens: 100,
		messages: [{ role: "user", content: [
			{ type: "image_url", image_url: { url: "https://example.invalid/image.png" } },
		] }],
	});
	await scenario({}, async (ctx) => {
		const result = await ctx.call(options);
		assert.ok(["budget_refused", "refused_input"].includes(result.status), "Unbounded image admitted");
		assert.equal(ctx.server.requests.length, 0);
	});
});

contract("TC-R01-2/first-snapshot", async () => {
	await scenario({}, async (ctx) => {
		const options = request();
		const expected = structuredClone(wireBody(options));
		const running = ctx.call(options);
		options.messages[0].content = "changed after start";
		options.messages.push({ role: "user", content: "late message" });
		resultIs(await running, "ok");
		const sent = ctx.server.requests[0];
		assert.deepEqual(sent.body, expected, "First send used caller mutation");
		assert.equal(requestEvents(ctx)[0].request_digest, digest(sent.raw));
	});
});

contract("TC-R01-10/retry-snapshot", async () => {
	await scenario({ script: [{ mode: "rate_limited", hold: true }, ok()] }, async (ctx) => {
		const options = request();
		const expected = structuredClone(wireBody(options));
		const running = ctx.call(options);
		await ctx.server.waitForRequests(1);
		options.messages[0].content = "changed before retry";
		ctx.server.release(0);
		resultIs(await running, "ok");
		assert.equal(ctx.server.requests.length, 2);
		for (const sent of ctx.server.requests) assert.deepEqual(sent.body, expected, "Retry used caller mutation");
		const events = requestEvents(ctx);
		assert.equal(events.length, 2);
		for (const [i, event] of events.entries())
			assert.equal(event.request_digest, digest(ctx.server.requests[i].raw), "Digest does not bind transmitted bytes");
	});
});

contract("TC-R12-1/success-credential", async () => {
	await scenario({ script: [{ mode: "ok", content: JSON.stringify({ answer: secret }) }] }, async (ctx) => {
		const result = await resultWithoutThrow(ctx.call(request()));
		noCredential(ctx, result);
		assert.equal(ctx.server.requests.length, 1);
	});
});

contract("TC-R12-1/usage-credential", async () => {
	const usage = { ...sampleUsage, completion_tokens_details: { reasoning_tokens: secret } };
	await scenario({ script: [ok(usage)] }, async (ctx) => {
		const result = await resultWithoutThrow(ctx.call(request()));
		noCredential(ctx, result);
		resultIs(result, "malformed_output");
		assert.equal(booked(ctx.ledger()), 1000, "Unknown usage must retain its reservation");
		reconcile(ctx);
	});
});

contract("TC-R12-1/prompt-credential", async () => {
	await scenario({}, async (ctx) => {
		const result = await resultWithoutThrow(ctx.call(request(1000, {
			messages: [{ role: "user", content: "Credential: " + secret }],
		})));
		noCredential(ctx, result);
		assert.ok(ctx.server.requests.every((sent) => !sent.raw.includes(secret)), "Credential sent as prompt text");
	});
});

contract("TC-R12-1/case-credential", async () => {
	await scenario({}, async (ctx) => {
		const result = await resultWithoutThrow(ctx.call(request(1000, { caseId: "case-" + secret })));
		noCredential(ctx, result);
	});
});

contract("TC-R03-1/literal-loopback", async () => {
	await scenario({}, async (ctx) => {
		process.env.FOLEY_EMBER_BASE_URL = ctx.server.baseUrl.replace("127.0.0.1", "localhost");
		resultIs(await ctx.call(request()), "refused_input");
		assert.equal(ctx.server.requests.length, 0);
	});
});

contract("TC-R03-1/offline-key", async () => {
	await scenario({}, async (ctx) => {
		delete process.env.FOLEY_TEST_API_KEY;
		resultIs(await ctx.call(request()), "refused_input");
		assert.equal(ctx.server.requests.length, 0, "Offline call used live credential");
		process.env.MODEL_API_KEY = "synthetic-live-only";
		process.env.FOLEY_TEST_API_KEY = secret;
		resultIs(await ctx.call(request()), "ok");
		assert.equal(ctx.server.requests[0].headers.authorization, "Bearer " + secret);
	});
});

contract("TC-R01-6/baseline-append", async () => {
	await scenario({ baseline: null }, async (ctx) => {
		let hit = 0;
		await withFsOverrides(traceWrites(ctx, () => { hit++; deny(); }), async () => {
			await ctx.ember.recordBaseline(123456).catch(() => {});
		});
		assert.ok(hit, "Baseline trace failure was not injected");
		if (ctx.ledger().baseline === null) await ctx.ember.recordBaseline(123456);
		resultIs(await ctx.call(request()), "ok");
		const events = ctx.events().filter((e) => e.type === "baseline");
		assert.equal(events.length, 1, "Committed baseline event lost after append failure");
		assert.equal(events[0].baseline_micro_usd, 123456);
		reconcile(ctx);
	});
});

contract("TC-R01-6/request-append", async () => {
	await scenario({ script: [ok(sampleUsage, true), ok()] }, async (ctx) => {
		const running = ctx.call(request());
		await ctx.server.waitForRequests(1);
		let hit = 0;
		const result = await withFsOverrides(traceWrites(ctx, () => { hit++; deny(); }), async () => {
			ctx.server.release(0);
			return resultWithoutThrow(running);
		});
		assert.ok(hit, "Request trace failure was not injected");
		resultIs(await ctx.call(request()), "ok");
		const events = requestEvents(ctx);
		assert.equal(events.length, 2, "Missing original request event after append failure");
		const event = events.find((e) => e.cost_micro_usd === 152);
		assert.equal(event?.model, model);
		assert.equal(event?.request_digest, digest(ctx.server.requests[0].raw));
		assert.equal(event?.reasoning_tokens, 120);
		assert.equal(event?.input_tokens, 500);
		assert.equal(event?.cached_input_tokens, 500);
		assert.equal(event?.output_tokens, 200);
		assert.equal(event?.outcome, "ok");
		assert.equal(ctx.ledger().settled, 154);
		resultIs(result, "ledger_unreadable");
		reconcile(ctx);
	});
});

contract("TC-R01-6/refusal-append", async () => {
	await scenario({}, async (ctx) => {
		let hit = 0;
		const result = await withFsOverrides(traceWrites(ctx, () => { hit++; deny(); }), () =>
			resultWithoutThrow(ctx.call(request(1000, { caseBudget: 0 }))));
		assert.ok(hit, "Refusal trace failure was not injected");
		resultIs(await ctx.call(request()), "ok");
		const refusals = ctx.events().filter((e) => e.type === "refusal");
		assert.equal(refusals.length, 1, "Missing refusal after append failure");
		assert.equal(refusals[0].outcome, "budget_refused");
		assert.equal(refusals[0].request_digest, undefined);
		resultIs(result, "ledger_unreadable");
		reconcile(ctx);
	});
});

contract("TC-R01-6/truncated-tail", async () => {
	await scenario({ script: [ok(), ok()] }, async (ctx) => {
		resultIs(await ctx.call(request()), "ok");
		const events = ctx.events();
		const original = readFileSync(ctx.tracePath, "utf8");
		// Keep every complete line but only half of the last committed event.
		const lines = original.trimEnd().split("\n");
		const last = lines.pop();
		writeFileSync(ctx.tracePath, lines.join("\n") + "\n" + last.slice(0, Math.floor(last.length / 2)));
		const result = await resultWithoutThrow(ctx.call(request()));
		let recovered;
		try { recovered = ctx.events(); }
		catch { assert.fail("Truncated tail was not repaired"); }
		assert.equal(result.status, "ok");
		assert.equal(recovered.filter((e) => e.type === "request").length, 2);
		assert.ok(recovered.some((e) => e.request_digest === events.at(-1).request_digest));
		assert.equal(ctx.ledger().settled, 4);
		reconcile(ctx);
	});
});

contract("TC-R01-5/kill-in-lock", async () => {
	await scenario({ script: [ok(sampleUsage), ok()] }, async (ctx) => {
		const worker = await ctx.worker();
		worker.start(request(), "settlement-rename");
		await worker.waitFor("transaction");
		assert.ok(existsSync(ctx.lockPath), "Worker did not hold the lock at commit boundary");
		assert.equal(ctx.ledger().settled, 152);
		await worker.kill();
		resultIs(await ctx.call(request()), "ledger_unreadable");
		assert.equal(ctx.server.requests.length, 1, "Stale lock was not fail-closed");
		assert.ok(existsSync(ctx.lockPath), "Stale lock was silently removed");
		// Test owns the dead worker and lock; explicitly simulate operator quarantine.
		rmSync(ctx.lockPath);
		resultIs(await ctx.call(request()), "ok");
		assert.equal(ctx.ledger().settled, 154);
		const records = requestEvents(ctx);
		assert.equal(records.length, 2, "Crash lost original request event");
		assert.equal(records[0].request_digest, digest(ctx.server.requests[0].raw));
		assert.equal(records[0].model, model);
		assert.equal(records[0].cost_micro_usd, 152);
		reconcile(ctx);
	});
});

contract("TC-R01-4/settlement-lock", async () => {
	await scenario({ script: [ok(smallUsage, true), ok()] }, async (ctx) => {
		const dead = await ctx.worker();
		await dead.kill();
		const running = ctx.call(request());
		await ctx.server.waitForRequests(1);
		writeFileSync(ctx.lockPath, JSON.stringify({ pid: dead.pid }));
		ctx.server.release(0);
		const blocked = await resultWithoutThrow(running);
		assert.ok(booked(ctx.ledger()) > 0, "Unsettled liability released");
		assert.equal(ctx.server.requests.length, 1);
		rmSync(ctx.lockPath);
		resultIs(await ctx.call(request()), "ok");
		assert.equal(blocked.status, "ledger_unreadable", "Settlement lock failure reported success");
		reconcile(ctx);
	});
});

contract("TC-R02-2/concurrent-refusal", async () => {
	await scenario({}, async (ctx) => {
		let signal;
		let release;
		const entered = new Promise((resolve) => { signal = resolve; });
		const barrier = new Promise((resolve) => { release = resolve; });
		let first = true;
		const overrides = traceWrites(ctx, async (next, data) => {
			const events = String(data).trim().split("\n").map(JSON.parse);
			if (first && events.at(-1).type === "refusal") {
				first = false;
				signal();
				await barrier;
			}
			return next();
		});
		await withFsOverrides(overrides, async () => {
			const refused = ctx.call(request(1000, { caseBudget: 0 }));
			try {
				await Promise.race([entered, refused.then(() => assert.fail("Missing refusal write boundary"))]);
				const lockHeld = existsSync(ctx.lockPath);
				const admitted = ctx.call(request());
				if (!lockHeld) await admitted; // Expose stale total on an unserialized refusal.
				release(); // A serialized refusal must release before admission can finish.
				resultIs(await refused, "budget_refused");
				resultIs(await admitted, "ok");
			} finally {
				release();
			}
		});
		assert.equal(ctx.server.requests.length, 1);
		reconcile(ctx);
	});
});

contract("TC-R02-2/fresh-refusal", async () => {
	await scenario({}, async (ctx) => {
		rmSync(dirname(ctx.ledgerPath), { recursive: true });
		resultIs(await ctx.call(request(1000, { messages: [] })), "refused_input");
		assert.equal(ctx.server.requests.length, 0);
		assert.ok(existsSync(ctx.tracePath), "First refusal missing trace directory");
		const events = ctx.events();
		assert.equal(events.length, 1);
		assert.equal(events[0].type, "refusal");
		assert.equal(events[0].outcome, "refused_input");
		assert.equal(events[0].request_digest, undefined);
	});
});

contract("TC-R01-12/case-domain", async () => {
	for (const cases of [{ "case-a": "1" }, { "case-a": -1 }, { "case-a": 1.5 }, []]) {
		await scenario({}, async (ctx) => {
			writeFileSync(ctx.ledgerPath, JSON.stringify({ ...ctx.ledger(), cases }));
			resultIs(await ctx.call(request()), "ledger_unreadable");
			assert.equal(ctx.server.requests.length, 0);
		});
	}
});

contract("TC-R01-12/reservation-domain", async () => {
	for (const open of [
		[{ callId: "bad", upperBound: 100, caseId: 7 }],
		[{ callId: "same", upperBound: 10, caseId: "a" }, { callId: "same", upperBound: 20, caseId: "b" }],
	]) {
		await scenario({}, async (ctx) => {
			writeFileSync(ctx.ledgerPath, JSON.stringify({ ...ctx.ledger(), open }));
			resultIs(await ctx.call(request()), "ledger_unreadable");
			assert.equal(ctx.server.requests.length, 0);
		});
	}
});

contract("TC-R01-11/own-case-key", async () => {
	for (const caseId of ["__proto__", "constructor"]) {
		await scenario({ script: [ok(), ok()] }, async (ctx) => {
			resultIs(await ctx.call(request(1000, { caseId, caseBudget: 1000 })), "ok");
			const cases = ctx.ledger().cases;
			assert.ok(Object.hasOwn(cases, caseId), "Special case name is not an own key");
			assert.equal(cases[caseId], 2, "Special case spend is not numeric");
			resultIs(await ctx.call(request(1000, { caseId, caseBudget: 1000 })), "budget_refused");
			assert.equal(ctx.server.requests.length, 1);
		});
	}
});

contract("TC-R12-1/reply-content-types", async () => {
	for (const content of ["null", "[]", "12", '"text"', 42, null, {}]) {
		await scenario({ script: [{ mode: "ok", usage: smallUsage, content }] }, async (ctx) => {
			resultIs(await resultWithoutThrow(ctx.call(request())), "malformed_output");
			assert.equal(ctx.server.requests.length, 1);
			assert.equal(ctx.ledger().settled, 2, "Known usage lost on malformed content");
			reconcile(ctx);
		});
	}
});

contract("TC-R12-1/prompt-storage", async () => {
	await scenario({}, async (ctx) => {
		const prompts = join(dirname(ctx.ledgerPath), "prompts");
		rmSync(prompts, { recursive: true });
		writeFileSync(prompts, "blocked");
		resultIs(await resultWithoutThrow(ctx.call(request())), "ledger_unreadable");
		assert.equal(ctx.server.requests.length, 0);
		assert.equal(total(ctx.ledger()), 0);
	});
});

contract("TC-R12-1/lock-create", async () => {
	await scenario({}, async (ctx) => {
		const outcome = await withFsOverrides({
			writeFile: (next, path, ...args) => String(path).startsWith(ctx.lockPath) ? deny() : next(path, ...args),
		}, () => resultWithoutThrow(ctx.call(request())));
		resultIs(outcome, "ledger_unreadable");
		assert.equal(ctx.server.requests.length, 0);
		assert.equal(total(ctx.ledger()), 0);
	});
});

contract("TC-R12-1/lock-acquire", async () => {
	await scenario({}, async (ctx) => {
		const outcome = await withFsOverrides({
			link: (next, from, to) => to === ctx.lockPath ? deny() : next(from, to),
		}, () => resultWithoutThrow(ctx.call(request())));
		resultIs(outcome, "ledger_unreadable");
		assert.equal(ctx.server.requests.length, 0);
		assert.equal(total(ctx.ledger()), 0);
	});
});

contract("TC-R12-1/reserve-storage", async () => {
	await scenario({}, async (ctx) => {
		const outcome = await withFsOverrides({
			rename: (next, from, to) => to === ctx.ledgerPath ? deny() : next(from, to),
		}, () => resultWithoutThrow(ctx.call(request())));
		resultIs(outcome, "ledger_unreadable");
		assert.equal(ctx.server.requests.length, 0);
		assert.equal(total(ctx.ledger()), 0);
	});
});

contract("TC-R12-1/settle-storage", async () => {
	await scenario({ script: [ok(smallUsage, true)] }, async (ctx) => {
		const running = ctx.call(request());
		await ctx.server.waitForRequests(1);
		const reserved = booked(ctx.ledger());
		const outcome = await withFsOverrides({
			rename: (next, from, to) => to === ctx.ledgerPath ? deny() : next(from, to),
		}, async () => {
			ctx.server.release(0);
			return running.catch(() => ({ status: "threw" }));
		});
		assert.equal(booked(ctx.ledger()), reserved, "Booked spend disappeared on failed settlement");
		resultIs(outcome, "ledger_unreadable");
	});
});

contract("TC-R12-1/lock-release", async () => {
	await scenario({ script: [ok(smallUsage, true)] }, async (ctx) => {
		const running = ctx.call(request());
		await ctx.server.waitForRequests(1);
		const outcome = await withFsOverrides({
			unlink: (next, path) => path === ctx.lockPath ? deny() : next(path),
		}, async () => {
			ctx.server.release(0);
			return running.catch(() => ({ status: "threw" }));
		});
		assert.equal(ctx.ledger().settled, 2, "Known spend disappeared on unlock failure");
		resultIs(outcome, "ledger_unreadable");
	});
});

contract("TC-R01-8/frame-dimensions", async () => {
	// Valid grayscale PNG, 1281 x 1 pixels, with a single compressed zero row.
	const png = "iVBORw0KGgoAAAANSUhEUgAABQEAAAABCAAAAABLKTcXAAAAEklEQVR4nGNgGAWjYBSMgpEKAAUCAAF62d/4AAAAAElFTkSuQmCC";
	const options = request(1000, {
		max_output_tokens: 100,
		messages: [{ role: "user", content: [
			{ type: "image_url", image_url: { url: "data:image/png;base64," + png } },
		] }],
	});
	await scenario({}, async (ctx) => {
		const result = await ctx.call(options);
		assert.ok(["budget_refused", "refused_input"].includes(result.status), "Oversized frame admitted");
		assert.equal(ctx.server.requests.length, 0);
	});
});

contract("TC-R12-1/usage-numeric-domain", async () => {
	for (const reasoning_tokens of ["5", -1, 1.5, {}]) {
		const usage = { ...sampleUsage, completion_tokens_details: { reasoning_tokens } };
		await scenario({ script: [ok(usage)] }, async (ctx) => {
			resultIs(await ctx.call(request()), "malformed_output");
			assert.equal(ctx.server.requests.length, 1);
			assert.equal(booked(ctx.ledger()), 1000);
			reconcile(ctx);
		});
	}
});

contract("TC-R01-5/reused-owner", async () => {
	const reservation = {
		callId: "prior-request", upperBound: 1000, caseId: "prior-case", pid: process.pid,
	};
	await scenario({ open: [reservation] }, async (ctx) => {
		// A persisted reservation from a previous process incarnation has a PID
		// currently occupied by this caller. PID liveness cannot prove ownership.
		writeFileSync(ctx.tracePath, JSON.stringify({ type: "baseline", baseline_micro_usd: 0,
			cap_ledger_micro_usd: 0 }) + "\n");
		resultIs(await ctx.call(request()), "ok");
		assert.equal(booked(ctx.ledger()), 1000, "Unknown prior spend must stay booked");
		assert.ok(ctx.events().some((e) => e.type === "recovery" && e.callId === reservation.callId),
			"Live reused PID hid prior liability");
		reconcile(ctx);
	});
});

contract("TC-R12-1/out-storage", async () => {
	await scenario({}, async (ctx) => {
		const out = dirname(ctx.ledgerPath);
		rmSync(out, { recursive: true });
		writeFileSync(out, "blocked");
		resultIs(await resultWithoutThrow(ctx.call(request())), "ledger_unreadable");
		assert.equal(ctx.server.requests.length, 0);
	});
});

contract("TC-R12-1/settle-read", async () => {
	await scenario({ script: [ok(smallUsage, true)] }, async (ctx) => {
		const running = ctx.call(request());
		await ctx.server.waitForRequests(1);
		const reserved = booked(ctx.ledger());
		const outcome = await withFsOverrides({
			readFile: (next, path, ...args) => path === ctx.ledgerPath ? deny() : next(path, ...args),
		}, async () => {
			ctx.server.release(0);
			return resultWithoutThrow(running);
		});
		assert.equal(booked(ctx.ledger()), reserved, "Unreadable ledger lost booked spend");
		resultIs(outcome, "ledger_unreadable");
		assert.equal(ctx.server.requests.length, 1);
	});
});

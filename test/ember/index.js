import "./repair.js";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import timers from "node:timers/promises";
import {
	booked,
	cap,
	contract,
	exactUsage,
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
} from "../ember-harness.mjs";
import { sampleUsage } from "../fake-server.mjs";

// A fixed seed covers cap equality, one micro-dollar on either side, and
// rounding at different output lengths without relying on random scheduling.
function* generated(seed, count) {
	for (let i = 0; i < count; i++) {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		yield seed;
	}
}

contract("TC-R01-1", async () => {
	for (const [index, seed] of [...generated(0xf01, 9)].entries()) {
		const bound = 100 + (seed % 1000);
		const gap = (index % 3) - 1;
		const settled = seed % 100;
		const open = ((seed >>> 8) % 100) + 1;
		const baseline = cap - settled - open - bound - gap;
		await scenario(
			{
				baseline,
				settled,
				open: [{ callId: "prior", upperBound: open, caseId: "prior-case" }],
				script: [ok(exactUsage(bound))],
			},
			async (ctx) => {
				const options = request(bound);
				if (gap < 0) {
					await refuse(ctx, options);
				} else {
					resultIs(await ctx.call(options), "ok");
					assert.equal(ctx.server.requests.length, 1);
					assert.deepEqual(ctx.server.requests[0].body, wireBody(options));
					assert.equal(total(ctx.ledger()), cap - gap);
				}
			},
		);
	}
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
	for (const [index, seed] of [...generated(0xf03, 6)].entries()) {
		const bound = 1000 + (seed % 4000);
		const both = index % 2 === 0;
		const baseline = cap - 2 * bound - (both ? 0 : -1);
		await scenario(
			{
				baseline,
				script: [ok(exactUsage(bound), true), ok(exactUsage(bound), true)],
			},
			async (ctx) => {
				// Hold the first request until the second has reached admission. Both
				// reservations must coexist if it is admitted.
				const first = ctx.call(request(bound));
				await ctx.server.waitForRequests(1);
				const second = ctx.call(request(bound));
				const winner = await Promise.race([
					ctx.server.waitForRequests(2).then(() => "sent"),
					second.then(() => "refused"),
				]);
				ctx.server.release(0);
				if (winner === "sent") ctx.server.release(1);
				const results = await Promise.all([first, second]);
				assert.equal(
					winner,
					both ? "sent" : "refused",
					"Concurrent admission over cap",
				);
				assert.deepEqual(
					results.map((r) => r.status).sort(),
					both ? ["ok", "ok"] : ["budget_refused", "ok"],
				);
				assert.equal(ctx.server.requests.length, both ? 2 : 1);
				assert.equal(ctx.ledger().settled, (both ? 2 : 1) * bound);
				assert.ok(total(ctx.ledger()) <= cap);
				reconcile(ctx);
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
		resultIs(await worker.result(), "ledger_unreadable");
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
		const event = ctx.events().find((event) => event.type === "request");
		assert.equal(event?.cost_micro_usd, 152, "Lost original request event");
		assert.equal(event?.model, model);
		assert.equal(event?.input_tokens, 500);
		assert.equal(event?.cached_input_tokens, 500);
		assert.equal(event?.output_tokens, 200);
		assert.equal(event?.reasoning_tokens, 120);
		assert.equal(event?.outcome, "ok");
		assert.match(event?.request_digest ?? "", /^[a-f0-9]{64}$/);
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
		max_output_tokens: 1998,
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
				max_output_tokens: 1998,
				messages: [{ role: "user", content: "a".repeat(200001) }],
			}),
		);
	});
	await scenario(
		{
			baseline: cap - priced(mediaRequest("image")),
			script: [ok({ prompt_tokens: 1610, completion_tokens: 2 }, true)],
		},
		async (ctx) => {
			const input = mediaRequest("image");
			const encoded = input.messages[0].content[1].image_url.url.split(",")[1];
			const running = ctx.call(input);
			await ctx.server.waitForRequests(1);
			assert.equal(
				booked(ctx.ledger()),
				priced(input),
				"Frame bound must include wire framing and 1600 input tokens",
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
		{
			baseline: 8_910_000,
			script: [
				{ mode: "rate_limited", retryAfter: "1" },
				ok(exactUsage(40000)),
			],
		},
		async (ctx) => {
			const nativeSleep = timers.setTimeout;
			let signalWait;
			let releaseWait;
			const waiting = new Promise((resolve) => {
				signalWait = resolve;
			});
			const barrier = new Promise((resolve) => {
				releaseWait = resolve;
			});
			timers.setTimeout = (ms, ...args) => {
				if (ms !== 1000) return nativeSleep(ms, ...args);
				signalWait("timer");
				return barrier;
			};
			syncBuiltinESMExports();
			try {
				const running = ctx.call(request(40000));
				const observed = await Promise.race([
					waiting,
					ctx.server.waitForRequests(2).then(() => "sent"),
					running.then(() => "returned"),
				]);
				assert.equal(observed, "timer", "Retry ignored Retry-After");
				assert.equal(
					ctx.server.requests.length,
					1,
					"Retry before clock release",
				);
				releaseWait();
				resultIs(await running, "ok");
				assert.equal(ctx.server.requests.length, 2);
				assert.deepEqual(
					ctx.server.requests[0].body,
					ctx.server.requests[1].body,
				);
			} finally {
				releaseWait();
				timers.setTimeout = nativeSleep;
				syncBuiltinESMExports();
			}
			assert.equal(booked(ctx.ledger()), 40000);
			assert.equal(ctx.ledger().settled, 40000);
			assert.ok(total(ctx.ledger()) <= cap);
		},
	);
	await scenario(
		{ baseline: 8_950_000, script: [{ mode: "rate_limited" }] },
		async (ctx) => {
			resultIs(await ctx.call(request(40000)), "rate_limited");
			assert.equal(ctx.server.requests.length, 1);
			assert.equal(booked(ctx.ledger()), 40000);
			assert.ok(ctx.events().some((event) => event.type === "refusal"));
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
	// Generated event order: successful request, refusal, or unknown-usage
	// request; each trace delta must conserve the ledger at every quiescent step.
	for (const seed of generated(0xf02, 4)) {
		const kinds = Array.from({ length: 5 }, (_, i) => (seed >>> (i * 3)) % 3);
		const script = kinds
			.filter((kind) => kind !== 1)
			.map((kind) => (kind === 0 ? ok(smallUsage) : { mode: "missing_usage" }));
		await scenario({ baseline: null, script }, async (ctx) => {
			await ctx.ember.recordBaseline(seed % 1_000_000);
			let sent = 0;
			for (const kind of kinds) {
				if (kind === 1) await refuse(ctx, request(1000, { caseBudget: 0 }));
				else {
					resultIs(
						await ctx.call(request()),
						kind === 0 ? "ok" : "malformed_output",
					);
					sent++;
				}
				assert.equal(ctx.server.requests.length, sent);
				reconcile(ctx);
			}
		});
	}
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
		assert.deepEqual(ctx.server.requests[0].body, wireBody(request()));
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

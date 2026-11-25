import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
	censusOf,
	makeStages,
} from "../../../fixtures/stages/backlog-driver.mjs";
import {
	fixture,
	modelReply,
	product,
	readJson,
	startChild,
	temporary,
	withEmber,
} from "../support.mjs";

const eligible = "eligible_not_attempted";
const reply = modelReply({ answer: "ok" });
const stageNames = ["watch", "locate", "repro", "prove", "report"];

function config(root, callEmber, extra = {}) {
	return {
		runRoot: join(root, "out", "runs"),
		stages: makeStages(callEmber),
		...extra,
	};
}

test("TC-R09-1", { timeout: 120000 }, async () => {
	const backlog = await product("src/backlog.mjs", "backlog");
	const counts = [];
	for (const interrupt of [false, true]) {
		await temporary((root) =>
			withEmber(root, [reply, reply, reply], async ({ server, callEmber }) => {
				const opts = config(root, callEmber);
				const census = censusOf([eligible, eligible, eligible]);
				if (interrupt) {
					const result = await backlog(structuredClone(census), {
						...opts,
						stopAfter: { issue: 1, stage: "watch" },
					});
					assert.equal(result.status, "interrupted");
					assert.deepEqual(
						readJson(join(opts.runRoot, "1", "state.json")).completed,
						["watch"],
					);
				}
				const result = await backlog(structuredClone(census), opts);
				assert.equal(result.status, "ok");
				assert.equal(result.report.length, 3);
				assert.ok(
					result.report.every((row) => row.status === "proof_verified"),
				);
				assert.ok(
					result.report.every((row) => row.cost_micro_usd === 11),
					"Per-issue cost must survive resume",
				);
				for (let issue = 1; issue <= 3; issue++) {
					const state = readJson(
						join(opts.runRoot, String(issue), "state.json"),
					);
					assert.deepEqual(state.completed, stageNames);
				}
				counts.push(server.requests.length);
				const path = join(opts.runRoot, "1", "state.json");
				writeFileSync(path, "{broken");
				const before = server.requests.length;
				assert.equal(
					(await backlog(structuredClone(census), opts)).status,
					"refused_input",
				);
				assert.equal(server.requests.length, before);
			}),
		);
	}
	assert.deepEqual(counts, [3, 3]);
});

test("TC-R09-2", { timeout: 120000 }, async () => {
	const backlog = await product("src/backlog.mjs", "backlog");
	await temporary((root) =>
		withEmber(
			root,
			[{ mode: "slow" }, reply],
			async ({ server, env, callEmber, ledger }) => {
				const process = startChild([fixture("stages", "backlog-worker.mjs")], {
					cwd: root,
					env,
				});
				try {
					await server.waitForRequests(1);
					const prior = ledger().open[0];
					assert.ok(prior && prior.upperBound > 0);
					const exit = await process.stop("SIGKILL");
					assert.equal(exit.signal, "SIGKILL");
					const result = await backlog(
						censusOf([eligible]),
						config(root, callEmber),
					);
					assert.equal(result.status, "ok");
					assert.ok(server.requests.length <= 2);
					assert.ok(
						ledger().open.some(
							(item) =>
								item.callId === prior.callId &&
								item.upperBound === prior.upperBound,
						),
					);
					assert.deepEqual(
						readJson(join(root, "out", "runs", "1", "state.json")).completed,
						stageNames,
					);
					const count = server.requests.length;
					assert.equal(
						(await backlog(censusOf([eligible]), config(root, callEmber)))
							.status,
						"ok",
					);
					assert.equal(server.requests.length, count);
				} finally {
					await process.stop("SIGKILL");
				}
			},
		),
	);
});

test("TC-R09-3", async () => {
	const backlog = await product("src/backlog.mjs", "backlog");
	const statuses = [
		"no_usable_media",
		"unsupported_device",
		"excluded_sensitive_or_security",
		eligible,
		"attempted_miss",
		"failure_observed",
		"proof_verified",
	];
	const committed = readJson(fixture("census", "census.json"));
	assert.equal(committed.schema, "foley.census/1");
	assert.deepEqual(
		new Set(Object.keys(committed.status_set)),
		new Set(statuses),
	);
	await temporary((root) =>
		withEmber(root, [], async ({ server, callEmber }) => {
			const opts = config(root, callEmber, { maxIssues: 0 });
			const result = await backlog(censusOf(statuses), opts);
			assert.equal(result.status, "ok");
			assert.deepEqual(
				result.report.map((row) => row.status),
				statuses,
			);
			assert.equal(new Set(result.report.map((row) => row.issue)).size, 7);
			assert.deepEqual(
				readJson(join(root, "out", "backlog-report.json")),
				result.report,
			);
			assert.equal(
				(await backlog(censusOf(["unknown"]), opts)).status,
				"refused_input",
			);
			assert.equal(server.requests.length, 0);
		}),
	);
});

test("TC-R09-4", { timeout: 120000 }, async () => {
	const backlog = await product("src/backlog.mjs", "backlog");
	await temporary((root) =>
		withEmber(
			root,
			[
				{ ...reply, hold: true },
				{ ...reply, hold: true },
			],
			async ({ server, callEmber }) => {
				const running = backlog(
					censusOf([eligible, eligible]),
					config(root, callEmber),
				);
				running.catch(() => {});
				for (let index = 0; index < 2; index++) {
					await server.waitForRequests(index + 1);
					server.release(index);
				}
				assert.equal((await running).status, "ok");
				assert.equal(server.requests.length, 2);
				assert.ok(
					server.requests[0].completedAt <= server.requests[1].receivedAt,
				);
				assert.ok(
					server.requests[0].completedOrder < server.requests[1].startedOrder,
				);
			},
		),
	);
});

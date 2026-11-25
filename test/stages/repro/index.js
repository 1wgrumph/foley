import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { test } from "node:test";
import {
	archive,
	modelReply,
	product,
	readJson,
	temporary,
	withApps,
	withEmber,
} from "../support.mjs";

const action = (selector, order = 1) => ({
	order,
	t_s: order,
	action: "click",
	target: selector,
	selector,
});
const final = (actions) => ({ actions, done: true, verdict: "reproduced" });
const archiveAction = archive.steps[0];
function options(root, name, extra = {}) {
	const runDir = join(root, name);
	mkdirSync(runDir);
	return { runDir, caseId: name, caseBudget: 100000, ...extra };
}

function evidence(result, runDir, reproduced) {
	assert.equal(result.status, reproduced ? "reproduced" : "not_reproduced");
	assert.equal(result.observed, reproduced);
	const replay = readJson(join(runDir, "replay.json"));
	assert.equal(replay.status, result.status);
	assert.equal(replay.observed, reproduced);
	assert.ok(replay.screenshots.length > 0);
	for (const frame of replay.screenshots) {
		assert.ok(!isAbsolute(frame.path) && !frame.path.split("/").includes(".."));
		assert.equal(
			readFileSync(join(runDir, frame.path)).subarray(1, 4).toString(),
			"PNG",
		);
	}
	return replay;
}

test("TC-R06-1", { timeout: 120000 }, async () => {
	const repro = await product("src/repro.mjs", "repro");
	await temporary((root) =>
		withApps(root, async ({ bug, fixed }) => {
			for (const [app, reproduced, name] of [
				[bug, true, "bug"],
				[fixed, false, "fixed"],
			]) {
				const opts = options(root, name, { scripted: true });
				const result = await repro(
					archive.steps,
					archive.predicate,
					app.origin,
					opts,
				);
				evidence(result, opts.runDir, reproduced);
				assert.ok(app.requests.includes("/"));
			}
		}),
	);
});

test("TC-R06-2", { timeout: 120000 }, async () => {
	const repro = await product("src/repro.mjs", "repro");
	await temporary((root) =>
		withApps(root, async ({ bug, decoy }) => {
			const opts = options(root, "boundary", { scripted: true });
			const steps = [
				"#other-origin",
				"#file-link",
				"#download",
				"#archive",
			].map((selector, i) => action(selector, i + 1));
			const replay = evidence(
				await repro(steps, archive.predicate, bug.origin, opts),
				opts.runDir,
				true,
			);
			for (const reason of ["origin", "file_url", "download"]) {
				assert.ok(
					replay.events.some(
						(event) => event.type === "blocked" && event.reason === reason,
					),
					`Missing blocked event: ${reason}`,
				);
			}
			assert.equal(decoy.requests.length, 0);
			assert.ok(bug.requests.includes("/"));
			assert.equal(existsSync(join(opts.runDir, "fixture.txt")), false);
		}),
	);
});

test("TC-R06-3", { timeout: 120000 }, async () => {
	const repro = await product("src/repro.mjs", "repro");
	const undeclared = ["evaluate", "file_upload", "unknown"];
	const actions = [
		...undeclared.map((kind) => ({
			action: kind,
			target: "synthetic fixture text",
		})),
		archiveAction,
	];
	await temporary((root) =>
		withApps(root, ({ bug }) =>
			withEmber(
				root,
				[modelReply(final(actions))],
				async ({ server, callEmber }) => {
					const opts = options(root, "actions", { callEmber });
					const replay = evidence(
						await repro(archive.steps, archive.predicate, bug.origin, opts),
						opts.runDir,
						true,
					);
					for (const kind of undeclared) {
						assert.ok(
							replay.events.some(
								(event) =>
									event.type === "dropped_action" && event.action === kind,
							),
						);
						assert.ok(
							!replay.events.some(
								(event) => event.type === "action" && event.action === kind,
							),
						);
					}
					assert.ok(
						replay.events.some(
							(event) => event.type === "action" && event.action === "click",
						),
					);
					assert.ok(server.requests.length > 0);
				},
			),
		),
	);
});

test("TC-R06-5", { timeout: 120000 }, async () => {
	const repro = await product("src/repro.mjs", "repro");
	// The first reply falsely claims success and contaminates this context's local
	// storage. The archive predicate is only observable in a fresh context.
	const first = final([action("#touch")]);
	const second = final([archiveAction]);
	await temporary((root) =>
		withApps(root, ({ bug }) =>
			withEmber(
				root,
				[modelReply(first, { hold: true }), modelReply(second, { hold: true })],
				async ({ server, callEmber, ledger }) => {
					const opts = options(root, "retry", { callEmber });
					const running = repro(
						archive.steps,
						archive.predicate,
						bug.origin,
						opts,
					);
					running.catch(() => {});
					const ids = [];
					for (let i = 0; i < 2; i++) {
						await server.waitForRequests(i + 1);
						const current = ledger();
						assert.equal(current.open.length, 1);
						assert.equal(current.open[0].caseId, opts.caseId);
						ids.push(current.open[0].callId);
						server.release(i);
					}
					const replay = evidence(await running, opts.runDir, true);
					assert.equal(new Set(ids).size, 2);
					assert.ok(replay.attempts.length >= 2 && replay.attempts.length <= 3);
					assert.equal(
						new Set(replay.attempts.map((attempt) => attempt.contextId)).size,
						replay.attempts.length,
					);
					assert.equal(replay.attempts[0].observed, false);
					assert.equal(replay.attempts.at(-1).observed, true);
					assert.equal(ledger().open.length, 0);
				},
			),
		),
	);
	// One full 6,000-output-token charge leaves less than a second output bound.
	await temporary((root) =>
		withApps(root, ({ bug }) =>
			withEmber(
				root,
				[
					modelReply(first, {
						usage: { prompt_tokens: 10, completion_tokens: 6000 },
					}),
				],
				async ({ server, callEmber, ledger }) => {
					const opts = options(root, "single-attempt-budget", {
						callEmber,
						caseBudget: 4000,
						maxOutputTokens: 6000,
					});
					const replay = evidence(
						await repro(archive.steps, archive.predicate, bug.origin, opts),
						opts.runDir,
						false,
					);
					assert.equal(server.requests.length, 1);
					assert.ok(replay.attempts.length <= 2);
					assert.ok(
						ledger().settled +
							ledger().open.reduce((sum, item) => sum + item.upperBound, 0) <=
							4000,
					);
				},
			),
		),
	);
});

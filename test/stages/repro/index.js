import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { test } from "node:test";
import {
	archive,
	modelReply,
	product,
	readJson,
	sha256,
	temporary,
	wirePrice,
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
				const replay = evidence(result, opts.runDir, reproduced);
				assert.ok(app.requests.includes("/"));
				// What the page showed for the predicate, for Watch's feedback.
				assert.equal(
					replay.attempts[0].predicate_value,
					reproduced ? "Not archived" : "Archived",
				);
				// The actions that showed the failure become steps for the proof.
				assert.deepEqual(
					replay.reproduced_steps,
					reproduced
						? [
								{
									order: 1,
									t_s: 0,
									action: "click",
									target: "Archive",
									selector: "#archive",
								},
							]
						: undefined,
				);
			}
			// A predicate that holds on the freshly loaded page shows nothing the
			// steps cause: no step runs and the run reports why.
			const opts = options(root, "holds-before", { scripted: true });
			const result = await repro(
				archive.steps,
				{ ...archive.predicate, expected: "Archived", observed: "Ready" },
				bug.origin,
				opts,
			);
			assert.equal(result.status, "not_reproduced");
			assert.deepEqual(
				result.events
					.filter((e) => e.type !== "blocked")
					.map((e) => (e.type === "stopped" ? e.reason : e.type)),
				["predicate_holds_before"],
			);
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
				async ({ server, callEmber, ledger, trace }) => {
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
						assert.equal(
							current.open[0].upperBound,
							wirePrice(server.requests[i].body),
						);
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
					for (const [index, id] of ids.entries()) {
						const event = trace().find(
							(entry) => entry.type === "request" && entry.callId === id,
						);
						assert.equal(
							event?.request_digest,
							sha256(server.requests[index].raw),
						);
						assert.notEqual(event?.bound_violated, true);
					}
				},
			),
		),
	);
	// Allow wire framing and screenshot input while leaving less than a second output bound after settlement.
	await temporary((root) =>
		withApps(root, ({ bug }) =>
			withEmber(
				root,
				[
					modelReply(first, {
						usage: { prompt_tokens: 10, completion_tokens: 6000 },
					}),
				],
				async ({ server, callEmber, ledger, trace }) => {
					const opts = options(root, "single-attempt-budget", {
						callEmber,
						caseBudget: 5500,
						maxOutputTokens: 6000,
					});
					const replay = evidence(
						await repro(archive.steps, archive.predicate, bug.origin, opts),
						opts.runDir,
						false,
					);
					assert.equal(server.requests.length, 1);
					assert.equal(server.requests[0].body.max_completion_tokens, 6000);
					assert.ok(wirePrice(server.requests[0].body) <= opts.caseBudget);
					assert.equal(ledger().settled, 3001);
					assert.ok(ledger().settled + 3000 > opts.caseBudget);
					assert.ok(!trace().some((event) => event.bound_violated === true));
					assert.ok(replay.attempts.length <= 2);
					assert.ok(
						ledger().settled +
							ledger().open.reduce((sum, item) => sum + item.upperBound, 0) <=
							opts.caseBudget,
					);
				},
			),
		),
	);
});

// S5 live: an invalid JSON turn runs none of its actions and gets one re-ask
// that names the broken rule; a valid answer then reproduces.
test("TC-R06-3/reask", { timeout: 120000 }, async () => {
	const repro = await product("src/repro.mjs", "repro");
	await temporary((root) =>
		withApps(root, ({ bug }) =>
			withEmber(
				root,
				[
					modelReply(
						final([{ action: "click", x: 5, y: 5, note: "REJECTED-VALUE-77" }]),
					),
					// A wait written as decimal text is a valid wait.
					modelReply(final([archiveAction, { action: "wait", value: "200" }])),
				],
				async ({ callEmber, server }) => {
					const opts = options(root, "reask", {
						callEmber,
						appNotes: "K laser pointer",
					});
					const result = await repro(
						archive.steps,
						archive.predicate,
						bug.origin,
						opts,
					);
					evidence(result, opts.runDir, true);
					assert.equal(server.requests.length, 2);
					assert.match(
						server.requests[1].body.messages.at(-1).content,
						/failed validation and none of its actions ran: action 1 is invalid/,
					);
					// W4-11: the diagnostic names the rule, never the rejected value.
					assert.ok(
						!server.requests[1].body.messages
							.at(-1)
							.content.includes("REJECTED-VALUE-77"),
						"Diagnostic echoed a rejected value",
					);
					const first = JSON.parse(
						server.requests[0].body.messages[1].content[0].text,
					);
					assert.equal(first.app_notes, "K laser pointer");
					// What the failure check reads before any action.
					assert.equal(first.failure_check_now, "Ready");
				},
			),
		),
	);
});

// S5 live: the replay records which key each key_press sent.
test("TC-R06-1/key-detail", { timeout: 120000 }, async () => {
	const repro = await product("src/repro.mjs", "repro");
	await temporary((root) =>
		withApps(root, async ({ bug }) => {
			const opts = options(root, "keys", { scripted: true });
			const key = {
				order: 1,
				t_s: 0,
				action: "key_press",
				target: "Escape",
				value: "Escape",
			};
			const steps = [key, { ...archiveAction, order: 2 }];
			const result = await repro(steps, archive.predicate, bug.origin, opts);
			assert.deepEqual(
				result.events
					.filter((e) => e.action === "key_press")
					.map((e) => e.detail),
				["Escape"],
			);
		}),
	);
});

// S6b (a): type with no selector types into the focused element only; a type
// aimed at a selector that is not on the page runs nothing.
test("TC-R06-1/focused-type", { timeout: 120000 }, async () => {
	const repro = await product("src/repro.mjs", "repro");
	const typed = {
		kind: "visible_text",
		selector: "#typed",
		expected: "",
		observed: "hello",
	};
	await temporary((root) =>
		withApps(root, ({ bug }) =>
			withEmber(
				root,
				[
					modelReply(
						final([
							{ action: "type", selector: "#missing", value: "x" },
							{ action: "click", selector: "#note" },
							{ action: "type", value: "hello" },
						]),
					),
				],
				async ({ callEmber }) => {
					const opts = options(root, "focused", { callEmber });
					const result = await repro(archive.steps, typed, bug.origin, opts);
					evidence(result, opts.runDir, true);
					const types = result.events.filter((e) => e.action === "type");
					assert.deepEqual(
						types.map((e) => e.type),
						["action_error", "action"],
					);
				},
			),
		),
	);
});

// S6b (b, c): unambiguous turn forms run without a re-ask: a free-text verdict
// on an unfinished turn is dropped, a drag missing one end coordinate keeps its
// start value, and a pointer click with only a selector is a click.
test("TC-R06-3/canonical-turn", { timeout: 120000 }, async () => {
	const repro = await product("src/repro.mjs", "repro");
	await temporary((root) =>
		withApps(root, ({ bug }) =>
			withEmber(
				root,
				[
					modelReply({
						actions: [
							{ action: "pointer_drag", x: 10, y: 600, to_x: 40 },
							{ action: "pointer_click", selector: "#archive" },
						],
						done: false,
						verdict: "pending",
					}),
					modelReply(final([])),
				],
				async ({ callEmber, server }) => {
					const opts = options(root, "canonical", { callEmber });
					const result = await repro(
						archive.steps,
						archive.predicate,
						bug.origin,
						opts,
					);
					evidence(result, opts.runDir, true);
					assert.equal(server.requests.length, 2);
					assert.ok(!result.events.some((e) => e.type === "reask"));
					const actions = result.events.filter((e) => e.type === "action");
					assert.deepEqual(
						actions.slice(0, 2).map((e) => [e.action, e.detail]),
						[
							["pointer_drag", "10,600 to 40,600"],
							["click", "#archive"],
						],
					);
				},
			),
		),
	);
});

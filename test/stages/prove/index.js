import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
	anchor,
	archive,
	fixture,
	modelReply,
	product,
	proofCode,
	readJson,
	syntheticKey,
	temporary,
	withApps,
	withEmber,
} from "../support.mjs";

const candidate = (code) =>
	modelReply({
		code,
		filename: "regression.test.mjs",
		assertion: "archive-status",
	});
const importTest =
	'import { test } from "node:test";\nimport assert from "node:assert/strict";\n';
async function proofScenario(prove, code, run, extra = {}, first = []) {
	await temporary((root) =>
		withEmber(
			root,
			[...first, ...Array.from({ length: 4 }, () => candidate(code))],
			async ({ server, callEmber }) => {
				const runDir = join(root, "run");
				mkdirSync(runDir);
				const targetDir = join(root, "target");
				const fixedTargetDir = join(root, "fixed-target");
				cpSync(fixture("app"), targetDir, { recursive: true });
				cpSync(fixture("app-fixed"), fixedTargetDir, { recursive: true });
				const opts = {
					runDir,
					targetDir,
					fixedTargetDir,
					runner: "node-test",
					callEmber,
					caseId: "prove-test",
					caseBudget: 100000,
					timeoutMs: 6000,
					memoryMiB: 64,
					...extra,
				};
				const result = await prove(
					archive.steps,
					[anchor],
					archive.predicate,
					opts,
				);
				assert.equal(
					readJson(join(runDir, "proof.json")).status,
					result.status,
				);
				assert.equal(
					readFileSync(join(targetDir, "logic.mjs"), "utf8"),
					readFileSync(fixture("app", "logic.mjs"), "utf8"),
				);
				assert.equal(existsSync(join(targetDir, "regression.test.mjs")), false);
				assert.equal(
					existsSync(join(fixedTargetDir, "regression.test.mjs")),
					false,
				);
				for (const attempt of result.attempts) {
					if (attempt.sandboxPath) {
						assert.notEqual(attempt.sandboxPath, opts.targetDir);
						assert.equal(
							existsSync(attempt.sandboxPath),
							false,
							"Disposable copy left behind",
						);
					}
				}
				assert.ok(
					!JSON.stringify(result).includes(syntheticKey),
					"Credential in proof result",
				);
				await run(result, { runDir, server });
			},
		),
	);
}

function accepted(result, runDir) {
	assert.equal(result.status, "verified");
	assert.equal(result.path, "regression.test.mjs");
	assert.equal(
		readFileSync(join(runDir, result.path), "utf8").trim(),
		proofCode.trim(),
	);
	const attempt = result.attempts.at(-1);
	assert.equal(attempt.reason, "verified");
	assert.equal(attempt.bug.exitCode, 1);
	assert.match(attempt.bug.output, /archive-status/);
	assert.equal(attempt.fixed.exitCode, 0);
	assert.equal(result.rerun_without_ember.bug.exitCode, 1);
	assert.equal(result.rerun_without_ember.fixed.exitCode, 0);
}

// S6 live: a reply that is not a JSON object is a failed round, not the end.
test("TC-R07-1/malformed-round", { timeout: 120000 }, async () => {
	const prove = await product("src/prove.mjs", "prove");
	await proofScenario(
		prove,
		proofCode,
		(result, { runDir }) => {
			accepted(result, runDir);
			assert.equal(result.attempts[0].reason, "malformed_candidate");
		},
		{},
		[
			{
				mode: "invalid_output",
				usage: { prompt_tokens: 10, completion_tokens: 20 },
			},
		],
	);
});

test("TC-R07-1", { timeout: 120000 }, async () => {
	const prove = await product("src/prove.mjs", "prove");
	// The target's test notes and the issue title reach the model as data (S5 live misses).
	await proofScenario(
		prove,
		proofCode,
		(result, { runDir, server }) => {
			accepted(result, runDir);
			const sent = JSON.parse(server.requests[0].body.messages[1].content);
			assert.equal(sent.target_test_notes, "Tests import ./logic.mjs.");
			assert.equal(sent.report_title, "Archive shows the wrong status");
		},
		{
			testNotes: "Tests import ./logic.mjs.",
			reportTitle: "Archive shows the wrong status",
		},
	);
});

test("TC-R07-2", { timeout: 240000 }, async () => {
	const prove = await product("src/prove.mjs", "prove");
	const cases = [
		['import "./absent-fixture.mjs";', "import_error"],
		["const = ;", "syntax_error"],
		[
			`${importTest}test("timeout", async () => { await new Promise(() => setInterval(() => {}, 1000)); });`,
			"timeout",
		],
		[
			`${importTest}test("unconditional", () => assert.equal(true, false));`,
			"unconditional_failure",
		],
		[
			`${importTest}test("unrelated", () => assert.equal(2, 3, "unrelated element"));`,
			"wrong_predicate",
		],
	];
	for (const [code, reason] of cases) {
		await proofScenario(
			prove,
			code,
			(result, { runDir }) => {
				assert.equal(result.status, "not_verified");
				assert.ok(result.attempts.length > 0 && result.attempts.length <= 4);
				assert.ok(
					result.attempts.every((attempt) => attempt.reason === reason),
					reason,
				);
				assert.equal(existsSync(join(runDir, "regression.test.mjs")), false);
			},
			{ timeoutMs: reason === "timeout" ? 3000 : 10000 },
		);
	}
	await proofScenario(prove, proofCode, (result, { runDir }) =>
		accepted(result, runDir),
	);
});

test("TC-R07-3", { timeout: 240000 }, async () => {
	const prove = await product("src/prove.mjs", "prove");
	// All probes target only synthetic, test-owned data. No sensitive path or
	// external host is named. Memory allocation and timer faults are bounded.
	process.env.FOLEY_PARENT_SENTINEL = "synthetic-parent-only";
	try {
		await temporary((root) =>
			withApps(root, async ({ decoy, outside }) => {
				const cases = [
					[
						`${importTest}test("no credential", () => { console.log(JSON.stringify(Object.keys(process.env))); assert.equal(process.env.MODEL_API_KEY, undefined); assert.equal(process.env.FOLEY_TEST_API_KEY, undefined); assert.equal(process.env.FOLEY_PARENT_SENTINEL, undefined); });`,
						"wrong_predicate",
					],
					[
						`${importTest}test("network control", async () => { const response = await fetch(${JSON.stringify(decoy.origin)}); assert.ok(response.ok); });`,
						"network_denied",
					],
					[
						`${importTest}import { readFileSync } from "node:fs"; test("outside control", () => { assert.equal(readFileSync(${JSON.stringify(outside)}, "utf8"), "synthetic outside sentinel"); });`,
						"filesystem_denied",
					],
					[
						`${importTest}test("timer control", async () => { await new Promise(() => setInterval(() => {}, 1000)); });`,
						"timeout",
					],
					[
						`${importTest}test("memory control", () => { const values = new Array(24 * 1024 * 1024).fill(1); assert.equal(values.length, 24 * 1024 * 1024); });`,
						"memory_limit",
					],
				];
				for (const [code, reason] of cases) {
					await proofScenario(
						prove,
						code,
						(result, { runDir }) => {
							assert.equal(result.status, "not_verified");
							assert.ok(result.attempts.length > 0);
							assert.ok(
								result.attempts.every((attempt) => attempt.reason === reason),
								reason,
							);
							assert.ok(
								result.attempts.every((attempt) => attempt.sandboxPath),
							);
							assert.ok(
								result.attempts.every(
									(attempt) => !JSON.stringify(attempt).includes(syntheticKey),
								),
							);
							if (reason === "wrong_predicate") {
								assert.ok(
									result.attempts.every(
										(attempt) => attempt.bug.exitCode === 0,
									),
								);
							} else {
								assert.ok(
									result.attempts.every(
										(attempt) => attempt.bug.exitCode !== 0,
									),
								);
							}
							assert.equal(
								existsSync(join(runDir, "regression.test.mjs")),
								false,
							);
						},
						{ timeoutMs: reason === "timeout" ? 3000 : 10000 },
					);
				}
				assert.equal(decoy.requests.length, 0);
				assert.equal(
					readFileSync(outside, "utf8"),
					"synthetic outside sentinel",
				);
			}),
		);
	} finally {
		delete process.env.FOLEY_PARENT_SENTINEL;
	}
});

test("TC-R07-4", { timeout: 120000 }, async () => {
	const prove = await product("src/prove.mjs", "prove");
	process.env.FOLEY_DISABLE_ISOLATION = "1";
	try {
		await proofScenario(prove, proofCode, (result, { runDir, server }) => {
			assert.equal(result.status, "refused_isolation");
			assert.equal(server.requests.length, 0);
			assert.deepEqual(result.attempts, []);
			assert.equal(existsSync(join(runDir, "regression.test.mjs")), false);
			assert.match(result.reason, /isolation/i);
		});
	} finally {
		delete process.env.FOLEY_DISABLE_ISOLATION;
	}
	await proofScenario(prove, proofCode, (result, { runDir }) =>
		accepted(result, runDir),
	);
});

// S6b (d): with no fixed build, a red test that shows the predicate's values is
// kept with its failing output, and named for what it is.
test("TC-R07-1/red-test-no-control", { timeout: 120000 }, async () => {
	const prove = await product("src/prove.mjs", "prove");
	await proofScenario(
		prove,
		proofCode,
		(result, { runDir }) => {
			assert.equal(result.status, "red_test");
			assert.equal(result.path, "regression.test.mjs");
			assert.equal(
				readFileSync(join(runDir, result.path), "utf8").trim(),
				proofCode.trim(),
			);
			assert.match(
				readFileSync(join(runDir, result.red_output), "utf8"),
				/archive-status/,
			);
			assert.notEqual(result.rerun_without_ember.bug.exitCode, 0);
			assert.equal(result.rerun_without_ember.fixed, null);
		},
		{ fixedTargetDir: undefined },
	);
});

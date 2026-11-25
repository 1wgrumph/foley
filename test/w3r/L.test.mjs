import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
	archive,
	clip,
	entry,
	fixture,
	localEnv,
	modelReply,
	pinFixture,
	readJson,
	sha256,
	startChild,
	temporary,
	withApps,
	withEmber,
	writeJson,
} from "../stages/support.mjs";

const crate = entry("foley-crates/bran-media-evidence/Cargo.toml");
const binary = join(crate, "..", "target/debug/bran-media-evidence");
const cli = entry("bin/foley.mjs");
const held = readJson(fixture("eval", "held-out.json"));
const tuning = readJson(fixture("eval", "tuning.json"));
const ids = held.entries.map((e) => e.issue);
const tuningId = tuning.entries[0].issue;

function locate(repo, steps) {
	return spawnSync(binary, ["--repo", repo, "--steps", steps], {
		encoding: "utf8",
		env: {},
		timeout: 60000,
	});
}

test("TC-R05-1/graph-tie", async () => {
	await temporary((root) => {
		const repo = join(root, "repo");
		mkdirSync(repo);
		for (const file of ["a.mjs", "zArchive.mjs"])
			writeFileSync(join(repo, file), 'export const label = "Archive";\n');
		const steps = join(root, "steps.json");
		writeJson(steps, { ...archive, predicate: null });
		const result = locate(repo, steps);
		assert.equal(result.status, 0, result.stderr);
		assert.deepEqual(
			JSON.parse(result.stdout).anchors.map((a) => a.file),
			["zArchive.mjs", "a.mjs"],
			"At equal line-match scores, the BRAN file-name match takes precedence",
		);
	});
});

test("TC-R05-1/json-number-grammar", async () => {
	await temporary((root) => {
		const repo = join(root, "repo");
		mkdirSync(repo);
		writeFileSync(join(repo, "logic.mjs"), 'export const label = "Archive";\n');
		const steps = join(root, "steps.json");
		const accepted = [];
		for (const number of [
			"0",
			"-0",
			"12",
			"0.25",
			"-2.5e+3",
			"01",
			"-01",
			"1.",
			"-.5",
			"1.e2",
		]) {
			const raw = JSON.stringify({
				...archive,
				predicate: null,
				steps: [{ ...archive.steps[0], t_s: "NUMBER" }],
			}).replace('"NUMBER"', number);
			writeFileSync(steps, raw);
			const result = locate(repo, steps);
			if (result.status === 0) {
				assert.equal(JSON.parse(result.stdout).anchors[0].file, "logic.mjs");
				accepted.push(number);
			} else {
				assert.equal(result.status, 1, result.stderr);
				assert.match(result.stderr, /invalid JSON/i);
			}
		}
		assert.deepEqual(accepted, ["0", "-0", "12", "0.25", "-2.5e+3"]);
	});
});

function evalCorpus(root) {
	mkdirSync(join(root, "fixtures/eval"), { recursive: true });
	mkdirSync(join(root, "fixtures/census"), { recursive: true });
	for (const filename of ["held-out.json", "tuning.json"])
		cpSync(fixture("eval", filename), join(root, "fixtures/eval", filename));
	cpSync(
		fixture("census", "census.json"),
		join(root, "fixtures/census/census.json"),
	);
	mkdirSync(join(root, "out/runs"), { recursive: true });
}

function cliRun(root, args, env = localEnv()) {
	return startChild(
		["--import", fixture("stages", "loopback-only.mjs"), cli, ...args],
		{ cwd: root, env },
	).done;
}

// W4-07: an issue's evaluation cost is its latest run's own cost; what its
// case spent over every run is reported beside it, never averaged as a run.
test("TC-R10-1/eval-run-cost", async () => {
	await temporary((root) => {
		evalCorpus(root);
		writeJson(join(root, "out/backlog-report.json"), [
			{ issue: ids[0], status: "attempted_miss", cost_micro_usd: 900 },
		]);
		const dir = join(root, "out/runs", String(ids[0]));
		mkdirSync(dir);
		writeJson(join(dir, "run.json"), {
			anchors: [],
			elapsed_ms: 12,
			cost_micro_usd: 100,
			case_cost_micro_usd: 900,
		});
		return cliRun(root, ["eval", "--max-issues", "0"]).then((result) => {
			assert.equal(result.code, 0, result.stderr);
			const report = readJson(join(root, "out/eval-report.json"));
			assert.equal(report.cost_per_attempt_micro_usd, 100);
			assert.equal(report.results[0].cost_micro_usd, 100);
			assert.equal(report.results[0].case_cost_micro_usd, 900);
		});
	});
});

test("TC-R10-1/eval-population", async () => {
	await temporary((root) => {
		evalCorpus(root);
		const rows = [
			{ issue: ids[0], status: "attempted_miss", cost_micro_usd: 100 },
			{ issue: tuningId, status: "proof_verified", cost_micro_usd: 900 },
		];
		writeJson(join(root, "out/backlog-report.json"), rows);
		for (const [issue, time] of [
			[ids[0], 12],
			[tuningId, 99],
		]) {
			const dir = join(root, "out/runs", String(issue));
			mkdirSync(dir);
			writeJson(join(dir, "run.json"), { anchors: [], elapsed_ms: time });
		}
		return cliRun(root, ["eval", "--max-issues", "0"]).then((result) => {
			assert.equal(result.code, 0, result.stderr);
			const report = readJson(join(root, "out/eval-report.json"));
			assert.equal(
				report.success_per_attempt,
				0,
				"A tuning proof is not a held-out success",
			);
			assert.equal(report.success_per_eligible, 0);
			assert.equal(report.cost_per_attempt_micro_usd, 100);
			assert.equal(report.cost_per_verified_proof_micro_usd, null);
			assert.equal(report.elapsed_ms, 12);
			assert.deepEqual(report.misses, ids);
			assert.deepEqual(
				report.results.map((r) => r.issue),
				ids,
			);
			assert.ok(
				report.results
					.slice(1)
					.every(
						(r) =>
							r.status === "eligible_not_attempted" &&
							r.cost_micro_usd === 0 &&
							r.elapsed_ms === 0 &&
							r.anchors.length === 0,
					),
			);
		});
	});
});

test("TC-R10-2/eval-split", async () => {
	await temporary(async (root) => {
		evalCorpus(root);
		writeJson(join(root, "out/backlog-report.json"), []);
		const bad = {
			...held,
			entries: [tuning.entries[0], ...held.entries.slice(1)],
		};
		writeJson(join(root, "fixtures/eval/substituted.json"), bad);
		await withEmber(root, [], async ({ env, server }) => {
			const result = await cliRun(
				root,
				["eval", "--labels", "fixtures/eval/substituted.json", "--dry-run"],
				env,
			);
			assert.equal(server.requests.length, 0);
			assert.equal(
				result.code,
				2,
				"A substituted tuning label must be refused",
			);
			assert.match(result.stderr, /bad_labels/);
		});
	});
});

function cachedCorpus(root, origin) {
	evalCorpus(root);
	const { target, revision } = pinFixture(root);
	const digest = sha256(readFileSync(clip));
	const cache = join(root, "cache");
	mkdirSync(cache);
	cpSync(clip, join(cache, `${digest}.mp4`));
	const candidates = [tuningId, ...ids].map((issue) => ({
		issue,
		url: `https://example.invalid/issues/${issue}`,
		status: "eligible_not_attempted",
		media: [{ media_type: "video/mp4", sha256: digest }],
	}));
	writeJson(join(root, "fixtures/census/census.json"), {
		schema: "foley.census/1",
		generated_on: "2026-11-24",
		repository: "fixture/app",
		target_revision: revision,
		candidates,
	});
	// Preserve the frozen IDs but use the owned fixture's revision and clip.
	for (const filename of ["held-out.json", "tuning.json"]) {
		const path = join(root, "fixtures/eval", filename);
		writeJson(path, { ...readJson(path), target_revision: revision });
	}
	writeJson(join(root, "out/backlog-report.json"), []);
	return [
		"--target",
		target,
		"--app-origin",
		origin,
		"--runner",
		"node-test",
		"--case-budget",
		"100000",
		"--media-dir",
		cache,
	];
}

test("TC-R10-3/eval-execution", { timeout: 240000 }, async () => {
	await temporary((root) =>
		withApps(root, ({ bug }) =>
			// An invalid steps reply gets one re-ask with its validation error.
			withEmber(
				root,
				[modelReply({}), modelReply({})],
				async ({ env, server }) => {
					const options = cachedCorpus(root, bug.origin);
					const result = await cliRun(
						root,
						["eval", "--max-issues", "1", ...options],
						env,
					);
					assert.equal(result.code, 0, result.stderr);
					assert.equal(
						server.requests.length,
						2,
						"Evaluation must attempt a held-out issue",
					);
					const report = readJson(join(root, "out/eval-report.json"));
					assert.deepEqual(
						report.results.map((r) => r.issue),
						ids,
					);
					assert.equal(
						report.results.filter((r) => r.status === "attempted_miss").length,
						1,
					);
					assert.equal(
						report.results.filter((r) => r.status === "eligible_not_attempted")
							.length,
						7,
					);
				},
			),
		),
	);
});

test("TC-R10-3/envelope-ledger", { timeout: 240000 }, async () => {
	await temporary((root) =>
		withApps(root, ({ bug }) =>
			withEmber(
				root,
				[modelReply({}), modelReply({}, { mode: "missing_usage" })],
				async ({ env, server, callEmber, ledger }) => {
					const options = cachedCorpus(root, bug.origin);
					for (const issue of ids.slice(0, 2)) {
						await callEmber({
							messages: [
								{ role: "user", content: "Record a mock observation." },
							],
							max_output_tokens: 100,
							caseId: `issue-${issue}`,
							caseBudget: 100000,
						});
					}
					const before = ledger();
					const booked = before.open.reduce(
						(sum, item) => sum + item.upperBound,
						0,
					);
					assert.ok(
						before.settled > 0 && booked > 0,
						"Need settled and booked real offline calls",
					);
					const budget = ((before.settled + booked) / 1000000).toFixed(6);
					for (const command of [
						["eval"],
						["backlog", "fixtures/census/census.json"],
					]) {
						const result = await cliRun(
							root,
							[
								...command,
								...options,
								"--budget-usd",
								budget,
								"--max-issues",
								"1",
							],
							env,
						);
						// An exhausted envelope may stop the command or finish with a typed miss.
						assert.ok(
							result.code === 0 ||
								(result.code === 2 && /budget_refused/.test(result.stderr)),
							"An exhausted envelope needs a budget outcome, not an unknown option",
						);
						assert.equal(
							server.requests.length,
							2,
							"Settled and booked liabilities exhaust the envelope",
						);
						assert.equal(ledger().settled, before.settled);
						assert.deepEqual(ledger().open, before.open);
					}
				},
			),
		),
	);
});

test("TC-R10-3/envelope-ceilings", async () => {
	await temporary(async (root) => {
		evalCorpus(root);
		writeJson(join(root, "out/backlog-report.json"), []);
		await withEmber(root, [], async ({ env, server, ledger }) => {
			const before = ledger();
			const results = [];
			for (const args of [
				["eval", "--budget-usd", "1.500001"],
				["backlog", "fixtures/census/census.json", "--budget-usd", "3.800001"],
				[
					"backlog",
					"fixtures/census/census.json",
					"--per-issue-usd",
					"0.400001",
				],
			]) {
				const result = await cliRun(root, [...args, "--dry-run"], env);
				results.push([result.code, /budget_refused/.test(result.stderr)]);
			}
			assert.equal(server.requests.length, 0);
			assert.deepEqual(ledger(), before);
			assert.deepEqual(results, [
				[2, true],
				[2, true],
				[2, true],
			]);
		});
	});
});

test("TC-R11-1/return-metadata", async () => {
	await temporary(async (root) => {
		mkdirSync(join(root, "logs"));
		// Inert values in the same assignment-field format as historical returns.
		const fields = readFileSync(
			fixture(
				"public-negative",
				"assignment-metadata",
				"logs",
				"seed-RETURN.md",
			),
			"utf8",
		)
			.split("\n")
			.filter((line) => line.includes(":"));
		for (const [i, line] of fields.entries())
			writeFileSync(
				join(root, "logs", `case-${i}-RETURN.md`),
				`# Return\n\n${line}\n`,
			);
		const result = await startChild(
			[entry("tools/check-public.mjs"), "--tree", root],
			{
				cwd: root,
				env: localEnv(),
			},
		).done;
		assert.equal(
			result.code,
			1,
			"Publication check must refuse private assignment metadata",
		);
		for (const [i] of fields.entries())
			assert.match(
				result.stdout,
				new RegExp(`FAIL assignment-metadata logs/case-${i}-RETURN.md`),
			);
	});
});

test("TC-R13-1/node-minimum", () => {
	const pkg = readJson(entry("package.json"));
	const lock = readJson(entry("package-lock.json"));
	assert.equal(pkg.engines.node, ">=22.13.0");
	assert.equal(lock.packages[""].engines.node, pkg.engines.node);
});

test("TC-R13-1/node-preflight", async () => {
	await temporary((root) => {
		// External version-command boundary: model an installed older Node while
		// forwarding every other invocation to the real runtime.
		const tools = join(root, "tools");
		const bin = join(root, "bin");
		mkdirSync(tools);
		mkdirSync(bin);
		cpSync(
			entry("tools/preflight-tools.sh"),
			join(tools, "preflight-tools.sh"),
		);
		writeFileSync(
			join(bin, "node"),
			`#!/bin/sh
case "$*" in
  --version|-v) printf 'v22.12.0\\n';;
  *process.versions.node*) printf '22.12.0\\n';;
  *) exec "${process.execPath}" "$@";;
esac
`,
			{ mode: 0o755 },
		);
		const result = spawnSync("bash", [join(tools, "preflight-tools.sh")], {
			cwd: root,
			env: localEnv({ PATH: `${bin}:${process.env.PATH}` }),
			encoding: "utf8",
			timeout: 60000,
		});
		assert.equal(result.status, 1);
		assert.match(
			result.stderr,
			/node[^\n]*22\.13\.0/i,
			"Preflight must diagnose old Node even when other tools are absent",
		);
	});
});

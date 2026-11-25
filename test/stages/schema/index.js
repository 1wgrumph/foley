import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fixtureRun } from "../../ui/support.mjs";
import {
	anchor,
	archive,
	product,
	readJson,
	sha256,
	temporary,
	writeJson,
} from "../support.mjs";

const lines = (events) =>
	`${events.map((event) => JSON.stringify(event)).join("\n")}\n`;

test("TC-R13-3", async () => {
	const writeSpendSummary = await product(
		"src/run-schema.mjs",
		"writeSpendSummary",
	);
	await temporary(async (outDir) => {
		const ledger = {
			cap: 9000000,
			baseline: 1230000,
			settled: 152,
			open: [{ callId: "booked", upperBound: 400, caseId: "case" }],
		};
		const trace = [
			{
				type: "baseline",
				baseline_micro_usd: 1230000,
				cap_ledger_micro_usd: 1230000,
			},
			{
				type: "request",
				callId: "watch-1",
				stage: "watch",
				cost_micro_usd: 100,
				cap_ledger_micro_usd: 1230100,
			},
			{
				type: "request",
				callId: "repro-1",
				stage: "repro",
				cost_micro_usd: 52,
				cap_ledger_micro_usd: 1230152,
			},
			{
				type: "recovery",
				stage: "prove",
				callId: "booked",
				booked_micro_usd: 400,
				cap_ledger_micro_usd: 1230552,
			},
		];
		writeJson(join(outDir, "ledger.json"), ledger);
		writeFileSync(join(outDir, "trace.jsonl"), lines(trace));
		const result = await writeSpendSummary(outDir);
		assert.deepEqual(result, readJson(join(outDir, "spend-summary.json")));
		assert.equal(result.baseline, 1230000);
		assert.equal(result.settled, 152);
		assert.equal(result.booked, 400);
		assert.equal(result.total, 1230552);
		assert.deepEqual(result.per_stage, { watch: 100, repro: 52, prove: 400 });
		// S2's immutable model trace has call IDs, but no stage names.
		const attribution = trace
			.filter((event) => event.stage)
			.map(({ callId, stage }) => ({ callId, stage }));
		writeFileSync(join(outDir, "stage-spend.jsonl"), lines(attribution));
		writeFileSync(
			join(outDir, "trace.jsonl"),
			lines(trace.map(({ stage, ...event }) => event)),
		);
		assert.deepEqual(await writeSpendSummary(outDir), result);
		writeJson(join(outDir, "ledger.json"), { ...ledger, settled: 153 });
		await assert.rejects(() => writeSpendSummary(outDir), /reconcil|mismatch/i);
	});
});

test("TC-R15-4", async () => {
	const checkCoreProof = await product("src/run-schema.mjs", "checkCoreProof");
	const validateRun = await product("src/run-schema.mjs", "validateRun");
	await temporary(async (runDir) => {
		const run = fixtureRun(runDir);
		assert.equal(validateRun(run), true);
		assert.equal(validateRun({ ...run, state: "unknown" }), false);
		writeJson(join(runDir, "steps.json"), archive);
		writeJson(join(runDir, "anchors.json"), {
			schema: "foley.anchors/1",
			status: "ok",
			anchors: [anchor],
		});
		writeJson(join(runDir, "replay.json"), {
			...run.replay,
			status: "reproduced",
			observed: true,
		});
		writeJson(join(runDir, "proof.json"), {
			status: "verified",
			path: run.test.path,
			attempts: [],
			rerun_without_ember: { bug: { exitCode: 1 }, fixed: { exitCode: 0 } },
		});
		writeFileSync(join(runDir, "comment.md"), "# Synthetic fixture proof\n");
		writeFileSync(
			join(runDir, "replay.html"),
			"<!doctype html><title>Synthetic fixture proof</title>",
		);
		const names = [
			"recording.mp4",
			"run.json",
			"steps.json",
			"anchors.json",
			"replay.json",
			"proof.json",
			"regression.test.mjs",
			"screenshots/step-1.png",
			"comment.md",
			"replay.html",
		];
		const artifacts = Object.fromEntries(
			names.map((path) => [path, sha256(readFileSync(join(runDir, path)))]),
		);
		writeFileSync(
			join(runDir, "artifact-trace.jsonl"),
			lines(
				Object.entries(artifacts).map(([path, sha256]) => ({
					type: "artifact",
					path,
					sha256,
				})),
			),
		);
		writeJson(join(runDir, "core-proof.json"), {
			schema: "foley.core-proof/1",
			issue_url: run.issue_url,
			target_revision: run.target_revision,
			fixture: true,
			stages: {
				watch: "ok",
				locate: "ok",
				repro: "reproduced",
				prove: "verified",
				report: "ok",
			},
			rerun_without_ember: "verified",
			unedited: true,
			artifacts,
		});
		assert.equal((await checkCoreProof(runDir)).status, "ok");
		writeJson(join(runDir, "steps.json"), { ...archive, steps: [] });
		assert.equal((await checkCoreProof(runDir)).status, "digest_mismatch");
	});
});

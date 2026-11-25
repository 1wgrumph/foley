import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture, product, readJson } from "../support.mjs";

// Synthetic hand-labelled results, separate from the frozen real held-out set.
const results = [
	{
		issue: 1,
		status: "proof_verified",
		anchors: [{ file: "a.mjs" }],
		cost_micro_usd: 100,
		elapsed_ms: 1000,
	},
	{
		issue: 2,
		status: "failure_observed",
		anchors: [{ file: "x.mjs" }, { file: "b.mjs" }],
		cost_micro_usd: 300,
		elapsed_ms: 2000,
	},
	{
		issue: 3,
		status: "attempted_miss",
		anchors: [],
		cost_micro_usd: 500,
		elapsed_ms: 3000,
	},
	{
		issue: 4,
		status: "eligible_not_attempted",
		anchors: [],
		cost_micro_usd: 0,
		elapsed_ms: 0,
	},
	{
		issue: 5,
		status: "unsupported_device",
		anchors: [],
		cost_micro_usd: 0,
		elapsed_ms: 0,
	},
];
const labels = {
	schema: "foley.labels/1",
	entries: [
		{ issue: 1, expected_file: "a.mjs" },
		{ issue: 2, expected_file: "b.mjs" },
		{ issue: 3, expected_file: "c.mjs" },
	],
};

test("TC-R10-1", async () => {
	const score = await product("src/score.mjs", "score");
	// Inspect split membership only; the arithmetic oracle uses synthetic labels.
	const heldOut = readJson(fixture("eval", "held-out.json"));
	const tuning = readJson(fixture("eval", "tuning.json"));
	assert.equal(heldOut.schema, labels.schema);
	assert.equal(heldOut.fixed, true);
	assert.equal(heldOut.split, "held-out");
	const tuningIds = new Set(tuning.entries.map((entry) => entry.issue));
	assert.ok(heldOut.entries.every((entry) => !tuningIds.has(entry.issue)));
	const result = score(results, labels);
	assert.equal(result.success_per_attempt, 2 / 3);
	assert.equal(result.success_per_eligible, 2 / 4);
	assert.equal(result.top1, 1 / 3);
	assert.equal(result.top5, 2 / 3);
	assert.equal(result.cost_per_attempt_micro_usd, 300);
	assert.equal(result.cost_per_verified_proof_micro_usd, 900);
	assert.equal(result.elapsed_ms, 6000);
	assert.deepEqual(result.misses, [3, 4]);
	const allMiss = score([results[2]], {
		...labels,
		entries: [labels.entries[2]],
	});
	assert.equal(allMiss.success_per_attempt, 0);
	assert.equal(allMiss.success_per_eligible, 0);
	assert.equal(allMiss.top1, 0);
	assert.equal(allMiss.top5, 0);
	assert.equal(allMiss.cost_per_attempt_micro_usd, 500);
	assert.equal(allMiss.cost_per_verified_proof_micro_usd, null);
	assert.deepEqual(allMiss.misses, [3]);
});

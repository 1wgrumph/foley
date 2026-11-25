import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { anchor, archive, product, temporary } from "../support.mjs";

test("TC-R08-1", async () => {
	const report = await product("src/report.mjs", "report");
	await temporary(async (runDir) => {
		const run = {
			schema: "foley.run/1",
			issue: 1,
			steps: archive.steps,
			predicate: archive.predicate,
			anchors: [anchor],
			test: { path: "regression.test.mjs", verdict: "verified" },
			verdict: "proof_verified",
			cost_micro_usd: 152,
		};
		assert.equal((await report(run, { runDir })).status, "ok");
		const draft = readFileSync(join(runDir, "comment.md"), "utf8");
		for (const [heading, value] of [
			["Steps", "Archive"],
			["Code anchors", "logic.mjs:2"],
			["Test", "regression.test.mjs"],
			["Verdict", "proof_verified"],
			["Cost", "0.000152"],
		]) {
			const section = draft.split(`## ${heading}`)[1]?.split("\n## ")[0];
			assert.ok(section?.includes(value), `Missing ${heading} value`);
		}
		await report({ ...run, test: null }, { runDir });
		assert.match(
			readFileSync(join(runDir, "comment.md"), "utf8"),
			/## Test\s+[^#]*\bnone\b/i,
		);
	});
});

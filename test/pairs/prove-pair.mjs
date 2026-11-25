// Offline proof contract for one real bug pair (FOL-R07, R15): the pair's
// hand-written regression test is the scripted model reply, and prove runs it
// on the real bug and fixed checkouts with their built pages as the control.
// Exits 0 only when the result is "verified".
// Usage: node test/pairs/prove-pair.mjs <issue>
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { modelReply, temporary, withEmber } from "../stages/support.mjs";

const issue = Number(process.argv[2]);
const { pairs } = JSON.parse(readFileSync("fixtures/pairs/pairs.json", "utf8"));
const pair = pairs.find((p) => p.issue === issue);
if (!pair) {
	console.error(
		`prove-pair: issue ${process.argv[2]} is not in fixtures/pairs/pairs.json`,
	);
	process.exit(2);
}
// Resolved now: withEmber changes the working directory.
const bug = resolve("out/pairs", String(issue), "bug");
const fixed = resolve("out/pairs", String(issue), "fixed");
const page = (dir) => resolve(dir, "excalidraw-app/build");
const code = readFileSync(pair.regression_test, "utf8");
const { prove } = await import("../../src/prove.mjs");

let result;
await temporary((root) =>
	withEmber(
		root,
		[
			modelReply({
				code,
				filename: "regression.test.mjs",
				assertion: "regression",
			}),
		],
		async ({ callEmber }) => {
			result = await prove(pair.steps, [], pair.predicate, {
				runDir: root,
				targetDir: bug,
				fixedTargetDir: fixed,
				pageDirs: [page(bug), page(fixed)],
				runner: "vitest",
				callEmber,
				caseId: `pair-${issue}`,
				caseBudget: 100_000,
				timeoutMs: 180_000,
				memoryMiB: pair.memory_mib ?? 1024,
			});
		},
	),
);
const reasons = result.attempts.map((a) => a.reason).join(",");
console.log(
	`issue ${issue}: ${result.status} (${result.reason ?? "verified"}; attempts: ${reasons})`,
);
process.exit(result.status === "verified" ? 0 : 1);

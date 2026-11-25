import assert from "node:assert/strict";
import { closeSync, existsSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { censusOf, makeStages } from "../../fixtures/stages/backlog-driver.mjs";
import {
	modelReply,
	product,
	readJson,
	temporary,
	withEmber,
} from "../stages/support.mjs";

const eligible = "eligible_not_attempted";
const census = censusOf([
	eligible,
	eligible,
	eligible,
	eligible,
	"no_usable_media",
	"unsupported_device",
	"excluded_sensitive_or_security",
	"attempted_miss",
	"failure_observed",
	"proof_verified",
]);
const rows = (...statuses) =>
	census.candidates.map(({ issue, status }, i) => ({
		issue,
		status: statuses[i] ?? status,
	}));
const firstRows = rows("proof_verified");
const secondRows = rows("proof_verified", "failure_observed");
const finalRows = rows("proof_verified", "failure_observed", "attempted_miss");
const readIfPresent = (path) => (existsSync(path) ? readJson(path) : null);

test("TC-R09-1/census-record", { timeout: 120000 }, async () => {
	const backlog = await product("src/backlog.mjs", "backlog");
	const reply = modelReply({ answer: "ok" });
	await temporary((root) =>
		withEmber(
			root,
			[reply, reply, { mode: "invalid_output" }],
			async ({ callEmber, server }) => {
				const runRoot = join(root, "out", "runs");
				const recordPath = (issue) =>
					join(runRoot, String(issue), "census.json");
				const stages = makeStages(callEmber);
				const atReport = {};
				let beforeThird;
				const opts = {
					runRoot,
					stages: {
						...stages,
						async watch(candidate) {
							if (candidate.issue === 3)
								beforeThird = readIfPresent(recordPath(1));
							return stages.watch(candidate);
						},
						async prove(candidate) {
							return {
								status: candidate.issue === 2 ? "not_verified" : "verified",
							};
						},
						async report(candidate, { runDir }) {
							atReport[candidate.issue] = readIfPresent(
								join(runDir, "census.json"),
							);
							return stages.report();
						},
					},
				};
				const first = await backlog(structuredClone(census), {
					...opts,
					stopAfter: { issue: 1, stage: "report" },
				});
				assert.equal(first.status, "interrupted");
				const path = recordPath(1);
				const before = readIfPresent(path);
				// Keep the original file open across resume. An atomic replacement leaves
				// the old file descriptor's bytes intact while new readers see new rows.
				const fd = existsSync(path) ? openSync(path, "r") : null;
				try {
					const resumed = await backlog(structuredClone(census), {
						...opts,
						maxIssues: 2,
					});
					assert.equal(resumed.status, "ok");
					assert.equal(
						server.requests.length,
						3,
						"Resume must not repeat a completed issue",
					);
					assert.deepEqual(
						resumed.report.map(({ issue, status }) => ({ issue, status })),
						finalRows,
					);
					assert.deepEqual(
						before,
						firstRows,
						"First completed issue must publish its in-folder census before interruption",
					);
					assert.deepEqual(
						atReport,
						{ 1: firstRows, 2: secondRows },
						"Report must see complete census rows, including the current outcome",
					);
					assert.deepEqual(
						beforeThird,
						secondRows,
						"Earlier record must update before the next issue starts",
					);
					for (const issue of [1, 2, 3])
						assert.deepEqual(
							readIfPresent(recordPath(issue)),
							finalRows,
							`Missing or stale census for issue ${issue}`,
						);
					assert.notEqual(fd, null);
					assert.deepEqual(
						JSON.parse(readFileSync(fd, "utf8")),
						firstRows,
						"Resume rewrote the existing inode rather than replacing it atomically",
					);
				} finally {
					if (fd !== null) closeSync(fd);
				}
			},
		),
	);
});

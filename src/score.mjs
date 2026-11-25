// Evaluation quantities over backlog or held-out results (DES-FOL-R10). Pure.
const ATTEMPTED = new Set([
	"attempted_miss",
	"failure_observed",
	"proof_verified",
]);
const ELIGIBLE = new Set([...ATTEMPTED, "eligible_not_attempted"]);
const SUCCESS = new Set(["failure_observed", "proof_verified"]);

const ratio = (part, whole) => (whole === 0 ? 0 : part / whole);

export function score(results, labels) {
	const attempted = results.filter((r) => ATTEMPTED.has(r.status));
	const eligible = results.filter((r) => ELIGIBLE.has(r.status));
	const successes = results.filter((r) => SUCCESS.has(r.status)).length;
	const proofs = results.filter((r) => r.status === "proof_verified").length;
	const cost = attempted.reduce((sum, r) => sum + r.cost_micro_usd, 0);
	const byIssue = new Map(results.map((r) => [r.issue, r]));
	const rank = (entry) =>
		(byIssue.get(entry.issue)?.anchors ?? []).findIndex(
			(a) => a.file === entry.expected_file,
		);
	const ranks = labels.entries.map(rank);
	return {
		success_per_attempt: ratio(successes, attempted.length),
		success_per_eligible: ratio(successes, eligible.length),
		top1: ratio(ranks.filter((r) => r === 0).length, ranks.length),
		top5: ratio(ranks.filter((r) => r >= 0 && r < 5).length, ranks.length),
		cost_per_attempt_micro_usd: ratio(cost, attempted.length),
		cost_per_verified_proof_micro_usd: proofs === 0 ? null : cost / proofs,
		elapsed_ms: results.reduce((sum, r) => sum + r.elapsed_ms, 0),
		misses: eligible.filter((r) => !SUCCESS.has(r.status)).map((r) => r.issue),
	};
}

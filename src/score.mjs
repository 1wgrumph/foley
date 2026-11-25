// Evaluation quantities over backlog or held-out results (DES-FOL-R10). Pure.
const ATTEMPTED = new Set([
	"attempted_miss",
	"failure_observed",
	"failing_test_no_control",
	"proof_verified",
]);
const ELIGIBLE = new Set([...ATTEMPTED, "eligible_not_attempted"]);
const SUCCESS = new Set([
	"failure_observed",
	"failing_test_no_control",
	"proof_verified",
]);

const ratio = (part, whole) => (whole === 0 ? 0 : part / whole);

export function score(results, labels) {
	const attempted = results.filter((r) => ATTEMPTED.has(r.status));
	const eligible = results.filter((r) => ELIGIBLE.has(r.status));
	const successes = results.filter((r) => SUCCESS.has(r.status)).length;
	const proofs = results.filter((r) => r.status === "proof_verified").length;
	const cost = attempted.reduce((sum, r) => sum + r.cost_micro_usd, 0);
	const byIssue = new Map(results.map((r) => [r.issue, r]));
	// Location accuracy is measured only over entries that carry a file label;
	// with none it is unavailable (null), never zero.
	const labelled = labels.entries.filter(
		(entry) => typeof entry.expected_file === "string",
	);
	const ranks = labelled.map((entry) =>
		(byIssue.get(entry.issue)?.anchors ?? []).findIndex(
			(a) => a.file === entry.expected_file,
		),
	);
	const within = (n) =>
		ranks.length === 0
			? null
			: ranks.filter((r) => r >= 0 && r < n).length / ranks.length;
	return {
		success_per_attempt: ratio(successes, attempted.length),
		success_per_eligible: ratio(successes, eligible.length),
		top1: within(1),
		top5: within(5),
		anchor_labels: { labelled: labelled.length, total: labels.entries.length },
		cost_per_attempt_micro_usd: ratio(cost, attempted.length),
		cost_per_verified_proof_micro_usd: proofs === 0 ? null : cost / proofs,
		elapsed_ms: results.reduce((sum, r) => sum + r.elapsed_ms, 0),
		misses: eligible.filter((r) => !SUCCESS.has(r.status)).map((r) => r.issue),
	};
}

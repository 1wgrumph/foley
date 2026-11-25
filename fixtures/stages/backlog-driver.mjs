export function censusOf(statuses) {
	return {
		schema: "foley.census/1",
		generated_on: "2026-11-24",
		repository: "synthetic/archive-demo",
		target_revision: "synthetic-fixture-revision",
		candidates: statuses.map((status, index) => ({
			issue: index + 1,
			url: `https://example.invalid/issues/${index + 1}`,
			media: [],
			status,
		})),
	};
}

export function makeStages(callEmber) {
	return {
		async watch(candidate) {
			const result = await callEmber({
				messages: [
					{ role: "user", content: `Synthetic issue ${candidate.issue}` },
				],
				max_output_tokens: 64,
				caseId: String(candidate.issue),
			});
			return {
				status: result.status,
				cost_micro_usd: result.status === "ok" ? 11 : 0,
			};
		},
		async locate() {
			return { status: "ok" };
		},
		async repro() {
			return { status: "reproduced" };
		},
		async prove() {
			return { status: "verified" };
		},
		async report() {
			return { status: "ok" };
		},
	};
}

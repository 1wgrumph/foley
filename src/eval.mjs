// Held-out evaluation and spending envelopes (DES-FOL-R09, R10).
// The evaluation population is exactly the frozen held-out corpus; tuning rows
// never count. Envelopes cap what eval and backlog may spend in total and per issue.
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Refusal } from "./run.mjs";
import { score } from "./score.mjs";

export const HELD_OUT = "fixtures/eval/held-out.json";
const TUNING = "fixtures/eval/tuning.json";
// Planned ceilings in micro-dollars (plan budget table).
export const CEILING = {
	eval: 1_500_000,
	backlog: 3_800_000,
	perIssue: 400_000,
};

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const readOptional = async (path, fallback) => {
	try {
		return await readJson(path);
	} catch (error) {
		if (error.code === "ENOENT") return fallback;
		throw error;
	}
};

// USD with at most six decimals, positive and within the ceiling; absent means the
// ceiling itself. Returns integer micro-dollars.
export function budget(text, ceiling, flag) {
	if (text === undefined) return ceiling;
	const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(text);
	const micro = match
		? Number(match[1]) * 1_000_000 + Number((match[2] ?? "").padEnd(6, "0"))
		: Number.NaN;
	if (!Number.isSafeInteger(micro) || micro <= 0 || micro > ceiling)
		throw new Refusal(
			"budget_refused",
			`${flag} must be positive and at most $${(ceiling / 1_000_000).toFixed(2)}`,
		);
	return micro;
}

// --case-budget (integer micro-dollars) and --per-issue-usd name the same limit.
export function perIssueBudget(values) {
	if (values["case-budget"] === undefined)
		return budget(values["per-issue-usd"], CEILING.perIssue, "--per-issue-usd");
	const micro = /^\d+$/.test(values["case-budget"])
		? Number(values["case-budget"])
		: Number.NaN;
	if (!Number.isSafeInteger(micro) || micro <= 0 || micro > CEILING.perIssue)
		throw new Refusal(
			"budget_refused",
			"--case-budget must be positive and at most 400000 micro-dollars",
		);
	return micro;
}

// Spend per issue from the authoritative ledger: settled case spend plus open
// reservations for the issue's Ember case.
function issueSpend(ledger, issue) {
	const caseId = `issue-${issue}`;
	const settled = ledger?.cases?.[caseId] ?? 0;
	const open = (ledger?.open ?? [])
		.filter((o) => o.caseId === caseId)
		.reduce((s, o) => s + o.upperBound, 0);
	return settled + open;
}

// Case budget for the next issue: never more than its per-issue limit, and never
// more than the envelope has left across the whole population. Read just before
// the issue starts; issues run one at a time, so no other issue spends meanwhile.
export function envelope({ outDir, population, total, perIssue }) {
	return async (issue) => {
		const ledger = await readOptional(join(outDir, "ledger.json"), null);
		const used = population.reduce((s, id) => s + issueSpend(ledger, id), 0);
		const own = issueSpend(ledger, issue);
		return Math.max(0, Math.min(perIssue, own + total - used));
	};
}

// The labels must be the committed held-out corpus itself, disjoint from tuning.
export async function heldOutIds(labelsPath, root) {
	const [labels, held, tuning] = await Promise.all([
		readJson(labelsPath),
		readJson(join(root, HELD_OUT)),
		readJson(join(root, TUNING)),
	]).catch(() => {
		throw new Refusal(
			"bad_labels",
			"labels, held-out or tuning file unreadable",
		);
	});
	const ids = (labels?.entries ?? []).map((e) => e?.issue);
	const frozen = (held?.entries ?? []).map((e) => e.issue);
	const tuned = new Set((tuning?.entries ?? []).map((e) => e.issue));
	const valid =
		labels?.schema === "foley.labels/1" &&
		held?.fixed === true &&
		ids.length === frozen.length &&
		ids.every((id, i) => id === frozen[i]) &&
		!ids.some((id) => tuned.has(id));
	if (!valid)
		throw new Refusal(
			"bad_labels",
			"labels must be exactly the frozen held-out set, disjoint from tuning",
		);
	return { ids, labels };
}

// Scores the held-out population from the backlog report: absent issues are explicit
// eligible_not_attempted rows; rows for any other issue are ignored.
export async function evaluate({ outDir, ids, labels, write }) {
	const rows = new Map(
		(await readOptional(join(outDir, "backlog-report.json"), [])).map((r) => [
			r.issue,
			r,
		]),
	);
	const results = [];
	for (const issue of ids) {
		const row = rows.get(issue);
		if (!row) {
			results.push({
				issue,
				status: "eligible_not_attempted",
				cost_micro_usd: 0,
				case_cost_micro_usd: 0,
				anchors: [],
				elapsed_ms: 0,
			});
			continue;
		}
		const saved = await readOptional(
			join(outDir, "runs", String(issue), "run.json"),
			{},
		);
		// The report row holds what the issue's case spent over every run. A run
		// document that separates the two gives the latest run's own cost, which
		// is the cost of one attempt; elapsed time is the latest run's as well.
		const caseCost = row.cost_micro_usd ?? 0;
		const separated = Number.isSafeInteger(saved.case_cost_micro_usd);
		results.push({
			issue,
			status: row.status,
			cost_micro_usd: separated ? saved.cost_micro_usd : caseCost,
			case_cost_micro_usd: caseCost,
			anchors: saved.anchors ?? [],
			elapsed_ms: saved.elapsed_ms ?? 0,
		});
	}
	const report = { ...score(results, labels), results };
	if (write) {
		const path = join(outDir, "eval-report.json");
		await writeFile(`${path}.tmp`, `${JSON.stringify(report, null, 2)}\n`);
		await rename(`${path}.tmp`, path);
	}
	return report;
}

// Folds a held-out backlog pass into the main backlog report instead of replacing it.
export async function mergeReport(outDir, before, after) {
	const updated = new Map(after.map((r) => [r.issue, r]));
	const merged = [...before.filter((r) => !updated.has(r.issue)), ...after];
	const path = join(outDir, "backlog-report.json");
	await writeFile(`${path}.tmp`, `${JSON.stringify(merged, null, 2)}\n`);
	await rename(`${path}.tmp`, path);
}

export { readOptional };

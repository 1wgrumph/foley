// Backlog runner (DES-FOL-R09): one dated census, one issue at a time, every issue
// with exactly one status, resumable. runRoot/<issue>/state.json is written by this
// module only. A stage is marked started before it runs and completed after, so a
// finished stage never runs again and an interrupted stage runs at most once more.
// Spend safety stays with the Ember ledger: a crashed call's reservation stays booked.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { STATUSES } from "./run-schema.mjs";

const STAGES = ["watch", "locate", "repro", "prove", "report"];
const MAX_RUNS_PER_STAGE = 2; // the first run plus one rerun after an interruption
const INVALID = Symbol("invalid state");

const isCount = (n) => Number.isSafeInteger(n) && n >= 0;
const isText = (v) => typeof v === "string" && v !== "";

function validCensus(census) {
	const candidates = census?.candidates;
	if (census?.schema !== "foley.census/1" || !Array.isArray(candidates))
		return false;
	if (
		![census.generated_on, census.repository, census.target_revision].every(
			isText,
		)
	)
		return false;
	const issues = new Set(candidates.map((c) => c?.issue));
	return (
		issues.size === candidates.length &&
		candidates.every(
			(c) =>
				Number.isSafeInteger(c.issue) &&
				c.issue > 0 &&
				isText(c.url) &&
				Array.isArray(c.media) &&
				STATUSES.has(c.status),
		)
	);
}

function validState(s, issue) {
	const prefix =
		Array.isArray(s?.completed) &&
		s.completed.every((name, i) => name === STAGES[i]);
	return (
		s?.schema === "foley.backlog-state/1" &&
		s.issue === issue &&
		prefix &&
		s.attempts !== null &&
		typeof s.attempts === "object" &&
		Object.entries(s.attempts).every(
			([k, v]) => STAGES.includes(k) && isCount(v),
		) &&
		s.results !== null &&
		typeof s.results === "object" &&
		!Array.isArray(s.results) &&
		isCount(s.cost_micro_usd) &&
		(s.status === null || STATUSES.has(s.status))
	);
}

const statePath = (runRoot, issue) =>
	join(runRoot, String(issue), "state.json");

async function readState(runRoot, issue) {
	try {
		const state = JSON.parse(await readFile(statePath(runRoot, issue), "utf8"));
		return validState(state, issue) ? state : INVALID;
	} catch (error) {
		return error.code === "ENOENT" ? null : INVALID;
	}
}

async function writeJson(path, value) {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(`${path}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
	await rename(`${path}.tmp`, path);
}

// Final status after a stage, or null to continue. Watch and repro gate the rest.
function decide(name, status) {
	if (name === "watch" && status !== "ok") return "attempted_miss";
	if (name === "repro" && status !== "reproduced") return "attempted_miss";
	return null;
}

async function runIssue(
	candidate,
	state,
	{ runRoot, stages, stopAfter, targetRevision },
) {
	const runDir = join(runRoot, String(candidate.issue));
	const save = () => writeJson(statePath(runRoot, candidate.issue), state);
	for (const name of STAGES.slice(state.completed.length)) {
		if ((state.attempts[name] ?? 0) >= MAX_RUNS_PER_STAGE) {
			state.status = "attempted_miss"; // interrupted twice: no third run
			await save();
			return false;
		}
		state.attempts[name] = (state.attempts[name] ?? 0) + 1;
		await save();
		let result;
		try {
			result = await stages[name](candidate, { runDir, targetRevision });
		} catch {
			result = { status: "error" };
		}
		const cost = isCount(result?.cost_micro_usd) ? result.cost_micro_usd : 0;
		state.cost_micro_usd += cost;
		state.results[name] = {
			status: String(result?.status),
			cost_micro_usd: cost,
		};
		state.completed.push(name);
		state.status = decide(name, result?.status);
		if (name === "report" && !state.status)
			state.status =
				state.results.prove?.status === "verified"
					? "proof_verified"
					: "failure_observed";
		await save();
		if (stopAfter?.issue === candidate.issue && stopAfter?.stage === name)
			return true;
		if (state.status) return false;
	}
	return false;
}

// An issue runs when it is eligible, not finished, and either resumes or fits
// under the new-issue limit. Otherwise its row reports what is already known.
const runnable = (c, state, full) =>
	c.status === "eligible_not_attempted" && !state?.status && (state || !full);
const settled = (c, state) =>
	c.status === "eligible_not_attempted"
		? [state?.status ?? "eligible_not_attempted", state?.cost_micro_usd ?? 0]
		: [c.status, 0];

export async function backlog(
	census,
	{ runRoot, stages, stopAfter, maxIssues = Number.POSITIVE_INFINITY },
) {
	const refused = { status: "refused_input", report: [] };
	if (
		!validCensus(census) ||
		!(maxIssues === Number.POSITIVE_INFINITY || isCount(maxIssues))
	)
		return refused;
	// Every existing state is read and checked before any stage runs.
	const states = new Map();
	for (const c of census.candidates) {
		const state = await readState(runRoot, c.issue);
		if (state === INVALID) return refused;
		states.set(c.issue, state);
	}
	const report = [];
	const row = (c, status, cost = 0) =>
		report.push({ issue: c.issue, status, cost_micro_usd: cost });
	let started = 0;
	let interrupted = false;
	for (const c of census.candidates) {
		let state = states.get(c.issue);
		if (interrupted || !runnable(c, state, started >= maxIssues)) {
			row(c, ...settled(c, state));
			continue;
		}
		if (!state) {
			started++;
			state = {
				schema: "foley.backlog-state/1",
				issue: c.issue,
				completed: [],
				attempts: {},
				results: {},
				cost_micro_usd: 0,
				status: null,
			};
		}
		interrupted = await runIssue(c, state, {
			runRoot,
			stages,
			stopAfter,
			targetRevision: census.target_revision,
		});
		row(c, state.status ?? "eligible_not_attempted", state.cost_micro_usd);
	}
	await writeJson(join(dirname(runRoot), "backlog-report.json"), report);
	return { status: interrupted ? "interrupted" : "ok", report };
}

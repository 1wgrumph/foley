// Backlog runner (DES-FOL-R09): one dated census, one issue at a time, every issue
// with exactly one status, resumable. runRoot/<issue>/state.json is the one stage
// journal for both `foley run` and `foley backlog`, written by this module only. A
// stage is recorded as started (attempt count) before it runs and committed after,
// so a committed stage never runs again and an interrupted or failed stage runs at
// most once more. A stage that throws is not committed. The journal is bound to the
// run's input identity; a resume with different inputs is refused. Spend safety
// stays with the Ember ledger: a crashed call's reservation stays booked.
// runRoot/<issue>/census.json in every started folder lists {issue, status} for all
// candidates; it is replaced (never truncated) after each stage of the current issue.
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

// The issue's outcome once known: its final status, or after prove the status the
// report stage will record, so the report can show the current outcome.
function outcome(state) {
	if (state?.status) return state.status;
	if (!state?.results.prove) return null;
	return state.results.prove.status === "verified"
		? "proof_verified"
		: "failure_observed";
}

// Final status after a stage, or null to continue. Watch and repro gate the rest.
function decide(name, status) {
	if (name === "watch" && status !== "ok") return "attempted_miss";
	if (name === "repro" && status !== "reproduced") return "attempted_miss";
	return null;
}

const newState = (issue, identity) => ({
	schema: "foley.backlog-state/1",
	issue,
	...(identity && { identity }),
	completed: [],
	attempts: {},
	results: {},
	cost_micro_usd: 0,
	status: null,
});

const sameIdentity = (state, identity) =>
	!identity || JSON.stringify(state.identity) === JSON.stringify(identity);

// Runs the uncommitted stages of one issue through the journal. Returns true when
// stopped at the requested boundary. With `cost`, issue and stage spend are read
// from the authoritative call records, so a resume reconciles before continuing.
async function runIssue(
	candidate,
	state,
	{ runRoot, stages, stopAfter, targetRevision, publish, cost },
) {
	const runDir = join(runRoot, String(candidate.issue));
	const save = () => writeJson(statePath(runRoot, candidate.issue), state);
	const spent = async () =>
		cost ? await cost(candidate) : state.cost_micro_usd;
	state.cost_micro_usd = await spent();
	await save();
	for (const name of STAGES.slice(state.completed.length)) {
		if (state.status) break;
		if ((state.attempts[name] ?? 0) >= MAX_RUNS_PER_STAGE) {
			state.status = "attempted_miss"; // interrupted twice: no third run
			break;
		}
		state.attempts[name] = (state.attempts[name] ?? 0) + 1;
		await save();
		const before = state.cost_micro_usd;
		const result = await stages[name](candidate, { runDir, targetRevision });
		const delta = isCount(result?.cost_micro_usd) ? result.cost_micro_usd : 0;
		state.cost_micro_usd = cost ? await spent() : before + delta;
		state.results[name] = {
			status: String(result?.status),
			cost_micro_usd: state.cost_micro_usd - before,
		};
		state.completed.push(name);
		state.status = decide(name, result?.status);
		if (name === "report") state.status = outcome(state);
		await save();
		await publish();
		if (stopAfter?.issue === candidate.issue && stopAfter?.stage === name)
			return true;
	}
	await save();
	await publish();
	// Terminal outcome recorded and published first; then the final export, which
	// is idempotent and repairs an interrupted finalization without model calls.
	if (state.status) await stages.finalize?.(candidate, state.status);
	return false;
}

/**
 * One issue through the shared journal (used by `foley run`). Returns
 * {status: "ok", state}, or "refused_input" for a corrupt journal and
 * "resume_mismatch" when the saved journal belongs to different inputs; both
 * refusals happen before any stage runs.
 */
export async function runOne(candidate, { runRoot, stages, identity, cost }) {
	const saved = await readState(runRoot, candidate.issue);
	if (saved === INVALID) return { status: "refused_input" };
	if (saved && !sameIdentity(saved, identity))
		return { status: "resume_mismatch" };
	const state = saved ?? newState(candidate.issue, identity);
	await runIssue(candidate, state, {
		runRoot,
		stages,
		publish: async () => {},
		cost,
	});
	return { status: "ok", state };
}

// An issue runs when it is eligible, not finished, and either resumes or fits
// under the new-issue limit. Otherwise its row reports what is already known.
const runnable = (c, state, full) =>
	c.status === "eligible_not_attempted" && !state?.status && (state || !full);
const settled = (c, state) =>
	c.status === "eligible_not_attempted"
		? [state?.status ?? "eligible_not_attempted", state?.cost_micro_usd ?? 0]
		: [c.status, 0];

// Census rows in input order from the current states, written to every started folder.
async function publishCensus(runRoot, census, states) {
	const rows = census.candidates.map((c) => ({
		issue: c.issue,
		status:
			c.status === "eligible_not_attempted"
				? (outcome(states.get(c.issue)) ?? c.status)
				: c.status,
	}));
	for (const [issue, state] of states)
		if (state)
			await writeJson(join(runRoot, String(issue), "census.json"), rows);
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: one ordered scheduler: validate every journal, then run issues serially
export async function backlog(
	census,
	{
		runRoot,
		stages,
		stopAfter,
		maxIssues = Number.POSITIVE_INFINITY,
		identity,
		cost,
	},
) {
	const refused = { status: "refused_input", report: [] };
	if (
		!validCensus(census) ||
		!(maxIssues === Number.POSITIVE_INFINITY || isCount(maxIssues))
	)
		return refused;
	// Every existing journal is read and checked before any stage runs.
	const states = new Map();
	for (const c of census.candidates) {
		const state = await readState(runRoot, c.issue);
		if (state === INVALID) return refused;
		if (state && !sameIdentity(state, identity?.(c)))
			return { status: "resume_mismatch", report: [] };
		states.set(c.issue, state);
	}
	const publish = () => publishCensus(runRoot, census, states);
	const report = [];
	const row = (c, status, cost = 0) =>
		report.push({ issue: c.issue, status, cost_micro_usd: cost });
	let started = 0;
	let interrupted = false;
	for (const c of census.candidates) {
		let state = states.get(c.issue);
		if (interrupted || !runnable(c, state, started >= maxIssues)) {
			// A finished issue still gets its spend reconciled and any
			// interrupted final export repaired; neither makes a model call.
			if (state?.status && !interrupted)
				await runIssue(c, state, { runRoot, stages, publish, cost });
			row(c, ...settled(c, state));
			continue;
		}
		if (!state) {
			started++;
			state = newState(c.issue, identity?.(c));
			states.set(c.issue, state);
		}
		await publish(); // every census row exists before the issue's first request
		interrupted = await runIssue(c, state, {
			runRoot,
			stages,
			stopAfter,
			targetRevision: census.target_revision,
			publish,
			cost,
		});
		row(c, state.status ?? "eligible_not_attempted", state.cost_micro_usd);
	}
	await writeJson(join(dirname(runRoot), "backlog-report.json"), report);
	return { status: interrupted ? "interrupted" : "ok", report };
}

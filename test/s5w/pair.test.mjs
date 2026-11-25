// Resource group: unique scratch directory, isolated local runner, ephemeral web and model servers.
import assert from "node:assert/strict";
import { existsSync, readFileSync, renameSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import {
	modelReply,
	product,
	readJson,
	sha256,
	writeJson,
} from "../stages/support.mjs";
import {
	assertExit,
	issue,
	pairArgs,
	replies,
	syntheticPair,
} from "./pair-support.mjs";

async function assertProof(ctx, result) {
	assertExit(result, 0);
	assert.match(result.stdout, /proof_verified/);
	const run = readJson(join(ctx.runDir, "run.json"));
	const core = readJson(join(ctx.runDir, "core-proof.json"));
	const journal = readJson(join(ctx.runDir, "state.json"));
	const proof = readJson(join(ctx.runDir, "proof.json"));
	assert.equal(run.verdict, "proof_verified");
	assert.equal(core.target_revision, ctx.binding.bug_commit);
	for (const subject of [run, core, journal.identity])
		assert.deepEqual(subject.pair, ctx.binding);
	assert.equal(proof.rerun_without_ember.bug.exitCode, 1);
	assert.equal(proof.rerun_without_ember.fixed.exitCode, 0);
	assert.equal(core.rerun_without_ember.bug.exitCode, 1);
	assert.equal(core.rerun_without_ember.fixed.exitCode, 0);
	assert.equal(
		ctx.server.requests.length,
		3,
		"Exactly watch, repro and prove model requests",
	);
	const checkCoreProof = await product("src/run-schema.mjs", "checkCoreProof");
	assert.equal((await checkCoreProof(ctx.runDir)).status, "ok");
}

test("TC-R15-4/pair-core-proof", { timeout: 240000 }, async () => {
	await syntheticPair(replies, async (ctx) => {
		await assertProof(ctx, await ctx.exec(ctx.args));
		// The manifest's fix revision is part of proof identity, not decoration.
		const path = join(ctx.runDir, "core-proof.json");
		const core = readJson(path);
		core.pair.fix_commit = core.pair.bug_commit;
		writeJson(path, core);
		const checkCoreProof = await product(
			"src/run-schema.mjs",
			"checkCoreProof",
		);
		assert.notEqual(
			(await checkCoreProof(ctx.runDir)).status,
			"ok",
			"Refuse a changed pair binding",
		);
	});
});

async function refused(ctx, args, reason) {
	assertExit(await ctx.exec(args), 2, reason);
	assert.equal(
		ctx.server.requests.length,
		0,
		"Refusal must precede every model request",
	);
	assert.equal(
		existsSync(join(ctx.runDir, "state.json")),
		false,
		"No journal started on invalid pair",
	);
}

test("TC-R07-1/pair-build-missing", { timeout: 120000 }, async () => {
	await syntheticPair(
		[],
		async (ctx) => {
			rmSync(join(ctx.fixed.page, "index.html"));
			await refused(ctx, ctx.args, "pair_build_missing");
		},
		false,
	);
});

test("TC-R07-1/pair-commit-mismatch", { timeout: 120000 }, async () => {
	await syntheticPair(
		[],
		async (ctx) => {
			ctx.receipt.builds[1].commit = ctx.bug.commit;
			writeJson(ctx.receiptPath, ctx.receipt);
			const receiptMismatch = await ctx.exec(ctx.args);
			// Make the manifest and receipt agree with one another, but not checkout HEAD.
			ctx.pair.fix_commit = ctx.bug.commit;
			writeJson(ctx.manifest, { schema: "foley.pairs/1", pairs: [ctx.pair] });
			const headMismatch = await ctx.exec(ctx.args);
			for (const result of [receiptMismatch, headMismatch])
				assertExit(result, 2, "pair_commit_mismatch");
			assert.equal(ctx.server.requests.length, 0);
			assert.equal(existsSync(join(ctx.runDir, "state.json")), false);
		},
		false,
	);
});

test("TC-R07-1/pair-unknown", { timeout: 120000 }, async () => {
	await syntheticPair(
		[],
		(ctx) =>
			refused(
				ctx,
				pairArgs(join(ctx.root, "recording.mp4"), issue + 1),
				"pair_missing",
			),
		false,
	);
});

test("TC-R07-1/pair-receipt-boundary", { timeout: 120000 }, async () => {
	await syntheticPair(
		[],
		async (ctx) => {
			// The other side exists and has an index, but is not the fixed checkout's page.
			ctx.receipt.builds[1].page = relative(ctx.root, ctx.bug.page);
			writeJson(ctx.receiptPath, ctx.receipt);
			await refused(ctx, ctx.args, "pair_invalid");
		},
		false,
	);
});

test("TC-R15-4/pair-resume-census", { timeout: 240000 }, async () => {
	await syntheticPair(replies, async (ctx) => {
		await assertProof(ctx, await ctx.exec(ctx.args));
		const path = join(ctx.runDir, "state.json");
		const journal = sha256(readFileSync(path));
		assertExit(await ctx.exec(ctx.args), 0);
		assertExit(await ctx.exec(ctx.censusArgs), 2, "resume_mismatch");
		assert.equal(
			sha256(readFileSync(path)),
			journal,
			"Census must not replace a pair journal",
		);
		assert.equal(
			ctx.server.requests.length,
			3,
			"Resume and refusal make no additional requests",
		);
	});
});

test("TC-R15-4/pair-resume-from-census", { timeout: 120000 }, async () => {
	await syntheticPair(
		[
			{
				mode: "invalid_output",
				usage: { prompt_tokens: 10, completion_tokens: 20 },
			},
		],
		async (ctx) => {
			assertExit(await ctx.exec(ctx.censusArgs), 0);
			const path = join(ctx.runDir, "state.json");
			const journal = sha256(readFileSync(path));
			assert.equal(ctx.server.requests.length, 1);
			assertExit(await ctx.exec(ctx.args), 2, "resume_mismatch");
			assert.equal(
				sha256(readFileSync(path)),
				journal,
				"Pair must not replace a census journal",
			);
			assert.equal(ctx.server.requests.length, 1);
		},
		false,
	);
});

// Steps and a predicate that show the same thing on the bug and fixed builds.
const touch = {
	order: 1,
	t_s: 1,
	action: "click",
	target: "Touch",
	selector: "#touch",
};
const unspecific = modelReply({
	schema: "foley.steps/1",
	steps: [touch],
	predicate: {
		kind: "visible_text",
		selector: "#context",
		expected: "Fresh",
		observed: "Touched",
	},
});
const usage = (prompt_tokens) => ({
	usage: { prompt_tokens, completion_tokens: 20 },
});
const touched = (prompt_tokens = 10) =>
	modelReply(
		{ actions: [touch], done: true, verdict: "reproduced" },
		usage(prompt_tokens),
	);
const [watch, reproduction, proof] = replies;
const actionsOf = (run) =>
	run.replay.events.filter((event) => event.type === "action");

// S5 live: steps that show the failure on the fixed build too do not reproduce
// the reported bug; Watch gets one more round that says so.
test("TC-R06-7/pair-fixed-build-check", { timeout: 240000 }, async () => {
	await syntheticPair(
		[unspecific, touched(), watch, reproduction, proof],
		async (ctx) => {
			const result = await ctx.exec(ctx.args);
			assertExit(result, 0);
			assert.match(result.stdout, /proof_verified/);
			assert.equal(ctx.server.requests.length, 5);
			const feedback = ctx.server.requests[2].body.messages[1].content.find(
				(part) => part.type === "text" && part.text.startsWith("Earlier round"),
			);
			assert.match(feedback.text, /"fixed_build_shows_failure":true/);
			const replay = readJson(join(ctx.runDir, "replay.json"));
			assert.equal(replay.fixed_build_shows_failure, false);
		},
	);
});

// W4-02: when every Watch round, or a refused one, still leaves steps that the
// fixed build also shows, the outcome is an explicit conflict: no proof is
// asked for and the issue is not counted as a reproduction.
test("TC-R06-7/pair-fixed-build-conflict", { timeout: 480000 }, async () => {
	const miss = {
		mode: "invalid_output",
		usage: { prompt_tokens: 10, completion_tokens: 20 },
	};
	const round = [unspecific, touched()];
	for (const script of [
		[...round, ...round, ...round],
		[...round, miss],
	])
		await syntheticPair(script, async (ctx) => {
			const result = await ctx.exec(ctx.args);
			assertExit(result, 1);
			assert.match(result.stdout, /attempted_miss/);
			assert.equal(
				ctx.server.requests.length,
				script.length,
				"No proof request after a conflict",
			);
			const replay = readJson(join(ctx.runDir, "replay.json"));
			assert.equal(replay.status, "fixed_build_conflict");
			assert.equal(replay.fixed_build_shows_failure, true);
			const journal = readJson(join(ctx.runDir, "state.json"));
			assert.equal(journal.results.repro.status, "fixed_build_conflict");
			assert.equal(journal.status, "attempted_miss");
			assert.equal(journal.results.prove, undefined);
			assert.equal(existsSync(join(ctx.runDir, "proof.json")), false);
			const run = readJson(join(ctx.runDir, "run.json"));
			assert.equal(run.verdict, "attempted_miss");
			assert.equal(run.stages.repro, "fixed_build_conflict");
			const checkCoreProof = await product(
				"src/run-schema.mjs",
				"checkCoreProof",
			);
			assert.equal((await checkCoreProof(ctx.runDir)).status, "not_verified");
		});
});

// W4-07: a run document reports the cost of its own calls, apart from what
// the issue's case has spent over every run.
test("TC-R15-4/pair-run-cost", { timeout: 480000 }, async () => {
	await syntheticPair([...replies, ...replies], async (ctx) => {
		await assertProof(ctx, await ctx.exec(ctx.args));
		const first = readJson(join(ctx.runDir, "run.json"));
		assert.ok(first.cost_micro_usd > 0);
		assert.equal(first.case_cost_micro_usd, first.cost_micro_usd);
		renameSync(ctx.runDir, `${ctx.runDir}-first`);
		assertExit(await ctx.exec(ctx.args), 0);
		assert.equal(ctx.server.requests.length, 6);
		const second = readJson(join(ctx.runDir, "run.json"));
		assert.equal(second.model_calls.length, 3, "Only this run's calls");
		assert.equal(second.cost_micro_usd, first.cost_micro_usd);
		assert.equal(second.case_cost_micro_usd, 2 * first.cost_micro_usd);
	});
});

// W4-12: usage shown on an action belongs to the model turn that produced it,
// in the reproduction round that is kept; earlier rounds' calls name their round.
test("TC-R06-7/round-attribution", { timeout: 240000 }, async () => {
	const kept = modelReply(reproduction.output, usage(30));
	await syntheticPair(
		[unspecific, touched(70), watch, kept, proof],
		async (ctx) => {
			assertExit(await ctx.exec(ctx.args), 0);
			const run = readJson(join(ctx.runDir, "run.json"));
			const actions = actionsOf(run);
			assert.equal(actions.length, 1);
			assert.equal(actions[0].input_tokens, 30);
			const calls = run.model_calls.filter((call) => call.stage === "repro");
			assert.deepEqual(
				calls.map((call) => [call.round, call.input_tokens]),
				[
					[1, 70],
					[2, 30],
				],
			);
			assert.ok(
				run.replay.events.some(
					(event) =>
						event.type === "model_call" &&
						event.round === 1 &&
						event.input_tokens === 70,
				),
				"The earlier round's call stays in the feed under its round",
			);
		},
	);
});

// W4-12: a re-asked turn is two calls for one observation; both are its usage.
test("TC-R06-3/pair-reask-attribution", { timeout: 240000 }, async () => {
	const invalid = modelReply(
		{ actions: [{ action: "click" }], done: true, verdict: "reproduced" },
		usage(40),
	);
	const kept = modelReply(reproduction.output, usage(30));
	await syntheticPair([watch, invalid, kept, proof], async (ctx) => {
		assertExit(await ctx.exec(ctx.args), 0);
		const actions = actionsOf(readJson(join(ctx.runDir, "run.json")));
		assert.equal(actions.length, 1);
		assert.equal(actions[0].input_tokens, 70);
	});
});

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { localEnv, readJson, readLines, sha256 } from "../stages/support.mjs";
import {
	assertExit,
	killAtCut,
	killAtRequest,
	miss,
	scenario,
	watchReply,
} from "./R-support.mjs";

const settings = { timeout: 240000 };
const held = { ...miss, hold: true };

// W3-01: the actual CLI holds a kernel lock while a request is in flight.
test("TC-R09-4/run-exclusive", settings, async () => {
	await scenario([held, miss], async (ctx) => {
		const owner = ctx.start(ctx.runArgs);
		await ctx.server.waitForRequests(1, 60000);
		const lockPath = join(ctx.out, "foley-run.lock");
		const inode = statSync(lockPath).ino;
		const probe = spawnSync(
			"flock",
			["--exclusive", "--nonblock", lockPath, "true"],
			{ env: localEnv(), timeout: 10000 },
		);
		const competitor = await ctx.start(ctx.backlogArgs).done;
		assertExit(competitor, 2, /run_active/);
		assert.equal(ctx.server.requests.length, 1);
		assert.equal(probe.error, undefined);
		assert.equal(probe.status, 1, "Kernel lock not held during the pipeline");
		assert.equal((await owner.stop("SIGKILL")).signal, "SIGKILL");
		assertExit(await ctx.start(ctx.runArgs).done, 1);
		assert.equal(
			ctx.server.requests.length,
			2,
			"Dead owner did not release the lock safely",
		);
		assert.equal(
			statSync(lockPath).ino,
			inode,
			"Recovery replaced the lock inode",
		);
	});
});

// W3-02: the first repro request establishes that watch and locate have committed.
test("TC-R09-1/cross-command-resume", settings, async () => {
	const resumed = [];
	for (const fromRun of [false, true]) {
		await scenario([watchReply, held, miss], async (ctx) => {
			const [first, second] = fromRun
				? [ctx.runArgs, ctx.backlogArgs]
				: [ctx.backlogArgs, ctx.runArgs];
			await killAtRequest(ctx, first, 2);
			assert.equal(ctx.readRun().stages.watch, "ok");
			const stageFile = readFileSync(join(ctx.runDir, "steps.json"));
			assertExit(await ctx.start(second).done, fromRun ? 0 : 1);
			assert.equal(ctx.server.requests.length, 3);
			const systems = ctx.server.requests.map(
				(r) => r.body.messages[0].content,
			);
			assert.notEqual(systems[0], systems[1], "Fixture failed to reach repro");
			resumed.push(systems[2] === systems[1]);
			assert.deepEqual(readFileSync(join(ctx.runDir, "steps.json")), stageFile);
			assert.equal(ctx.readRun().verdict, "attempted_miss");
		});
	}
	assert.deepEqual(
		resumed,
		[true, true],
		"Cross-command resume repeated the committed watch stage instead of resuming repro",
	);
});

// W3-02: two independent interrupted visits are the permitted maximum.
test("TC-R09-2/attempt-limit", settings, async () => {
	await scenario([held, held, miss], async (ctx) => {
		await killAtRequest(ctx, ctx.runArgs, 1);
		await killAtRequest(ctx, ctx.backlogArgs, 2);
		assertExit(await ctx.start(ctx.runArgs).done, 1);
		assert.equal(
			ctx.server.requests.length,
			2,
			"A third interrupted-stage attempt transmitted a request",
		);
		assert.equal(ctx.readRun().verdict, "attempted_miss");
	});
});

async function checkSpend(ctx) {
	const money = ctx.ledger();
	const booked = money.open.reduce((sum, item) => sum + item.upperBound, 0);
	const expected = money.settled + booked;
	assert.ok(expected > 0);
	assertExit(await ctx.start(["spend"]).done, 0);
	const summary = readJson(join(ctx.out, "spend-summary.json"));
	const projections = () => [
		ctx.readRun().cost_micro_usd,
		ctx.readReport()[0].cost_micro_usd,
		readJson(join(ctx.out, "spend-summary.json")).per_stage.watch,
	];
	assert.deepEqual(
		[summary.settled, summary.booked, summary.total],
		[money.settled, booked, expected],
	);
	assert.deepEqual(
		projections(),
		[expected, expected, expected],
		"Run, backlog and watch spend omit prior settled/booked calls",
	);
	const requests = ctx.server.requests.length;
	assertExit(await ctx.start(ctx.backlogArgs).done, 0);
	assertExit(await ctx.start(["spend"]).done, 0);
	assert.deepEqual(
		projections(),
		[expected, expected, expected],
		"Reconciliation is not idempotent",
	);
	assert.equal(ctx.server.requests.length, requests);
	const after = ctx.ledger();
	assert.equal(after.settled, money.settled);
	assert.deepEqual(
		after.open.map(({ callId, upperBound }) => ({ callId, upperBound })),
		money.open.map(({ callId, upperBound }) => ({ callId, upperBound })),
	);
}

// W3-03: crash during a real outstanding request; its reservation stays booked.
test("TC-R13-3/booked-recovery", settings, async () => {
	await scenario([held, miss], async (ctx) => {
		await killAtRequest(ctx, ctx.runArgs, 1);
		const [reservation] = ctx.ledger().open;
		assert.ok(reservation?.upperBound > 0);
		assertExit(await ctx.start(ctx.backlogArgs).done, 0);
		assert.ok(
			ctx
				.ledger()
				.open.some(
					(item) =>
						item.callId === reservation.callId &&
						item.upperBound === reservation.upperBound,
				),
		);
		await checkSpend(ctx);
	});
});

// W3-03: crash after the durable spend transaction but before its caller resumes.
test("TC-R13-3/settled-recovery", settings, async () => {
	await scenario([watchReply, miss], async (ctx) => {
		await killAtCut(ctx, ctx.runArgs, "settled");
		const previous = ctx.ledger().settled;
		assert.ok(previous > 0);
		assert.equal(ctx.ledger().open.length, 0);
		assertExit(await ctx.start(ctx.backlogArgs).done, 0);
		assert.ok(ctx.ledger().settled > previous);
		await checkSpend(ctx);
	});
});

// W3-08: the final run document alone is not a completion commit.
test("TC-INT-1/finalization-recovery", settings, async () => {
	await scenario([miss], async (ctx) => {
		await killAtCut(ctx, ctx.runArgs, "finished");
		assert.equal(ctx.readRun().state, "finished");
		assert.equal(
			existsSync(join(ctx.runDir, "completion.json")),
			false,
			"Completion marker was written before final run publication",
		);
		assertExit(await ctx.start(ctx.runArgs).done, 1);
		assert.equal(
			ctx.server.requests.length,
			1,
			"Finalization repeated model work",
		);
		const required = [
			"run.json",
			"comment.md",
			"replay.html",
			"core-proof.json",
			"artifact-trace.jsonl",
			"completion.json",
		];
		assert.deepEqual(
			required.filter((name) => !existsSync(join(ctx.runDir, name))),
			[],
			"Resume trusted an incomplete run.json instead of finishing the report",
		);
		const proof = readJson(join(ctx.runDir, "core-proof.json"));
		const trace = readLines(join(ctx.runDir, "artifact-trace.jsonl"));
		assert.equal(trace.length, Object.keys(proof.artifacts).length);
		for (const [path, digest] of Object.entries(proof.artifacts)) {
			assert.equal(sha256(readFileSync(join(ctx.runDir, path))), digest);
			assert.equal(
				trace.filter((entry) => entry.path === path && entry.sha256 === digest)
					.length,
				1,
			);
		}
	});
});

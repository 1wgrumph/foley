import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
	archive,
	clip,
	entry,
	fixture,
	modelReply,
	pinFixture,
	product,
	proofCode,
	readJson,
	startChild,
	temporary,
	withApps,
	withEmber,
	writeJson,
} from "../stages/support.mjs";

const observationLimit = 1024;
const reasonLimit = 512;
const archiveAction = archive.steps[0];
const final = (actions, extra = {}) => ({
	actions,
	done: true,
	verdict: "reproduced",
	...extra,
});
const actionText = (events) =>
	events
		.filter((event) => event.type === "action")
		.map((event) => ({
			action: event.action,
			observation: event.observation,
			reason: event.reason,
		}));

async function runPipeline(root, origin, env) {
	const { target, revision } = pinFixture(root);
	const fixed = pinFixture(root, "app-fixed");
	const recording = join(root, "recording.mp4");
	copyFileSync(clip, recording);
	const probe = join(root, "probe.json");
	writeJson(probe, { video: { accepted: false }, audio: { accepted: false } });
	const child = startChild(
		[
			"--import",
			fixture("stages", "loopback-only.mjs"),
			entry("bin/foley.mjs"),
			"run",
			"1",
			"--issue-url",
			"https://example.invalid/issues/1",
			"--fixture",
			"--recording",
			recording,
			"--target",
			target,
			"--revision",
			revision,
			"--fixed-target",
			fixed.target,
			"--app-origin",
			origin,
			"--runner",
			"node-test",
			"--case-budget",
			"100000",
			"--probe",
			probe,
		],
		{ cwd: root, env },
	);
	return child.done;
}

const watchReply = modelReply(archive);
const proveReply = modelReply({
	code: proofCode,
	filename: "regression.test.mjs",
	assertion: "archive-status",
});

test("TC-R06-1/observation", { timeout: 240000 }, async () => {
	const observation = "Archive button is visible.".padEnd(
		observationLimit,
		".",
	);
	const reason = "Inspect the archive control.".padEnd(reasonLimit, ".");
	const laterObservation = "The archive control is still available.";
	const replies = [
		watchReply,
		modelReply({
			actions: [
				{ action: "move", selector: "#archive", reason },
				{ action: "screenshot", reason: "Capture the hovered control." },
			],
			observation,
			done: false,
		}),
		modelReply({
			actions: [
				{
					action: "move",
					selector: "#archive",
					reason: "Return to the archive button.",
				},
			],
			observation: laterObservation,
			done: false,
		}),
		modelReply(final([archiveAction])),
		proveReply,
	];
	const expected = [
		{ action: "move", observation, reason },
		{
			action: "screenshot",
			observation,
			reason: "Capture the hovered control.",
		},
		{
			action: "move",
			observation: laterObservation,
			reason: "Return to the archive button.",
		},
		{ action: "click", observation: undefined, reason: undefined },
	];
	await temporary((root) =>
		withApps(root, ({ bug }) =>
			withEmber(root, replies, async ({ env, server }) => {
				const result = await runPipeline(root, bug.origin, env);
				assert.equal(result.code, 0, result.stderr);
				assert.equal(server.requests.length, replies.length);
				const runDir = join(root, "out", "runs", "1");
				const replay = readJson(join(runDir, "replay.json"));
				const run = readJson(join(runDir, "run.json"));
				assert.equal(replay.observed, true);
				assert.equal(run.verdict, "proof_verified");
				assert.equal(
					(await product("src/run-schema.mjs", "validateRun"))(run),
					true,
				);
				assert.deepEqual(
					actionText(replay.events),
					expected,
					"Replay action observation and reason must match their model turn",
				);
				assert.deepEqual(
					actionText(run.replay.events),
					expected,
					"Run must preserve replay action observation and reason",
				);
				for (const request of server.requests.slice(1, -1)) {
					const instructions = request.body.messages.find(
						(message) => message.role === "system",
					)?.content;
					assert.match(instructions, /\bobservation\b/i);
					assert.match(instructions, /\breason\b/i);
					assert.match(instructions, /\b1,?024\b/);
					assert.match(instructions, /\b512\b/);
				}
			}),
		),
	);
});

// Use an inert credential-shaped sentinel unrelated to the actual offline key.
const shaped = ["ghp_", "A".repeat(36)].join("");
function containsSentinel(folder) {
	return readdirSync(folder, { withFileTypes: true }).some((entry) => {
		const path = join(folder, entry.name);
		return entry.isDirectory()
			? containsSentinel(path)
			: readFileSync(path).includes(shaped);
	});
}

function refusal(replay) {
	return {
		status: replay.status,
		observed: replay.observed,
		stopped: replay.events.find((event) => event.type === "stopped")?.reason,
		actions: replay.events.filter((event) => event.type === "action").length,
	};
}
const malformed = {
	status: "not_reproduced",
	observed: false,
	stopped: "malformed_output",
	actions: 0,
};

test("TC-R06-3/observation", { timeout: 240000 }, async () => {
	const repro = await product("src/repro.mjs", "repro");
	const actual = {};
	const expected = {};
	for (const [field, limit] of [
		["observation", observationLimit],
		["reason", reasonLimit],
	]) {
		for (const [label, value] of [
			["number", 7],
			["null", null],
			["over bound", "x".repeat(limit + 1)],
			["credential shaped", shaped],
		]) {
			const name = `${field}: ${label}`;
			const reply =
				field === "observation"
					? final([archiveAction], { observation: value })
					: final([
							{ action: "move", selector: "#archive" },
							{ ...archiveAction, reason: value },
						]);
			await temporary((root) =>
				withApps(root, ({ bug }) =>
					withEmber(
						root,
						[modelReply(reply)],
						async ({ callEmber, server }) => {
							const runDir = join(root, "run");
							mkdirSync(runDir);
							await repro(archive.steps, archive.predicate, bug.origin, {
								runDir,
								caseId: "malformed",
								caseBudget: 100000,
								callEmber,
							});
							assert.equal(server.requests.length, 1);
							assert.ok(
								!containsSentinel(root),
								"Credential-shaped model text persisted",
							);
							actual[name] = refusal(readJson(join(runDir, "replay.json")));
							expected[name] = malformed;
						},
					),
				),
			);
		}
	}
	assert.deepEqual(
		actual,
		expected,
		"Invalid observation or reason must stop the turn as malformed_output before executing an action",
	);
});

test("TC-R06-5/observation", { timeout: 240000 }, async () => {
	await temporary((root) =>
		withApps(root, ({ bug }) =>
			withEmber(
				root,
				[
					watchReply,
					modelReply(
						final([{ ...archiveAction, reason: shaped }], {
							observation: shaped,
						}),
					),
					proveReply,
				],
				async ({ env }) => {
					const result = await runPipeline(root, bug.origin, env);
					const runDir = join(root, "out", "runs", "1");
					const run = readJson(join(runDir, "run.json"));
					assert.ok(
						!containsSentinel(join(root, "out")),
						"Credential-shaped text persisted in pipeline artifacts",
					);
					assert.equal(
						result.code,
						1,
						"Malformed explanation must not produce a verified proof",
					);
					assert.equal(run.verdict, "attempted_miss");
					assert.deepEqual(
						refusal(readJson(join(runDir, "replay.json"))),
						malformed,
					);
					assert.ok(
						run.replay.events.some(
							(event) =>
								event.type === "stopped" && event.reason === "malformed_output",
						),
					);
				},
			),
		),
	);
});

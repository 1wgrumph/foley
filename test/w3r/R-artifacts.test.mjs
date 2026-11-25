import assert from "node:assert/strict";
import {
	copyFileSync,
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	truncateSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
	archive,
	modelReply,
	product,
	readJson,
	readLines,
	runCommand,
	sha256,
	temporary,
	writeJson,
} from "../stages/support.mjs";
import { openStatic, withBrowser } from "../ui/support.mjs";
import {
	assertExit,
	miss,
	option,
	proveReply,
	reproReply,
	rowsAfter,
	rowsBefore,
	scenario,
	watchReply,
} from "./R-support.mjs";

const settings = { timeout: 240000 };
const success = [watchReply, reproReply, proveReply];
const marker = (ctx) => existsSync(join(ctx.runDir, "completion.json"));
const readIfPresent = (path) => (existsSync(path) ? readJson(path) : null);

// W3-08: an owned directory collision prevents publishing the report file.
test("TC-R09-1/report-error-not-complete", settings, async () => {
	await scenario(
		[watchReply, reproReply, { ...proveReply, hold: true }],
		async (ctx) => {
			const child = ctx.start(ctx.backlogArgs);
			await ctx.server.waitForRequests(3, 60000);
			const collision = join(ctx.runDir, "comment.md");
			mkdirSync(collision);
			ctx.server.release(2);
			const result = await child.done;
			assert.equal(result.signal, null);
			const row = readIfPresent(join(ctx.out, "backlog-report.json"))?.[0];
			assert.notEqual(
				row?.status,
				"proof_verified",
				"Backlog reported verified proof although report publication failed",
			);
			assert.equal(marker(ctx), false);
			rmSync(collision, { recursive: true });
			assertExit(await ctx.start(ctx.backlogArgs).done, 0);
			assert.equal(
				ctx.server.requests.length,
				3,
				"Report repair repeated completed model stages",
			);
			assert.equal(ctx.readReport()[0].status, "proof_verified");
			assert.equal(marker(ctx), true);
		},
	);
});

function rewriteArtifact(directory, path, transform) {
	const artifact = join(directory, path);
	writeJson(artifact, transform(readJson(artifact)));
	return sha256(readFileSync(artifact));
}

// Rebuild hashes for a deliberately inconsistent synthetic proof copy. This is a
// consumer integrity check, not an attack on a live run or any real issue.
async function variant(ctx, checkCoreProof, name, change) {
	const directory = join(ctx.root, name);
	cpSync(ctx.runDir, directory, { recursive: true });
	const manifestPath = join(directory, "core-proof.json");
	const tracePath = join(directory, "artifact-trace.jsonl");
	const manifest = readJson(manifestPath);
	let trace = readLines(tracePath);
	const update = (path, transform) => {
		const digest = rewriteArtifact(directory, path, transform);
		manifest.artifacts[path] = digest;
		trace = trace.map((entry) =>
			entry.path === path ? { ...entry, sha256: digest } : entry,
		);
	};
	change({
		manifest,
		update,
		drop(path) {
			delete manifest.artifacts[path];
			trace = trace.filter((entry) => entry.path !== path);
		},
		duplicate() {
			trace.push(trace[0]);
		},
	});
	writeJson(manifestPath, manifest);
	writeFileSync(
		tracePath,
		`${trace.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
	);
	return (await checkCoreProof(directory)).status === "ok";
}

// W3-09: hashes alone cannot establish completeness or proof semantics.
test("TC-R15-4/complete-proof-semantics", settings, async () => {
	const checkCoreProof = await product("src/run-schema.mjs", "checkCoreProof");
	await scenario(success, async (ctx) => {
		assertExit(await ctx.start(ctx.runArgs).done, 0);
		assert.equal(
			(await checkCoreProof(ctx.runDir)).status,
			"ok",
			"Positive fixture did not establish proof",
		);
		const changes = {
			inventory: ({ drop }) => drop("steps.json"),
			verdict: ({ update }) =>
				update("run.json", (run) => ({ ...run, verdict: "attempted_miss" })),
			predicate: ({ update }) =>
				update("run.json", (run) => ({ ...run, predicate: null })),
			stages: ({ update }) =>
				update("run.json", (run) => ({
					...run,
					stages: { ...run.stages, prove: "not_verified" },
				})),
			observed: ({ update }) =>
				update("replay.json", (replay) => ({ ...replay, observed: false })),
			identity: ({ manifest }) => {
				manifest.target_revision = "0000000000000000000000000000000000000001";
			},
			runner: ({ update }) =>
				update("proof.json", (proof) => ({
					...proof,
					rerun_without_ember: { bug: { exitCode: 0 }, fixed: { exitCode: 0 } },
				})),
			fixture: ({ manifest }) => {
				manifest.fixture = false;
			},
			trace: ({ duplicate }) => duplicate(),
		};
		const accepted = [];
		for (const [name, change] of Object.entries(changes))
			if (await variant(ctx, checkCoreProof, name, change)) accepted.push(name);
		assert.deepEqual(
			accepted,
			[],
			"Digest-consistent incomplete or contradictory fixture counted as verified proof",
		);
	});
});

const firstTurn = {
	actions: [
		{ action: "click", selector: "#archive", reason: "Exercise archive" },
	],
	done: false,
	observation: "Archive button is available",
};

// W3-13: the second real request is a barrier after the first action frame.
test("TC-R14-2/incremental-actions", settings, async () => {
	await scenario(
		[
			watchReply,
			{ ...watchReply, output: firstTurn },
			{ ...reproReply, hold: true },
		],
		async (ctx) => {
			const child = ctx.start([...ctx.runArgs, "--live"]);
			const [, origin] = await child.waitForOutput(
				/LIVE_URL=(http:\/\/127\.0\.0\.1:\d+)/,
			);
			await ctx.server.waitForRequests(3, 60000);
			const run = ctx.readRun();
			const action = run.replay.events.find((event) => event.type === "action");
			assert.ok(
				action,
				"An executed action is missing while the next repro reply is held",
			);
			assert.equal(action.action, "click");
			assert.equal(action.reason, firstTurn.actions[0].reason);
			assert.equal(action.observation, firstTurn.observation);
			assert.ok(
				run.replay.screenshots.some(
					(frame) =>
						frame.action === "click" &&
						existsSync(join(ctx.runDir, frame.path)),
				),
				"Executed action frame absent from live run snapshot",
			);
			await withBrowser(async (browser) => {
				const context = await browser.newContext({ serviceWorkers: "block" });
				try {
					await context.route("**/*", (route) =>
						new URL(route.request().url()).origin === origin ||
						/^(data|blob):/.test(route.request().url())
							? route.continue()
							: route.abort(),
					);
					const page = await context.newPage();
					await page.goto(origin);
					await page.waitForFunction(
						(count) =>
							Number(
								document.querySelector('[data-testid="action-feed"]')?.dataset
									.eventCount,
							) === count,
						run.replay.events.length,
						{ timeout: 30000 },
					);
					assert.match(
						await page.getByTestId("action-feed").textContent(),
						/click/i,
					);
				} finally {
					await context.close();
				}
			});
		},
	);
});

// W3-14: both the initial census and exported terminal snapshot use the real CLI.
test("TC-R09-1/early-miss-census", settings, async () => {
	await scenario([{ ...miss, hold: true }], async (ctx) => {
		const child = ctx.start(ctx.backlogArgs);
		await ctx.server.waitForRequests(1, 60000);
		const before = readIfPresent(join(ctx.runDir, "census.json"));
		ctx.server.release(0);
		assertExit(await child.done, 0);
		assert.deepEqual(readJson(join(ctx.runDir, "census.json")), rowsAfter);
		let visible;
		await withBrowser(async (browser) => {
			const view = await openStatic(browser, join(ctx.runDir, "replay.html"));
			try {
				visible = await view.page.getByTestId("census-row").allInnerTexts();
			} finally {
				await view.context.close();
			}
		});
		assert.deepEqual(
			{ before, rows: visible.length },
			{ before: rowsBefore, rows: 2 },
			"Census must exist before the first request and contain every row at early terminal export",
		);
		assert.match(visible[0], /#1.*attempted miss/is);
		assert.match(visible[1], /#2.*no usable media/is);
	});
});

// W3-15: invalid input is refused before copying, regardless of media extension.
test("TC-R04-2/integrated-recording-refusal", settings, async () => {
	await scenario([], async (ctx) => {
		const invalid = join(ctx.root, "recording.txt");
		// Valid bytes, unsupported declared type.
		copyFileSync(ctx.clip, invalid);
		const result = await ctx.start(option(ctx.runArgs, "--recording", invalid))
			.done;
		assert.equal(result.signal, null);
		assert.deepEqual(
			{
				exit: result.code,
				copied: existsSync(join(ctx.runDir, "recording.txt")),
			},
			{ exit: 2, copied: false },
			"Invalid recording copied and reached final rendering",
		);
		assert.match(result.stderr, /refused_input/);
		assert.equal(ctx.server.requests.length, 0);
	});
});

// W3-15: plausible extensions do not admit damaged or oversized recordings.
test("TC-R04-2/recording-content-and-size", settings, async () => {
	await scenario([], async (ctx) => {
		const broken = join(ctx.root, "broken.mp4");
		const oversized = join(ctx.root, "oversized.mp4");
		writeFileSync(broken, readFileSync(ctx.clip).subarray(0, 32));
		copyFileSync(ctx.clip, oversized);
		truncateSync(oversized, 50 * 1024 * 1024 + 1);
		const results = [];
		for (const [index, input] of [broken, oversized].entries()) {
			const args = option(ctx.runArgs, "--recording", input);
			const issue = String(index + 2);
			args[1] = issue;
			const result = await ctx.start(args).done;
			assert.equal(result.signal, null);
			results.push({
				exit: result.code,
				copied: existsSync(join(ctx.out, "runs", issue, "recording.mp4")),
			});
		}
		await temporary(async (outside) => {
			const path = join(outside, "outside.mp4");
			copyFileSync(ctx.clip, path);
			assertExit(
				await ctx.start(option(ctx.runArgs, "--recording", path)).done,
				2,
				/outside_working_tree/,
			);
		});
		assert.deepEqual(
			results,
			[
				{ exit: 2, copied: false },
				{ exit: 2, copied: false },
			],
			"Broken and oversized recordings were copied into run folders",
		);
		assert.equal(ctx.server.requests.length, 0);
	});
});

// W3-15: a real recording with audio; the external decoder fails only on audio extraction.
test("TC-R04-2/audio-extraction-refusal", settings, async () => {
	await scenario([], async (ctx) => {
		const audio = join(ctx.root, "narrated.mp4");
		runCommand("ffmpeg", [
			"-v",
			"error",
			"-i",
			ctx.clip,
			"-f",
			"lavfi",
			"-i",
			"sine=frequency=440:duration=2",
			"-c:v",
			"copy",
			"-c:a",
			"aac",
			"-shortest",
			audio,
		]);
		const streams = JSON.parse(
			runCommand("ffprobe", [
				"-v",
				"error",
				"-show_entries",
				"stream=codec_type",
				"-of",
				"json",
				audio,
			]),
		).streams;
		assert.ok(
			streams.some(({ codec_type }) => codec_type === "audio"),
			"Fixture must contain an audio track",
		);
		// Measured bounds (fixtures/ember/bounds.json) refuse audio, and the CLI
		// ignores --probe once they exist, so Watch is driven with the probe directly.
		const probe = {
			video: { accepted: false },
			audio: { accepted: true, tokensPerSecond: 100 },
		};
		const tools = join(ctx.root, "decoder-tools");
		mkdirSync(tools);
		const ffmpeg = runCommand("which", ["ffmpeg"]).trim();
		assert.match(ffmpeg, /^\/[A-Za-z0-9/_.-]+$/);
		// Preserve real probe/encode behaviour. Fail only the declared audio extraction operation.
		writeFileSync(
			join(tools, "ffmpeg"),
			`#!/bin/sh
for arg in "$@"; do
  if [ "$arg" = "-vn" ]; then
    echo "synthetic audio decode failure" >&2
    exit 7
  fi
done
exec ${ffmpeg} "$@"
`,
			{ mode: 0o755 },
		);
		const { watch } = await import("../../src/watch.mjs");
		const path = process.env.PATH;
		let calls = 0;
		let result;
		process.env.PATH = `${tools}:${path}`;
		try {
			result = await watch(audio, {
				runDir: join(ctx.root, "watch-run"),
				callEmber: async () => {
					calls++;
					return { status: "api_error" };
				},
				probe,
				caseId: "audio-extraction",
				caseBudget: 100000,
			});
		} finally {
			process.env.PATH = path;
		}
		assert.equal(result.status, "refused_input");
		assert.match(result.message, /audio/);
		assert.equal(calls, 0);
	});
});

// W3-15: a sparse cache file is only one byte over the explicit 50 MiB bound.
test("TC-R04-2/cache-size-before-read", settings, async () => {
	await scenario([], async (ctx) => {
		const bytes = 50 * 1024 * 1024 + 1;
		const digest = sha256(Buffer.alloc(bytes));
		const path = join(ctx.mediaDir, `${digest}.mp4`);
		writeFileSync(path, "");
		truncateSync(path, bytes);
		const manifest = readJson(ctx.census);
		manifest.candidates[0].media[0].sha256 = digest;
		writeJson(ctx.census, manifest);
		const result = await ctx.start([...ctx.backlogArgs, "--dry-run"], {
			FOLEY_TEST_CUT: "cache-read",
			FOLEY_TEST_INVALID_CACHE: path,
		}).done;
		assert.equal(result.signal, null);
		assert.deepEqual(
			{ exit: result.code, fullRead: result.stdout.includes("W3R-FULL-READ") },
			{ exit: 2, fullRead: false },
			"Oversized cached media was read in full before size refusal",
		);
		assert.match(result.stderr, /refused_input/);
		assert.equal(ctx.server.requests.length, 0);
	});
});

// W3-16: a tracked source edit invalidates the run's nominated revision.
test("TC-INT-1/dirty-target-refusal", settings, async () => {
	await scenario([], async (ctx) => {
		const file = join(ctx.target, "logic.mjs");
		writeFileSync(
			file,
			`${readFileSync(file, "utf8")}\n// Synthetic unsaved edit\n`,
		);
		assertExit(
			await ctx.start([...ctx.runArgs, "--dry-run"]).done,
			2,
			/target_not_pinned/,
		);
		assert.equal(ctx.server.requests.length, 0);
	});
});

// W3-16: use a different valid recording plus clean new revision, runner and mode.
test("TC-INT-1/resume-input-identity", settings, async () => {
	await scenario([miss], async (ctx) => {
		assertExit(await ctx.start(ctx.runArgs).done, 1);
		const original = readFileSync(join(ctx.runDir, "run.json"));
		assertExit(await ctx.start(ctx.runArgs).done, 1);
		assert.deepEqual(
			readFileSync(join(ctx.runDir, "run.json")),
			original,
			"Matching resume changed finished run",
		);
		const changed = join(ctx.root, "changed.mp4");
		runCommand("ffmpeg", [
			"-v",
			"error",
			"-i",
			ctx.clip,
			"-c",
			"copy",
			"-metadata",
			"comment=alternate synthetic recording",
			changed,
		]);
		assert.notEqual(
			sha256(readFileSync(changed)),
			sha256(readFileSync(ctx.clip)),
		);
		const variants = [
			option(ctx.runArgs, "--recording", changed),
			option(ctx.runArgs, "--runner", "vitest"),
			option(ctx.runArgs, "--fixture", undefined),
		];
		const statuses = [];
		for (const args of variants) statuses.push(await ctx.start(args).done);
		runCommand("git", [
			"-C",
			ctx.target,
			"-c",
			"user.name=Fixture",
			"-c",
			"user.email=fixture@example.invalid",
			"commit",
			"--allow-empty",
			"-qm",
			"Second synthetic revision",
		]);
		const revision = runCommand("git", [
			"-C",
			ctx.target,
			"rev-parse",
			"HEAD",
		]).trim();
		assert.notEqual(revision, ctx.revision);
		statuses.push(
			await ctx.start(option(ctx.runArgs, "--revision", revision)).done,
		);
		assert.deepEqual(
			statuses.map((result) => result.code),
			[2, 2, 2, 2],
			"A mismatch silently reused the completed numeric issue",
		);
		for (const result of statuses) assertExit(result, 2, /resume_mismatch/);
		assert.deepEqual(readFileSync(join(ctx.runDir, "run.json")), original);
		assert.equal(ctx.server.requests.length, 1);
	});
});

// S5 live: a predicate that already holds on the fresh page sends Watch one
// more bounded round with what reproduction saw; the new steps reach proof.
test("TC-R06-7/watch-round", settings, async () => {
	const checkCoreProof = await product("src/run-schema.mjs", "checkCoreProof");
	const holdsBefore = modelReply({
		...archive,
		predicate: { ...archive.predicate, observed: "Ready" },
	});
	await scenario(
		[holdsBefore, watchReply, reproReply, proveReply],
		async (ctx) => {
			assertExit(await ctx.start(ctx.runArgs).done, 0);
			assert.equal((await checkCoreProof(ctx.runDir)).status, "ok");
			const run = ctx.readRun();
			assert.deepEqual(
				run.model_calls.map((call) => call.stage),
				["watch", "watch", "repro", "prove"],
			);
			const feedback = ctx.server.requests[1].body.messages[1].content.find(
				(part) => part.type === "text" && part.text.startsWith("Earlier round"),
			);
			assert.match(feedback.text, /"predicate_held_before":true/);
			assert.equal(run.predicate.observed, archive.predicate.observed);
		},
	);
});

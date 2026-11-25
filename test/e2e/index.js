import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
	archive,
	entry,
	fixture,
	modelReply,
	pinFixture,
	product,
	proofCode,
	readJson,
	repo,
	runCommand,
	startChild,
	temporary,
	withApps,
	withEmber,
	writeJson,
} from "../stages/support.mjs";
import {
	checkLocalPage,
	checkSeven,
	openStatic,
	withBrowser,
} from "../ui/support.mjs";

const issue = 1;
const fixtureUrl = "https://example.invalid/issues/1";
const watchReply = modelReply(archive);
const reproReply = modelReply({
	actions: archive.steps,
	done: true,
	verdict: "reproduced",
});
const proveReply = modelReply({
	code: proofCode,
	filename: "regression.test.mjs",
	assertion: "archive-status",
});
const artifactNames = [
	"recording.mp4",
	"steps.json",
	"anchors.json",
	"replay.json",
	"proof.json",
	"regression.test.mjs",
	"comment.md",
	"replay.html",
	"run.json",
	"core-proof.json",
	"artifact-trace.jsonl",
];

async function seededRecording(root, origin) {
	await withBrowser(async (browser) => {
		const context = await browser.newContext({
			viewport: { width: 640, height: 480 },
			serviceWorkers: "block",
		});
		try {
			await context.route("**/*", (route) =>
				new URL(route.request().url()).origin === origin
					? route.continue()
					: route.abort(),
			);
			const page = await context.newPage();
			await page.goto(origin);
			await page.getByRole("button", { name: "Archive" }).waitFor();
			await page.screenshot({ path: join(root, "frame-0.png") });
			await page.getByRole("button", { name: "Archive" }).click();
			await page
				.getByRole("status")
				.filter({ hasText: "Not archived" })
				.waitFor();
			await page.screenshot({ path: join(root, "frame-1.png") });
		} finally {
			await context.close();
		}
	});
	const recording = join(root, "seeded.mp4");
	runCommand("ffmpeg", [
		"-v",
		"error",
		"-framerate",
		"1",
		"-i",
		join(root, "frame-%d.png"),
		"-c:v",
		"libx264",
		"-threads",
		"1",
		"-pix_fmt",
		"yuv420p",
		recording,
	]);
	return recording;
}

async function pipelineArgs(root, origin, cli, live = false) {
	const { target, revision } = pinFixture(root);
	const fixed = pinFixture(root, "app-fixed");
	const recording = await seededRecording(root, origin);
	const probe = join(root, "probe.json");
	writeJson(probe, { video: { accepted: false }, audio: { accepted: false } });
	return {
		revision,
		args: [
			"--import",
			fixture("stages", "loopback-only.mjs"),
			cli,
			"run",
			String(issue),
			"--issue-url",
			fixtureUrl,
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
			...(live ? ["--live"] : []),
		],
	};
}

test("TC-INT-1", { timeout: 240000 }, async () => {
	const cli = entry("bin/foley.mjs");
	const validateRun = await product("src/run-schema.mjs", "validateRun");
	const checkCoreProof = await product("src/run-schema.mjs", "checkCoreProof");
	await temporary((root) =>
		withApps(root, ({ bug }) =>
			withEmber(
				root,
				[watchReply, reproReply, proveReply],
				async ({ server, env, ledger }) => {
					const { args, revision } = await pipelineArgs(root, bug.origin, cli);
					const child = startChild(args, { cwd: root, env });
					try {
						const result = await child.done;
						assert.equal(result.code, 0, result.stderr);
						const runDir = join(root, "out", "runs", String(issue));
						for (const file of artifactNames)
							assert.ok(
								existsSync(join(runDir, file)),
								`Missing stage artifact: ${file}`,
							);
						const run = readJson(join(runDir, "run.json"));
						assert.equal(validateRun(run), true);
						assert.equal(run.target_revision, revision);
						assert.equal(run.verdict, "proof_verified");
						assert.equal((await checkCoreProof(runDir)).status, "ok");
						assert.ok(server.requests.length > 0);
						const spend = startChild(
							[
								"--import",
								fixture("stages", "loopback-only.mjs"),
								cli,
								"spend",
							],
							{ cwd: root, env },
						);
						assert.equal((await spend.done).code, 0);
						const money = ledger();
						const summary = readJson(join(root, "out", "spend-summary.json"));
						assert.equal(
							summary.total,
							money.baseline +
								money.settled +
								money.open.reduce((sum, item) => sum + item.upperBound, 0),
						);
						assert.equal(run.cost_micro_usd, money.settled);
						for (const stage of ["watch", "repro", "prove"])
							assert.ok(summary.per_stage[stage] > 0);
						assert.equal(
							Object.values(summary.per_stage).reduce(
								(sum, value) => sum + value,
								0,
							),
							money.settled +
								money.open.reduce((sum, item) => sum + item.upperBound, 0),
						);
						await withBrowser(async (browser) => {
							const view = await openStatic(
								browser,
								join(runDir, "replay.html"),
							);
							try {
								await checkSeven(view.page, run, runDir);
								checkLocalPage(view);
							} finally {
								await view.context.close();
							}
						});
						const broken = join(root, "incomplete");
						cpSync(runDir, broken, { recursive: true });
						rmSync(join(broken, "anchors.json"));
						assert.notEqual((await checkCoreProof(broken)).status, "ok");
					} finally {
						await child.stop();
					}
				},
			),
		),
	);
});

async function snapshot(page, runPath) {
	const run = readJson(runPath);
	await page.waitForFunction(
		({ count, amount }) => {
			const feed = document.querySelector('[data-testid="action-feed"]');
			const meter = document.querySelector('[data-testid="cost-meter"]');
			return (
				Number(feed?.dataset.eventCount) === count &&
				meter?.textContent.includes(amount)
			);
		},
		{
			count: run.replay.events.length,
			amount: `$${(run.cost_micro_usd / 1e6).toFixed(6)}`,
		},
		{ timeout: 30000 },
	);
	const feed = page.getByTestId("action-feed");
	const cost = page.getByTestId("cost-meter");
	assert.equal(
		Number(await feed.getAttribute("data-event-count")),
		run.replay.events.length,
	);
	assert.ok(
		(await cost.innerText()).includes(
			`$${(run.cost_micro_usd / 1e6).toFixed(6)}`,
		),
	);
	if (run.replay.events.length) {
		const last = run.replay.events.at(-1);
		assert.ok(
			(await feed.innerText()).includes(
				last.detail ?? last.action ?? last.type,
			),
		);
	}
	return {
		count: run.replay.events.length,
		cost: run.cost_micro_usd,
		text: await feed.innerText(),
	};
}

test("TC-R14-2", { timeout: 240000 }, async () => {
	const cli = entry("bin/foley.mjs");
	await temporary((root) =>
		withApps(root, ({ bug }) =>
			withEmber(
				root,
				[
					{ ...watchReply, hold: true },
					{ ...reproReply, hold: true },
					{ ...proveReply, hold: true },
				],
				async ({ server, env }) => {
					const { args } = await pipelineArgs(root, bug.origin, cli, true);
					const child = startChild(args, { cwd: root, env });
					try {
						const [, origin] = await child.waitForOutput(
							/LIVE_URL=(http:\/\/127\.0\.0\.1:\d+)/,
						);
						await server.waitForRequests(1);
						const runPath = join(
							root,
							"out",
							"runs",
							String(issue),
							"run.json",
						);
						const evidenceRoot = join(repo, "out", "live-evidence");
						mkdirSync(evidenceRoot, { recursive: true });
						const evidenceDir = mkdtempSync(join(evidenceRoot, "run-"));
						await withBrowser(async (browser) => {
							const context = await browser.newContext({
								serviceWorkers: "block",
							});
							try {
								await context.route("**/*", (route) =>
									new URL(route.request().url()).origin === origin ||
									/^(data|blob):/.test(route.request().url())
										? route.continue()
										: route.abort(),
								);
								const page = await context.newPage();
								await page.goto(origin);
								await page.getByTestId("action-feed").waitFor();
								const first = await snapshot(page, runPath);
								writeJson(join(evidenceDir, "first.json"), {
									run: readJson(runPath),
									dom: first,
								});
								const start = Date.now();
								server.release(0);
								await server.waitForRequests(2);
								server.release(1);
								await server.waitForRequests(3);
								// Poll a real DOM change; require readings at least 2 seconds apart.
								await page.waitForFunction(
									({ first, start }) => {
										const feed = document.querySelector(
											'[data-testid="action-feed"]',
										);
										const meter = document.querySelector(
											'[data-testid="cost-meter"]',
										);
										return (
											Date.now() - start >= 2000 &&
											Number(feed?.dataset.eventCount) > first.count &&
											!meter?.textContent.includes(
												`$${(first.cost / 1e6).toFixed(6)}`,
											)
										);
									},
									{ first, start },
									{ timeout: 30000 },
								);
								const second = await snapshot(page, runPath);
								writeJson(join(evidenceDir, "second.json"), {
									run: readJson(runPath),
									dom: second,
								});
								assert.ok(
									second.count > first.count && second.cost > first.cost,
								);
								assert.notEqual(second.text, first.text);
								await child.stop();
								await page
									.getByTestId("run-state")
									.filter({ hasText: "disconnected" })
									.waitFor({ timeout: 30000 });
								assert.equal(
									await page.getByTestId("action-feed").innerText(),
									second.text,
								);
								assert.ok(
									(await page.getByTestId("cost-meter").innerText()).includes(
										`$${(second.cost / 1e6).toFixed(6)}`,
									),
								);
							} finally {
								await context.close();
							}
						});
					} finally {
						await child.stop("SIGKILL");
					}
				},
			),
		),
	);
});

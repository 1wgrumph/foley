#!/usr/bin/env node
// Offline demonstration, not a test: one full `foley run` on the seeded-bug
// fixture app against the local fake model server, then `foley spend`, then the
// static replay page opened with every non-file request counted. Writes only
// under out/demo-offline/. No real model endpoint is contacted.
// Usage: FOLEY_OFFLINE=1 node tools/demo-offline.mjs
import { mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import {
	archive,
	fixture,
	modelReply,
	pinFixture,
	proofCode,
	repo,
	runCommand,
	startChild,
	withApps,
	withEmber,
	writeJson,
} from "../test/stages/support.mjs";
import { openStatic, withBrowser } from "../test/ui/support.mjs";

const root = resolve(repo, "out", "demo-offline");
rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });
const replies = [
	modelReply(archive),
	modelReply({ actions: archive.steps, done: true, verdict: "reproduced" }),
	modelReply({
		code: proofCode,
		filename: "regression.test.mjs",
		assertion: "archive-status",
	}),
];

// Two frames of the bug build: before and after Archive.
async function record(origin) {
	await withBrowser(async (browser) => {
		const context = await browser.newContext({
			viewport: { width: 640, height: 480 },
			serviceWorkers: "block",
		});
		await context.route("**/*", (route) =>
			new URL(route.request().url()).origin === origin
				? route.continue()
				: route.abort(),
		);
		const page = await context.newPage();
		await page.goto(origin);
		await page.screenshot({ path: join(root, "frame-0.png") });
		await page.getByRole("button", { name: "Archive" }).click();
		await page
			.getByRole("status")
			.filter({ hasText: "Not archived" })
			.waitFor();
		await page.screenshot({ path: join(root, "frame-1.png") });
		await context.close();
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

const cli = join(repo, "bin", "foley.mjs");
const guard = ["--import", fixture("stages", "loopback-only.mjs")];
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: one linear demonstration script
await withApps(root, ({ bug }) =>
	withEmber(root, replies, async ({ env }) => {
		const { target, revision } = pinFixture(root);
		const fixed = pinFixture(root, "app-fixed");
		const probe = join(root, "probe.json");
		writeJson(probe, {
			video: { accepted: false },
			audio: { accepted: false },
		});
		const args = [
			"run",
			"1",
			"--issue-url",
			"https://example.invalid/issues/1",
			"--fixture",
			"--recording",
			await record(bug.origin),
			"--target",
			target,
			"--revision",
			revision,
			"--fixed-target",
			fixed.target,
			"--app-origin",
			bug.origin,
			"--runner",
			"node-test",
			"--case-budget",
			"100000",
			"--probe",
			probe,
		];
		console.log(
			`$ (cd out/demo-offline && node bin/foley.mjs ${args.join(" ")})`,
		);
		const run = await startChild([...guard, cli, ...args], { cwd: root, env })
			.done;
		process.stdout.write(run.stdout + run.stderr);
		const spend = await startChild([...guard, cli, "spend"], { cwd: root, env })
			.done;
		process.stdout.write(spend.stdout + spend.stderr);
		const page = join(root, "out", "runs", "1", "replay.html");
		await withBrowser(async (browser) => {
			const view = await openStatic(browser, page);
			const outside = view.requests.filter(
				(url) => url !== view.url && !/^(data|blob):/.test(url),
			);
			console.log(
				`replay.html: ${outside.length} requests besides the page file; ${view.errors.length} console errors`,
			);
			await view.context.close();
		});
		console.log(`run exit ${run.code}; spend exit ${spend.code}`);
		process.exitCode = run.code || spend.code;
	}),
);

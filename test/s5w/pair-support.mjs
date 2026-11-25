// The synthetic pair uses the existing owned archive app, with a distinct
// build directory on each side. No index.html exists at either checkout root.
import assert from "node:assert/strict";
import { cpSync, mkdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { serveApp } from "../../fixtures/stages/app-server.mjs";
import {
	archive,
	entry,
	fixture,
	localEnv,
	modelReply,
	proofCode,
	runCommand,
	sha256,
	startChild,
	temporary,
	withEmber,
	writeJson,
} from "../stages/support.mjs";
import { withBrowser } from "../ui/support.mjs";

const gitEnv = localEnv({
	GIT_CONFIG_NOSYSTEM: "1",
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_AUTHOR_NAME: "Fixture",
	GIT_AUTHOR_EMAIL: "fixture@example.invalid",
	GIT_COMMITTER_NAME: "Fixture",
	GIT_COMMITTER_EMAIL: "fixture@example.invalid",
});

export const issue = 73;
export const issueUrl = "https://example.invalid/issues/73";
const watch = modelReply(archive);
const reproduction = modelReply({
	actions: archive.steps,
	done: true,
	verdict: "reproduced",
});
const proof = modelReply({
	code: proofCode,
	filename: "regression.test.mjs",
	assertion: "archive-status",
});
export const replies = [watch, reproduction, proof];

export function pin(dir, variant) {
	mkdirSync(dir, { recursive: true });
	for (const file of ["logic.mjs", "package.json"])
		cpSync(fixture(variant, file), join(dir, file));
	const git = (...args) =>
		runCommand("git", ["-C", dir, ...args], { env: gitEnv }).trim();
	git("init", "-q");
	git("add", ".");
	git("commit", "-qm", "Pin owned archive source");
	const page = join(dir, "built");
	cpSync(fixture(variant), page, { recursive: true });
	return { dir, page, commit: git("rev-parse", "HEAD") };
}

// Capture the actual seed bug using an independent browser, not Foley.
async function capture(root, origin) {
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
			await page.locator("#archive").waitFor();
			await page.screenshot({ path: join(root, "frame-0.png") });
			await page.locator("#archive").click();
			await page
				.getByRole("status")
				.filter({ hasText: "Not archived" })
				.waitFor();
			await page.screenshot({ path: join(root, "frame-1.png") });
		} finally {
			await context.close();
		}
	});
	const recording = join(root, "recording.mp4");
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

export function cli(root, env, args, timeoutMs = 240000) {
	return startChild(
		[
			"--import",
			fixture("stages", "loopback-only.mjs"),
			entry("bin/foley.mjs"),
			...args,
		],
		{ cwd: root, env, timeoutMs },
	).done;
}

export function assertExit(result, code, refusal) {
	assert.equal(result.signal, null, "CLI was killed");
	assert.equal(
		result.code,
		code,
		`Expected exit ${code}: ${result.stdout} ${result.stderr}`,
	);
	if (refusal) assert.match(result.stderr, new RegExp(`refused: ${refusal}:`));
}

export function pairArgs(recording, number = issue, synthetic = true) {
	return [
		"run",
		"--pair",
		String(number),
		"--recording",
		recording,
		"--case-budget",
		"100000",
		...(synthetic ? ["--fixture"] : []),
	];
}

export async function syntheticPair(script, run, captureBug = true) {
	await temporary(async (root) => {
		const pairDir = join(root, "out", "pairs", String(issue));
		const bug = pin(join(pairDir, "bug"), "app");
		const fixed = pin(join(pairDir, "fixed"), "app-fixed");
		const app = await serveApp(bug.page);
		try {
			const recording = captureBug
				? await capture(root, app.origin)
				: join(root, "recording.mp4");
			if (!captureBug)
				cpSync(fixture("recordings", "owned-basic-flow.mp4"), recording);
			const digest = sha256(readFileSync(recording));
			const binding = {
				issue,
				bug_commit: bug.commit,
				fix_commit: fixed.commit,
			};
			const pair = {
				...binding,
				url: issueUrl,
				runner: "node-test",
				recording: { sha256: digest, media_type: "video/mp4" },
			};
			const manifest = join(root, "fixtures", "pairs", "pairs.json");
			mkdirSync(join(root, "fixtures", "pairs"), { recursive: true });
			writeJson(manifest, {
				schema: "foley.pairs/1",
				repository: "synthetic/archive-demo",
				pairs: [pair],
			});
			const receiptPath = join(pairDir, "receipt.json");
			const receipt = {
				issue,
				scan_verdict: "PASS",
				builds: [
					["bug", bug],
					["fixed", fixed],
				].map(([side, build]) => ({
					side,
					commit: build.commit,
					page: relative(root, build.page),
				})),
			};
			writeJson(receiptPath, receipt);
			const probe = join(root, "probe.json");
			writeJson(probe, {
				video: { accepted: false },
				audio: { accepted: false },
			});
			const args = [...pairArgs(recording), "--probe", probe];
			const mediaDir = join(root, "media");
			mkdirSync(mediaDir);
			cpSync(recording, join(mediaDir, `${digest}.mp4`));
			const censusPath = join(root, "census.json");
			writeJson(censusPath, {
				schema: "foley.census/1",
				generated_on: "2026-11-25",
				repository: "synthetic/archive-demo",
				target_revision: bug.commit,
				candidates: [
					{
						issue,
						url: issueUrl,
						status: "eligible_not_attempted",
						media: [{ sha256: digest, media_type: "video/mp4" }],
					},
				],
			});
			const censusArgs = [
				"backlog",
				censusPath,
				"--fixture",
				"--target",
				bug.dir,
				"--fixed-target",
				fixed.dir,
				"--runner",
				"node-test",
				"--app-origin",
				app.origin,
				"--media-dir",
				mediaDir,
				"--case-budget",
				"100000",
				"--probe",
				probe,
			];
			await withEmber(root, script, async ({ env, server }) => {
				await run({
					root,
					bug,
					fixed,
					binding,
					args,
					censusArgs,
					server,
					receipt,
					receiptPath,
					pair,
					manifest,
					runDir: join(root, "out", "runs", String(issue)),
					exec: (args) => cli(root, env, args),
				});
			});
		} finally {
			await app.close();
		}
	});
}

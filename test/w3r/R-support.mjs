// Resource group: unique temporary directory, ephemeral loopback servers/browser.
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	archive,
	entry,
	fixture,
	modelReply,
	pinFixture,
	proofCode,
	readJson,
	runCommand,
	sha256,
	startChild,
	temporary,
	withApps,
	withEmber,
	writeJson,
} from "../stages/support.mjs";
import { withBrowser } from "../ui/support.mjs";

export const watchReply = modelReply(archive);
export const reproReply = modelReply({
	actions: archive.steps,
	done: true,
	verdict: "reproduced",
});
export const proveReply = modelReply({
	code: proofCode,
	filename: "regression.test.mjs",
	assertion: "archive-status",
});
export const miss = {
	mode: "invalid_output",
	usage: { prompt_tokens: 10, completion_tokens: 20 },
};
const issueUrl = "https://example.invalid/issues/1";
export const eligible = "eligible_not_attempted";
export const rowsBefore = [
	{ issue: 1, status: eligible },
	{ issue: 2, status: "no_usable_media" },
];
export const rowsAfter = [
	{ issue: 1, status: "attempted_miss" },
	rowsBefore[1],
];

// Real capture from the owned archive bug fixture, as in TC-INT-1.
async function recording(root, origin) {
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
	const path = join(root, "recording.mp4");
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
		path,
	]);
	return path;
}

function censusFile(root, revision, media, rows = rowsBefore) {
	const path = join(root, "census.json");
	writeJson(path, {
		schema: "foley.census/1",
		generated_on: "2026-11-24",
		repository: "synthetic/archive-demo",
		target_revision: revision,
		candidates: rows.map(({ issue, status }) => ({
			issue,
			status,
			url: `https://example.invalid/issues/${issue}`,
			media: issue === 1 ? [{ media_type: "video/mp4", sha256: media }] : [],
		})),
	});
	return path;
}

export async function scenario(script, run) {
	await temporary((root) =>
		withApps(root, ({ bug }) =>
			withEmber(root, script, async ({ env, server, ledger, trace }) => {
				const { target, revision } = pinFixture(root);
				const fixed = pinFixture(root, "app-fixed");
				const clip = await recording(root, bug.origin);
				const probe = join(root, "probe.json");
				writeJson(probe, {
					video: { accepted: false },
					audio: { accepted: false },
				});
				const mediaDir = join(root, "media");
				mkdirSync(mediaDir);
				const digest = sha256(readFileSync(clip));
				copyFileSync(clip, join(mediaDir, `${digest}.mp4`));
				const census = censusFile(root, revision, digest);
				const out = join(root, "out");
				const runDir = join(out, "runs", "1");
				const common = [
					"--target",
					target,
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
				const runArgs = [
					"run",
					"1",
					"--issue-url",
					issueUrl,
					"--fixture",
					"--recording",
					clip,
					"--revision",
					revision,
					...common,
				];
				const backlogArgs = [
					"backlog",
					census,
					"--fixture",
					"--media-dir",
					mediaDir,
					...common,
				];
				const children = [];
				const start = (args, extra = {}) => {
					const child = startChild(
						[
							"--import",
							fixture("stages", "loopback-only.mjs"),
							"--import",
							fileURLToPath(new URL("./R-barrier.mjs", import.meta.url)),
							entry("bin/foley.mjs"),
							...args,
						],
						{ cwd: root, env: { ...env, ...extra } },
					);
					children.push(child);
					return child;
				};
				try {
					await run({
						root,
						target,
						revision,
						clip,
						census,
						mediaDir,
						out,
						runDir,
						runArgs,
						backlogArgs,
						server,
						ledger,
						trace,
						start,
						readRun: () => readJson(join(runDir, "run.json")),
						readReport: () => readJson(join(out, "backlog-report.json")),
					});
				} finally {
					await Promise.all(children.map((child) => child.stop("SIGKILL")));
				}
			}),
		),
	);
}

export function option(args, name, value) {
	const changed = [...args];
	const index = changed.indexOf(name);
	assert.ok(index >= 0, `Missing option: ${name}`);
	if (value === undefined) changed.splice(index, 1);
	else changed[index + 1] = value;
	return changed;
}

export async function killAtRequest(ctx, args, count) {
	const child = ctx.start(args);
	await ctx.server.waitForRequests(count, 60000);
	assert.equal((await child.stop("SIGKILL")).signal, "SIGKILL");
}

export async function killAtCut(ctx, args, cut) {
	const child = ctx.start(args, { FOLEY_TEST_CUT: cut });
	await child.waitForOutput(/W3R-CUT/);
	assert.equal((await child.stop("SIGKILL")).signal, "SIGKILL");
}

export function assertExit(result, code, pattern) {
	assert.equal(result.signal, null, "CLI was killed instead of returning");
	assert.equal(
		result.code,
		code,
		`Expected exit ${code}; stdout: ${result.stdout}; stderr: ${result.stderr}`,
	);
	if (pattern) assert.match(result.stderr, pattern);
}

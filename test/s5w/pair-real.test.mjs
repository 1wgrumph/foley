// Resource group: dedicated copied build trees, isolated runner, ephemeral
// servers and browsers. Opt-in: the prepared dependencies are substantial.
import assert from "node:assert/strict";
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import {
	fixture,
	modelReply,
	product,
	readJson,
	runCommand,
	sha256,
	withEmber,
	writeJson,
} from "../stages/support.mjs";
import { assertExit, cli, pairArgs } from "./pair-support.mjs";

const pairsDir = process.env.FOLEY_PAIRS_DIR;
const issue = 9852;

// Copy the local build without changing the source or its worktree index.
// The copied linked-worktree metadata shares only the existing Git object store.
function copyBuild(source, destination, commit) {
	const git = (tree, ...args) =>
		runCommand("git", ["-C", tree, ...args]).trim();
	assert.equal(git(source, "rev-parse", "HEAD"), commit);
	assert.equal(
		git(source, "status", "--porcelain", "--untracked-files=no"),
		"",
	);
	assert.ok(
		readFileSync(join(source, "excalidraw-app/build/index.html")).length > 0,
	);
	runCommand("cp", ["-a", "--reflink=auto", source, destination], {
		timeout: 180000,
	});
	const gitDir = git(source, "rev-parse", "--absolute-git-dir");
	const common = git(
		source,
		"rev-parse",
		"--path-format=absolute",
		"--git-common-dir",
	);
	const metadata = join(destination, ".git");
	rmSync(metadata, { recursive: true });
	cpSync(gitDir, metadata, { recursive: true });
	writeFileSync(join(metadata, "commondir"), common);
	writeFileSync(join(metadata, "gitdir"), metadata);
	assert.equal(git(destination, "rev-parse", "HEAD"), commit);
	assert.equal(
		git(destination, "status", "--porcelain", "--untracked-files=no"),
		"",
	);
}

test("TC-R15-4/pair-real-9852", {
	skip: !pairsDir,
	timeout: 480000,
}, async () => {
	const source = resolve(pairsDir);
	const pair = readJson(fixture("pairs", "pairs.json")).pairs.find(
		(p) => p.issue === issue,
	);
	const receipt = readJson(join(source, String(issue), "receipt.json"));
	const recordingSource = join(source, "media", `${issue}.bin`);
	assert.equal(receipt.scan_verdict, "PASS");
	assert.equal(sha256(readFileSync(recordingSource)), pair.recording.sha256);
	// Existing real-pair scenario, using the viewport coordinates that its
	// independent Playwright check uses: click (400, 300), move (520, 380).
	const actions = [
		pair.steps[0],
		pair.steps[1],
		{ action: "pointer_click", target: "canvas", x: 400, y: 300 },
		{ action: "pointer_move", target: "canvas", x: 520, y: 380 },
		pair.steps[3],
		pair.steps[4],
	];
	const steps = actions.map((step, i) => ({
		...step,
		order: i + 1,
		t_s: i,
		...(step.action === "wait" && { value: String(step.value) }),
	}));
	const script = [
		modelReply({ schema: "foley.steps/1", steps, predicate: pair.predicate }),
		modelReply({ actions, done: true, verdict: "reproduced" }),
		modelReply({
			code: readFileSync(
				fixture("pairs", "tests", String(issue), "regression.test.mjs"),
				"utf8",
			),
			filename: "regression.test.mjs",
			assertion: "regression",
		}),
	];
	// Same filesystem for reflink copies; the sibling root belongs only to this test.
	const root = mkdtempSync(join(dirname(source), "s5w-real-"));
	try {
		const dest = join(root, "out", "pairs", String(issue));
		mkdirSync(dest, { recursive: true });
		for (const [side, commit] of [
			["bug", pair.bug_commit],
			["fixed", pair.fix_commit],
		]) {
			assert.equal(receipt.builds.find((b) => b.side === side).commit, commit);
			copyBuild(join(source, String(issue), side), join(dest, side), commit);
		}
		writeJson(join(dest, "receipt.json"), receipt);
		mkdirSync(join(root, "fixtures", "pairs"), { recursive: true });
		cpSync(
			fixture("pairs", "pairs.json"),
			join(root, "fixtures", "pairs", "pairs.json"),
		);
		const recording = join(root, "recording.mp4");
		cpSync(recordingSource, recording);
		await withEmber(root, script, async ({ env, server }) => {
			const result = await cli(
				root,
				env,
				pairArgs(recording, issue, false),
				360000,
			);
			assertExit(result, 0);
			assert.match(result.stdout, /proof_verified/);
			const runDir = join(root, "out", "runs", String(issue));
			const core = readJson(join(runDir, "core-proof.json"));
			assert.equal(core.fixture, false);
			assert.deepEqual(core.pair, {
				issue,
				bug_commit: pair.bug_commit,
				fix_commit: pair.fix_commit,
			});
			assert.equal(core.rerun_without_ember.bug.exitCode, 1);
			assert.equal(core.rerun_without_ember.fixed.exitCode, 0);
			assert.equal(server.requests.length, 3);
			const checkCoreProof = await product(
				"src/run-schema.mjs",
				"checkCoreProof",
			);
			assert.equal((await checkCoreProof(runDir)).status, "ok");
		});
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

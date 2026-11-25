import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { test } from "node:test";
import {
	archive,
	fixture,
	pinFixture,
	product,
	readJson,
	runCommand,
	temporary,
	writeJson,
} from "../support.mjs";

function checkAnchors(result, target, revision) {
	assert.equal(result.schema, "foley.anchors/1");
	assert.equal(result.status, "ok");
	assert.ok(
		result.anchors.slice(0, 5).some((anchor) => anchor.file === "logic.mjs"),
	);
	for (const anchor of result.anchors) {
		assert.ok(
			!isAbsolute(anchor.file) && !anchor.file.split("/").includes(".."),
		);
		const source = runCommand("git", [
			"-C",
			target,
			"show",
			`${revision}:${anchor.file}`,
		]);
		const lines = source.split("\n");
		assert.ok(
			Number.isInteger(anchor.line) &&
				anchor.line >= 1 &&
				anchor.line <= lines.length,
		);
		assert.equal(typeof anchor.term, "string");
		assert.ok(anchor.term.length > 0);
	}
}

test("TC-R05-1", { timeout: 120000 }, async () => {
	const locate = await product("src/locate.mjs", "locate");
	await temporary(async (root) => {
		const { target, revision } = pinFixture(root);
		const input = join(root, "steps.json");
		const runDir = join(root, "run");
		mkdirSync(runDir);
		writeJson(input, archive);
		const options = { targetDir: target, targetRevision: revision, runDir };
		const first = await locate(input, options);
		checkAnchors(first, target, revision);
		const bytes = readFileSync(join(runDir, "anchors.json"));
		assert.deepEqual(await locate(input, options), first);
		assert.deepEqual(readFileSync(join(runDir, "anchors.json")), bytes);
		assert.deepEqual(readJson(join(runDir, "anchors.json")), first);
		for (const steps of [
			[],
			[
				{
					order: 1,
					t_s: 0,
					action: "click",
					target: "synthetic-unmatched-qjwxv",
				},
			],
		]) {
			writeJson(input, { ...archive, steps, predicate: null });
			const miss = await locate(input, options);
			assert.equal(miss.status, "miss");
			assert.deepEqual(miss.anchors, []);
		}
	});
});

test("TC-R05-2", { timeout: 120000 }, async () => {
	await product("src/locate.mjs", "locate");
	await temporary((root) => {
		const { target, revision } = pinFixture(root);
		const runDir = join(root, "run");
		mkdirSync(runDir);
		const netLog = join(root, "network.log");
		const result = JSON.parse(
			runCommand("unshare", [
				"-Urn",
				"--",
				"strace",
				"-f",
				"-qq",
				"-e",
				"trace=network",
				"-o",
				netLog,
				process.execPath,
				fixture("stages", "locate-worker.mjs"),
				fixture("stages", "archive-steps.json"),
				target,
				revision,
				runDir,
			]),
		);
		checkAnchors(result, target, revision);
		assert.doesNotMatch(
			readFileSync(netLog, "utf8"),
			/socket\(AF_INET6?\b/,
			"Locate opened an Internet socket",
		);
	});
});

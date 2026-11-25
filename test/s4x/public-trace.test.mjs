// Resource group: unique temporary directory; no network, browser or model.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
	entry,
	fixture,
	localEnv,
	temporary,
	writeJson,
} from "../stages/support.mjs";

const check = (...args) =>
	spawnSync(process.execPath, [entry("tools/check-public.mjs"), ...args], {
		encoding: "utf8",
		env: localEnv(),
		timeout: 60000,
	});

// W4-04: a published JSON trace gets the home-path, key and media checks on its
// decoded strings, so an escaped path or an inline image cannot pass.
test("TC-R11-1/trace-json", { timeout: 120000 }, async () => {
	const seeded = check("--tree", fixture("public-negative", "trace-json"));
	assert.equal(seeded.status, 1, seeded.stdout);
	assert.match(seeded.stdout, /FAIL trace-json \S+ home-directory path/);
	assert.match(seeded.stdout, /FAIL trace-json \S+ inline media/);
	const self = check("--self-test", fixture("public-negative"));
	assert.equal(self.status, 0, self.stdout);
	assert.match(self.stdout, /trace-json -> caught/);
	// Control: prompts as text, with media as digests, pass.
	await temporary(async (root) => {
		mkdirSync(join(root, "trace", "1"), { recursive: true });
		writeJson(join(root, "trace", "1", "calls.json"), [
			{
				n: 1,
				stage: "watch",
				request: {
					messages: [
						{ role: "system", content: "Reply with one JSON object." },
						{
							role: "user",
							content: [{ type: "image_url", image_url: { url: "sha256:00" } }],
						},
					],
				},
			},
		]);
		writeFileSync(join(root, "README.md"), "Clean control file.\n");
		const clean = check("--tree", root);
		assert.equal(clean.status, 0, clean.stdout);
	});
});

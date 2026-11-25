import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
	archive,
	localEnv,
	modelReply,
	product,
	temporary,
	withApps,
	withEmber,
} from "../support.mjs";

test("TC-R06-4", { timeout: 120000 }, async () => {
	const checkPredicate = await product("src/predicate.mjs", "checkPredicate");
	const repro = await product("src/repro.mjs", "repro");
	const { chromium } = await import("playwright");
	await temporary((root) =>
		withApps(root, async ({ bug, fixed }) => {
			const browser = await chromium.launch({
				args: ["--disable-background-networking"],
				env: localEnv(),
			});
			try {
				for (const [app, expected] of [
					[fixed, false],
					[bug, true],
				]) {
					const context = await browser.newContext({ serviceWorkers: "block" });
					try {
						await context.route("**/*", (route) =>
							new URL(route.request().url()).origin === app.origin
								? route.continue()
								: route.abort(),
						);
						const page = await context.newPage();
						await page.goto(app.origin);
						await page.getByRole("button", { name: "Archive" }).click();
						assert.equal(
							await checkPredicate(page, archive.predicate),
							expected,
						);
					} finally {
						await context.close();
					}
				}
			} finally {
				await browser.close();
			}
			const reply = modelReply({
				actions: archive.steps,
				done: true,
				verdict: "reproduced",
			});
			await withEmber(
				root,
				[reply, reply, reply, reply],
				async ({ callEmber }) => {
					for (const [app, expected, name] of [
						[fixed, false, "fixed"],
						[bug, true, "bug"],
					]) {
						const runDir = join(root, name);
						mkdirSync(runDir);
						const result = await repro(
							archive.steps,
							archive.predicate,
							app.origin,
							{ runDir, callEmber, caseId: name, caseBudget: 100000 },
						);
						assert.equal(
							result.status,
							expected ? "reproduced" : "not_reproduced",
						);
						assert.equal(result.observed, expected);
					}
				},
			);
		}),
	);
});

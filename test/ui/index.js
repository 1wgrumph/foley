import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { test } from "node:test";
import { product, repo, temporary, writeJson } from "../stages/support.mjs";
import {
	checkKeyboard,
	checkLocalPage,
	checkSeven,
	fixtureRun,
	openStatic,
	pixel,
	screenshotBytes,
	withBrowser,
} from "./support.mjs";

const pagePath = (dir) => join(dir, "replay.html");
function localRequest(origin, path, method = "GET") {
	const url = new URL(origin);
	assert.equal(url.hostname, "127.0.0.1");
	return new Promise((resolve, reject) => {
		const req = request(
			{
				hostname: url.hostname,
				port: url.port,
				path,
				method,
				signal: AbortSignal.timeout(15000),
			},
			(res) => {
				const chunks = [];
				res.on("data", (chunk) => chunks.push(chunk));
				res.on("end", () =>
					resolve({ status: res.statusCode, body: Buffer.concat(chunks) }),
				);
				res.on("error", reject);
			},
		);
		req.on("error", reject);
		req.end();
	});
}

test("TC-R14-1", { timeout: 120000 }, async () => {
	const renderReplay = await product("ui/render.mjs", "renderReplay");
	await temporary(async (runDir) => {
		const run = fixtureRun(runDir);
		await renderReplay(runDir);
		await withBrowser(async (browser) => {
			const view = await openStatic(browser, pagePath(runDir));
			try {
				await checkSeven(view.page, run, runDir);
				checkLocalPage(view);
			} finally {
				await view.context.close();
			}
		});
	});
});

test("TC-R14-3", { timeout: 120000 }, async () => {
	const renderReplay = await product("ui/render.mjs", "renderReplay");
	const startLive = await product("src/live.mjs", "startLive");
	await temporary(async (root) => {
		const runDir = join(root, "run");
		const outside = join(root, "outside.txt");
		const sentinel = "synthetic outside sentinel";
		writeFileSync(outside, sentinel);
		const markup = "<script>synthetic fixture text</script>";
		const imageMarkup = '<img onerror="synthetic fixture text">';
		const run = fixtureRun(runDir);
		run.steps[0] = { ...run.steps[0], target: markup };
		run.anchors[0] = { ...run.anchors[0], file: imageMarkup };
		writeJson(join(runDir, "run.json"), run);
		await renderReplay(runDir);
		await withBrowser(async (browser) => {
			const view = await openStatic(browser, pagePath(runDir));
			try {
				assert.ok(
					(await view.page.getByTestId("steps").innerText()).includes(markup),
				);
				assert.ok(
					(await view.page.getByTestId("location").innerText()).includes(
						imageMarkup,
					),
				);
				assert.equal(await view.page.locator("img[onerror]").count(), 0);
				checkLocalPage(view);
			} finally {
				await view.context.close();
			}
		});
		const live = await startLive(runDir);
		try {
			for (const path of [
				"/../outside.txt",
				`/${encodeURIComponent(outside)}`,
			]) {
				const response = await localRequest(live.origin, path);
				assert.ok([403, 404].includes(response.status));
				assert.ok(!response.body.toString().includes(sentinel));
			}
			const response = await localRequest(
				live.origin,
				"/screenshots/step-1.png",
			);
			assert.equal(response.status, 200);
			assert.deepEqual(response.body, screenshotBytes(runDir));
			await withBrowser(async (browser) => {
				const context = await browser.newContext({ serviceWorkers: "block" });
				try {
					const unexpected = [];
					await context.route("**/*", (route) => {
						if (
							new URL(route.request().url()).origin === live.origin ||
							/^(data|blob):/.test(route.request().url())
						)
							return route.continue();
						unexpected.push(route.request().url());
						return route.abort();
					});
					const page = await context.newPage();
					await page.goto(live.origin);
					await page.waitForFunction(
						(text) =>
							document
								.querySelector('[data-testid="steps"]')
								?.textContent.includes(text),
						markup,
						{ timeout: 30000 },
					);
					assert.ok(
						(await page.getByTestId("location").innerText()).includes(
							imageMarkup,
						),
					);
					assert.equal(await page.locator("img[onerror]").count(), 0);
					assert.deepEqual(unexpected, []);
				} finally {
					await context.close();
				}
			});
		} finally {
			await live.close();
		}
	});
});

test("TC-R14-4", { timeout: 240000 }, async () => {
	const renderReplay = await product("ui/render.mjs", "renderReplay");
	const { default: AxeBuilder } = await import("@axe-core/playwright");
	await temporary((root) =>
		withBrowser(async (browser) => {
			const evidenceRoot = join(repo, "out", "ui-evidence");
			mkdirSync(evidenceRoot, { recursive: true });
			const evidenceDir = mkdtempSync(join(evidenceRoot, "run-"));
			for (const state of [
				"empty",
				"running",
				"error",
				"disconnected",
				"finished",
			]) {
				const runDir = join(root, state);
				fixtureRun(runDir, state);
				await renderReplay(runDir);
				for (const viewport of [
					{ width: 1280, height: 800 },
					{ width: 390, height: 844 },
				]) {
					const view = await openStatic(browser, pagePath(runDir), viewport);
					try {
						assert.equal(
							await view.page.getByTestId("run-state").innerText(),
							state,
						);
						assert.equal(
							await view.page.evaluate(
								() => document.documentElement.scrollWidth <= innerWidth,
							),
							true,
						);
						const axe = await new AxeBuilder({ page: view.page }).analyze();
						const prefix = join(
							evidenceDir,
							`${state}-${viewport.width}x${viewport.height}`,
						);
						writeJson(`${prefix}.axe.json`, axe);
						const screenshot = await view.page.screenshot({
							path: `${prefix}.png`,
						});
						assert.equal(screenshot.readUInt32BE(16), viewport.width);
						assert.equal(screenshot.readUInt32BE(20), viewport.height);
						assert.deepEqual(
							axe.violations
								.filter(
									(v) =>
										["serious", "critical"].includes(v.impact) ||
										v.id === "color-contrast",
								)
								.map((v) => v.id),
							[],
						);
						const contrastRule = axe.passes.find(
							(rule) => rule.id === "color-contrast",
						);
						const ratios = (contrastRule?.nodes ?? [])
							.flatMap((node) =>
								[...node.any, ...node.all, ...node.none].map(
									(check) => check.data?.contrastRatio,
								),
							)
							.filter(Number.isFinite);
						assert.ok(
							ratios.length > 0 && ratios.every((ratio) => ratio >= 4.5),
							"Text contrast must be at least 4.5:1",
						);
						assert.ok(
							!axe.incomplete.some((rule) => rule.id === "color-contrast"),
							"Unresolved text contrast",
						);
						await checkKeyboard(view.page);
						checkLocalPage(view);
					} finally {
						await view.context.close();
					}
				}
			}
			assert.equal(
				readdirSync(evidenceDir).filter((name) => name.endsWith(".png")).length,
				10,
			);
			// A real axe negative control, independent of the replay renderer.
			const seedContext = await browser.newContext({ serviceWorkers: "block" });
			const page = await seedContext.newPage();
			try {
				await page.setContent(
					`<!doctype html><html lang="en"><title>Fixture</title><img src="data:image/png;base64,${pixel}"></html>`,
				);
				const axe = await new AxeBuilder({ page }).analyze();
				assert.ok(
					axe.violations.some(
						(v) =>
							v.id === "image-alt" &&
							["serious", "critical"].includes(v.impact),
					),
				);
			} finally {
				await seedContext.close();
			}
		}),
	);
});

test("TC-R14-5", { timeout: 120000 }, async () => {
	const startLive = await product("src/live.mjs", "startLive");
	await temporary(async (runDir) => {
		fixtureRun(runDir);
		const live = await startLive(runDir);
		try {
			assert.equal(live.address.address, "127.0.0.1");
			assert.equal(new URL(live.origin).hostname, "127.0.0.1");
			assert.ok(live.address.port > 0);
			const file = join(runDir, "run.json");
			const before = createHash("sha256")
				.update(readFileSync(file))
				.digest("hex");
			assert.equal((await localRequest(live.origin, "/run.json")).status, 200);
			for (const method of ["PUT", "POST"]) {
				assert.ok(
					[403, 405].includes(
						(await localRequest(live.origin, "/run.json", method)).status,
					),
				);
			}
			assert.equal(
				createHash("sha256").update(readFileSync(file)).digest("hex"),
				before,
			);
		} finally {
			await live.close();
		}
		await assert.rejects(
			() => startLive(runDir, { host: "0.0.0.0" }),
			/loopback|host/i,
		);
	});
});

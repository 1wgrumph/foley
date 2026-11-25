// Resource group: unique temporary directory, ephemeral local browser.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import AxeBuilder from "@axe-core/playwright";
import {
	product,
	readJson,
	repo,
	temporary,
	writeJson,
} from "../stages/support.mjs";
import {
	checkLocalPage,
	fixtureRun,
	openStatic,
	withBrowser,
} from "../ui/support.mjs";

const viewports = [
	{ width: 1280, height: 800 },
	{ width: 390, height: 844 },
];

async function eachViewport(pagePath, check) {
	await withBrowser(async (browser) => {
		for (const viewport of viewports) {
			const view = await openStatic(browser, pagePath, viewport);
			try {
				await check(view.page, viewport);
				checkLocalPage(view);
			} finally {
				await view.context.close();
			}
		}
	});
}

// W4-13: the census index has a language, one main landmark, no content
// outside landmarks and no sideways overflow on a phone.
test("TC-R14-4/census-page", { timeout: 240000 }, async () => {
	const censusPage = await product("ui/census.mjs", "censusPage");
	const rows = readJson(join(repo, "docs", "evidence", "census-rows.json"));
	const linked = rows[0].issue;
	await temporary(async (root) => {
		const pagePath = join(root, "index.html");
		writeFileSync(
			pagePath,
			censusPage(rows, {
				heading: "Foley census backlog",
				replayHref: (issue) =>
					issue === linked ? `../runs/${issue}/replay.html` : null,
			}),
		);
		await eachViewport(pagePath, async (page, viewport) => {
			const size = `${viewport.width}x${viewport.height}`;
			assert.equal(await page.getByTestId("census-row").count(), rows.length);
			assert.equal(await page.locator("a[href]").count(), 1);
			assert.equal(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= innerWidth,
				),
				true,
				`Sideways overflow at ${size}`,
			);
			const axe = await new AxeBuilder({ page }).analyze();
			assert.deepEqual(
				axe.violations.map((v) => v.id),
				[],
				`axe findings at ${size}`,
			);
			// Every status is visible text, not only a colour or a title.
			// biome-ignore lint/performance/useDomNodeTextContent: Assert rendered text, not hidden DOM text.
			const text = (await page.locator("main").innerText()).toLowerCase();
			for (const row of rows)
				assert.ok(text.includes(row.status.replaceAll("_", " ")), row.status);
		});
	});
});

async function rendered(patch, replay, check) {
	const renderReplay = await product("ui/render.mjs", "renderReplay");
	await temporary(async (root) => {
		const runDir = join(root, "1");
		mkdirSync(runDir, { recursive: true });
		const run = fixtureRun(runDir, "finished", patch);
		if (replay)
			writeJson(join(runDir, "replay.json"), { ...run.replay, ...replay });
		await renderReplay(runDir);
		await eachViewport(join(runDir, "replay.html"), check);
	});
}

// W4-02: a reproduction the fixed build also shows is displayed as a conflict.
test("TC-R14-1/fixed-build-conflict", { timeout: 240000 }, async () => {
	await rendered(
		{ verdict: "attempted_miss", test: null },
		{
			status: "fixed_build_conflict",
			observed: true,
			fixed_build_shows_failure: true,
		},
		async (page) => {
			assert.match(
				// biome-ignore lint/performance/useDomNodeTextContent: Assert rendered text, not hidden DOM text.
				await page.getByTestId("verdict").innerText(),
				/conflicting evidence/i,
			);
			// biome-ignore lint/performance/useDomNodeTextContent: Assert rendered text, not hidden DOM text.
			assert.match(await page.locator("#summary").innerText(), /fixed build/i);
		},
	);
});

// W4-07: the page names the cost of this run and, apart from it, what the
// issue's case has spent over every run against its cap.
test("TC-R14-1/run-and-case-cost", { timeout: 240000 }, async () => {
	await rendered(
		{
			cost_micro_usd: 152,
			case_cost_micro_usd: 900,
			case_budget_micro_usd: 1000,
		},
		null,
		async (page) => {
			// biome-ignore lint/performance/useDomNodeTextContent: Assert rendered text, not hidden DOM text.
			const meter = await page.getByTestId("cost-meter").innerText();
			assert.match(meter, /this run[^$]*\$0\.000152/i);
			assert.match(meter, /all runs of this issue[^$]*\$0\.000900/i);
			assert.equal(
				await page.locator("#cost meter").evaluate((gauge) => gauge.value),
				900,
			);
		},
	);
});

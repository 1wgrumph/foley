import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { product, temporary, writeJson } from "../stages/support.mjs";
import {
	checkLocalPage,
	fixtureRun,
	openStatic,
	withBrowser,
} from "../ui/support.mjs";

const markup = '<span data-model-fixture="observation">Archive ready</span>';
const explanations = [
	{ observation: markup, reason: "Inspect the Archive button." },
	{},
	{ observation: "Archive still visible." },
	{ reason: "Click Archive to check the state." },
];
const actions = ["move", "screenshot", "move", "click"];
const rows = [
	{ issue: 1, status: "proof_verified" },
	{ issue: 2, status: "failure_observed" },
	{ issue: 3, status: "failure_observed" },
	{ issue: 4, status: "eligible_not_attempted" },
	{ issue: 5, status: "excluded_sensitive_or_security" },
	{ issue: 6, status: "attempted_miss" },
	{ issue: 7, status: "unsupported_device" },
	{ issue: 8, status: "no_usable_media" },
];
const viewports = [
	{ width: 1280, height: 800 },
	{ width: 390, height: 844 },
];
const fileUrl = (root, issue) =>
	pathToFileURL(join(root, String(issue), "replay.html")).href;

async function withReplay(run) {
	const renderReplay = await product("ui/render.mjs", "renderReplay");
	await temporary(async (root) => {
		const runs = join(root, "runs");
		const dir = join(runs, "1");
		fixtureRun(dir, "finished", {
			steps: actions.map((action, i) => ({
				order: i + 1,
				t_s: i + 1,
				action,
				target: "Archive",
				selector: "#archive",
			})),
			replay: {
				screenshots: actions.map((action, i) => ({
					path: "screenshots/step-1.png",
					t_s: i + 1,
					action,
				})),
				events: actions.map((action, i) => ({
					type: "action",
					t_s: i + 1,
					action,
					detail: "#archive",
					...explanations[i],
				})),
			},
		});
		// Issue 2 has a replay; issue 3 has the same status but no replay.
		mkdirSync(join(runs, "2"));
		writeFileSync(
			join(runs, "2", "replay.html"),
			"<!doctype html><title>Fixture replay</title>",
		);
		writeJson(join(dir, "census.json"), rows);
		await renderReplay(dir);
		await withBrowser(async (browser) => {
			for (const viewport of viewports) {
				const view = await openStatic(
					browser,
					join(dir, "replay.html"),
					viewport,
				);
				try {
					await run(view.page, runs);
					const axe = await new AxeBuilder({ page: view.page }).analyze();
					assert.deepEqual(
						axe.violations
							.filter((v) => ["serious", "critical"].includes(v.impact))
							.map((v) => v.id),
						[],
						`Serious or critical axe findings at ${viewport.width}x${viewport.height}`,
					);
					assert.equal(
						await view.page.evaluate(
							() => document.documentElement.scrollWidth <= innerWidth,
						),
						true,
					);
					checkLocalPage(view);
				} finally {
					await view.context.close();
				}
			}
		});
	});
}

async function visibleValue(row, id) {
	const value = row.getByTestId(id);
	if ((await value.count()) !== 1 || !(await value.isVisible())) return null;
	// biome-ignore lint/performance/useDomNodeTextContent: Assert rendered text, not hidden DOM text.
	const text = await value.innerText();
	return /^not recorded$/i.test(text.trim()) ? "not recorded" : text;
}

test("TC-R14-1/observation", { timeout: 120000 }, async () => {
	const actual = [];
	await withReplay(async (page) => {
		const steps = await page
			.getByTestId("steps")
			.getByTestId("replay-step")
			.all();
		const values = [];
		for (const step of steps)
			values.push({
				observation: await visibleValue(step, "step-observation"),
				reason: await visibleValue(step, "step-reason"),
			});
		assert.equal(
			await page.locator("[data-model-fixture]").count(),
			0,
			"Observation markup created a DOM element",
		);
		actual.push(values);
	});
	const expected = explanations.map(({ observation, reason }) => ({
		observation: observation ?? "not recorded",
		reason: reason ?? "not recorded",
	}));
	assert.deepEqual(
		actual,
		[expected, expected],
		"Every visible step must show its recorded model observation and reason, or not recorded",
	);
});

test("TC-R14-1/census-index", { timeout: 120000 }, async () => {
	const actual = [];
	let expected;
	await withReplay(async (page, runs) => {
		const index = page.getByTestId("census-index");
		const entries = await index.getByTestId("census-row").all();
		const values = [];
		for (const entry of entries) {
			values.push({
				// biome-ignore lint/performance/useDomNodeTextContent: Assert rendered census content.
				text: (await entry.innerText())
					.replaceAll("_", " ")
					.replace(/\s+/g, " "),
				visible: await entry.isVisible(),
				links: await entry
					.locator("a[href]")
					.evaluateAll((links) => links.map((link) => link.href)),
			});
		}
		actual.push(
			values.map((value, i) => ({
				issue: rows[i] && value.text.includes(`#${rows[i].issue}`),
				status:
					rows[i] && value.text.includes(rows[i].status.replaceAll("_", " ")),
				visible: value.visible,
				links: value.links,
			})),
		);
		expected = rows.map(({ issue }) => ({
			issue: true,
			status: true,
			visible: true,
			links: issue <= 2 ? [fileUrl(runs, issue)] : [],
		}));
	});
	assert.deepEqual(
		actual,
		[expected, expected],
		"Census must show every issue/status and link only to existing replay pages",
	);
});

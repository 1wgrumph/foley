// Resource group: unique scratch directory and ephemeral loopback browser/server.
import assert from "node:assert/strict";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { serveApp } from "../../fixtures/stages/app-server.mjs";
import {
	boundedPng,
	modelReply,
	product,
	temporary,
	withEmber,
} from "../stages/support.mjs";
import { withBrowser } from "../ui/support.mjs";

const canvas = fileURLToPath(new URL("./canvas/", import.meta.url));
const viewport = { width: 1280, height: 720 };
const actions = [
	{ action: "click", target: "Draw rectangle", selector: "#arm" },
	{
		action: "pointer_drag",
		target: "rectangle",
		x: 200,
		y: 200,
		to_x: 400,
		to_y: 320,
	},
	{ action: "pointer_move", target: "rectangle interior", x: 300, y: 260 },
	{ action: "pointer_click", target: "rectangle interior", x: 300, y: 260 },
	{
		action: "pointer_double_click",
		target: "rectangle interior",
		x: 300,
		y: 260,
	},
];
const steps = actions.map((action, i) => ({ ...action, order: i + 1, t_s: i }));
const predicate = {
	kind: "canvas_state",
	source: "appState",
	path: ["status"],
	expected: "Selected",
	observed: "Selected (incorrect label)",
};
const doc = { schema: "foley.steps/1", steps, predicate };
const turn = (items) =>
	modelReply({ actions: items, done: true, verdict: "reproduced" });
const executed = (replay) =>
	replay.events.filter((e) => e.type === "action").map((e) => e.action);
const candidate = `import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createScene, draw, move, click, doubleClick, selectionStatus } from './logic.mjs';
test('canvas-selection', () => {
  const scene = createScene();
  draw(scene, [200, 200], [400, 320]);
  move(scene, [300, 260]);
  click(scene, [300, 260]);
  doubleClick(scene, [300, 260]);
  assert.equal(selectionStatus(scene), 'Selected', 'canvas-selection');
});
`;

async function canvasApp(run) {
	const app = await serveApp(canvas);
	try {
		await run(app.origin);
	} finally {
		await app.close();
	}
}

// Prove the fixture's real browser event path separately from Foley's driver.
async function checkFixture(origin) {
	await withBrowser(async (browser) => {
		const context = await browser.newContext({
			viewport,
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
			await page.locator("#arm").click();
			await page.mouse.move(200, 200);
			await page.mouse.down();
			await page.mouse.move(400, 320);
			await page.mouse.up();
			await page.mouse.move(300, 260);
			await page.mouse.click(300, 260);
			await page.mouse.dblclick(300, 260);
			assert.deepEqual(await page.evaluate(() => window.h.elements), [
				{ x: 200, y: 200, width: 200, height: 120 },
			]);
			assert.equal(
				await page.evaluate(() => window.h.state.status),
				predicate.observed,
			);
		} finally {
			await context.close();
		}
	});
}

async function modelRun(items, check) {
	const repro = await product("src/repro.mjs", "repro");
	await temporary((root) =>
		canvasApp((origin) =>
			withEmber(root, [turn(items)], async ({ callEmber, server }) => {
				const replay = await repro(steps, predicate, origin, {
					runDir: root,
					caseId: "pointer",
					caseBudget: 100000,
					callEmber,
				});
				await check(replay, server, origin);
			}),
		),
	);
}

test("TC-R06-1/pointer-draw-select", { timeout: 120000 }, async () => {
	await canvasApp(checkFixture);
	await modelRun(actions, (replay) => {
		assert.equal(
			replay.observed,
			true,
			"Pointer actions must draw and select the shape in the actual page",
		);
		assert.deepEqual(
			executed(replay),
			actions.map((a) => a.action),
		);
	});
});

test("TC-R06-1/pointer-viewport", { timeout: 120000 }, async () => {
	await modelRun([{ action: "screenshot" }], (_replay, server) => {
		const request = server.requests[0].body;
		const parts = request.messages.flatMap(({ content }) =>
			typeof content === "string" ? [{ type: "text", text: content }] : content,
		);
		const png = boundedPng(
			parts.find(({ type }) => type === "image_url").image_url.url,
		);
		assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1280, 720]);
		assert.match(
			parts
				.filter(({ type }) => type === "text")
				.map(({ text }) => text)
				.join(" "),
			/1280[^0-9]{1,40}720/,
			"Prompt must state screenshot viewport dimensions",
		);
	});
});

const badActions = [
	{ action: "pointer_click", x: 1280, y: 0 },
	{ action: "pointer_double_click", x: 0, y: 720 },
	{ action: "pointer_move", x: -1, y: 0 },
	{ action: "pointer_click", x: 1.5, y: 0 },
	{ action: "pointer_move", x: 1 },
	{ action: "pointer_drag", x: 0, y: 0, to_x: 1, to_y: 720 },
	{ action: "pointer_drag", x: 0, y: 0, to_x: "1", to_y: 1 },
	{ action: "pointer_drag", x: 0, y: 0, to_x: 1 },
];

test("TC-R06-3/pointer-whole-turn", { timeout: 120000 }, async () => {
	const results = [];
	for (const action of badActions) {
		await modelRun([actions[0], action], (replay, server) => {
			results.push({
				executed: executed(replay),
				reason: replay.events.find((e) => e.type === "stopped")?.reason,
				observed: replay.observed,
				calls: server.requests.length,
			});
		});
	}
	assert.deepEqual(
		results,
		badActions.map(() => ({
			executed: [],
			reason: "malformed_output",
			observed: false,
			calls: 1,
		})),
		"Reject the whole malformed turn before even the valid selector action",
	);
});

test("TC-R06-3/pointer-recorded-schema", async () => {
	const validateSteps = await product("src/run-schema.mjs", "validateSteps");
	const valid = [
		doc,
		{
			...doc,
			steps: [
				{
					order: 1,
					t_s: 0,
					target: "corner",
					action: "pointer_click",
					x: 1279,
					y: 719,
				},
			],
		},
	];
	const invalid = badActions.map((action) => ({
		...doc,
		steps: [{ order: 1, t_s: 0, target: "rectangle", ...action }],
	}));
	assert.deepEqual(
		[...valid, ...invalid].map(validateSteps),
		[...valid.map(() => true), ...invalid.map(() => false)],
		"Recorded pointer fields have the same viewport bounds as model actions",
	);
});

test("TC-R07-2/pointer-page-control", { timeout: 120000 }, async () => {
	const prove = await product("src/prove.mjs", "prove");
	await temporary((root) => {
		const bug = join(root, "bug");
		const fixed = join(root, "fixed");
		const runDir = join(root, "run");
		cpSync(canvas, bug, { recursive: true });
		cpSync(canvas, fixed, { recursive: true });
		mkdirSync(runDir);
		const logic = join(fixed, "logic.mjs");
		writeFileSync(
			logic,
			readFileSync(logic, "utf8").replace(
				"Selected (incorrect label)",
				"Selected",
			),
		);
		return withEmber(
			root,
			[
				modelReply({
					code: candidate,
					filename: "regression.test.mjs",
					assertion: "canvas-selection",
				}),
			],
			async ({ callEmber, server }) => {
				const result = await prove(steps, [], predicate, {
					runDir,
					targetDir: bug,
					fixedTargetDir: fixed,
					runner: "node-test",
					callEmber,
					caseId: "pointer-control",
					caseBudget: 100000,
				});
				assert.equal(
					result.attempts[0]?.bug?.exitCode,
					1,
					JSON.stringify(result.attempts),
				);
				assert.equal(
					result.attempts[0]?.fixed?.exitCode,
					0,
					JSON.stringify(result.attempts),
				);
				assert.equal(
					result.status,
					"verified",
					"Trusted page control must replay recorded pointer steps on both builds",
				);
				assert.equal(server.requests.length, 1);
				assert.equal(result.rerun_without_ember.bug.exitCode, 1);
				assert.equal(result.rerun_without_ember.fixed.exitCode, 0);
			},
		);
	});
});

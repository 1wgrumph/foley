import assert from "node:assert/strict";
import { once } from "node:events";
import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import {
	anchor,
	archive,
	clip,
	entry,
	fixture,
	localEnv,
	modelReply,
	pinFixture,
	product,
	proofCode,
	readJson,
	repo,
	startChild,
	temporary,
	withApps,
	withEmber,
	writeJson,
} from "../stages/support.mjs";
import { fixtureRun, openStatic, withBrowser } from "../ui/support.mjs";

const frameProbe = { video: { accepted: false }, audio: { accepted: false } };
const excalidrawTarget = () =>
	resolve(
		process.env.FOLEY_EXCALIDRAW_TARGET ?? join(repo, "out/w3r-excalidraw"),
	);
const candidate = (code, assertion = "archive-status") =>
	modelReply({ code, filename: "regression.test.mjs", assertion });

test("TC-R07-1/native-vitest", { timeout: 240000 }, async () => {
	// Prepared read-only source and installed dependencies from the pinned target.
	const targetDir = excalidrawTarget();
	const runner = readJson(join(targetDir, "node_modules/vitest/package.json"));
	assert.equal(runner.version, readJson(fixture("target.json")).runner.version);
	const code = readFileSync(entry("test/w3r/P-native.test.mjs.txt"), "utf8");
	const prove = await product("src/prove.mjs", "prove");
	await temporary((root) =>
		withEmber(
			root,
			[candidate(code), { mode: "api_error" }],
			async ({ callEmber, env, server }) => {
				const runDir = join(root, "run");
				mkdirSync(runDir);
				const { target, revision } = pinFixture(root);
				const recording = join(root, "recording.mp4");
				cpSync(clip, recording);
				const preflight = await startChild(
					[
						"--import",
						fixture("stages", "loopback-only.mjs"),
						entry("bin/foley.mjs"),
						"run",
						"1",
						"--issue-url",
						"https://example.invalid/issues/1",
						"--recording",
						recording,
						"--target",
						target,
						"--revision",
						revision,
						"--runner",
						"unsupported-test-runner",
						"--case-budget",
						"100000",
						"--app-origin",
						"http://127.0.0.1:1",
						"--dry-run",
					],
					{ cwd: root, env },
				).done;
				assert.equal(preflight.code, 2);
				assert.match(preflight.stderr, /runner/i);
				assert.equal(server.requests.length, 0);
				const result = await prove(archive.steps, [], archive.predicate, {
					runDir,
					targetDir,
					runner: "vitest",
					callEmber,
					caseId: "native-runner",
					caseBudget: 100000,
					timeoutMs: 120000,
					memoryMiB: 1024,
				});
				assert.equal(result.status, "not_verified");
				assert.equal(
					result.attempts[0]?.bug?.exitCode,
					0,
					`Pinned native test did not run successfully: ${result.reason ?? result.attempts[0]?.bug?.output}`,
				);
				assert.equal(result.attempts[0].reason, "wrong_predicate");
				assert.equal(existsSync(join(runDir, "regression.test.mjs")), false);
			},
		),
	);
});

function ownedProof(root, callEmber, extras = {}) {
	const runDir = join(root, "run");
	mkdirSync(runDir);
	const targetDir = join(root, "bug");
	cpSync(fixture("app"), targetDir, { recursive: true });
	return {
		runDir,
		targetDir,
		options: {
			runDir,
			targetDir,
			runner: "node-test",
			callEmber,
			caseId: "proof-control",
			caseBudget: 100000,
			timeoutMs: 10000,
			memoryMiB: 128,
			...extras,
		},
	};
}

test("TC-R07-2/no-independent-control", { timeout: 120000 }, async () => {
	const prove = await product("src/prove.mjs", "prove");
	await temporary((root) =>
		withEmber(root, [candidate(proofCode)], async ({ callEmber }) => {
			const { runDir, options } = ownedProof(root, callEmber);
			const result = await prove(
				archive.steps,
				[anchor],
				archive.predicate,
				options,
			);
			assert.equal(
				result.status,
				"not_verified",
				"Repeatable red without a control is not a proof",
			);
			assert.equal(result.reason, "inconclusive");
			assert.equal(existsSync(join(runDir, "regression.test.mjs")), false);
		}),
	);
});

test("TC-R07-2/unrelated-build-difference", { timeout: 120000 }, async () => {
	// Two owned builds where the archive behavior is identical, but a theme differs.
	// This is an ordinary test of another UI property, not of Archive behavior.
	const code = `import { test } from "node:test";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { themeName } from "./theme.mjs";
test("Archived label theme", () => {
	assert.equal(themeName(), "dark", "theme-default");
});
`;
	const prove = await product("src/prove.mjs", "prove");
	await temporary((root) =>
		withEmber(
			root,
			[candidate(code, "theme-default"), { mode: "api_error" }],
			async ({ callEmber }) => {
				const other = join(root, "other");
				cpSync(fixture("app"), other, { recursive: true });
				const { runDir, targetDir, options } = ownedProof(root, callEmber, {
					fixedTargetDir: other,
				});
				writeFileSync(
					join(targetDir, "theme.mjs"),
					'export const themeName = () => "light";\n',
				);
				writeFileSync(
					join(other, "theme.mjs"),
					'export const themeName = () => "dark";\n',
				);
				assert.deepEqual(
					readFileSync(join(targetDir, "logic.mjs")),
					readFileSync(join(other, "logic.mjs")),
				);
				const result = await prove(
					archive.steps,
					[anchor],
					archive.predicate,
					options,
				);
				assert.equal(
					result.status,
					"not_verified",
					"A different theme is not evidence of the Archive predicate",
				);
				assert.equal(existsSync(join(runDir, "regression.test.mjs")), false);
			},
		),
	);
});

test("TC-R07-2/predicate-provenance", { timeout: 120000 }, async () => {
	// The two builds have the same broken Archive transition. A separate status
	// label happens to use the same words, but it is not the Archive predicate.
	const code = `import { test } from "node:test";
import assert from "node:assert/strict";
import { secondaryLabel } from "./label.mjs";
test("secondary label", () => {
	assert.equal(secondaryLabel(), "Archived", "secondary-label");
});
`;
	const prove = await product("src/prove.mjs", "prove");
	await temporary((root) =>
		withEmber(
			root,
			[candidate(code, "secondary-label"), { mode: "api_error" }],
			async ({ callEmber }) => {
				const other = join(root, "other");
				cpSync(fixture("app"), other, { recursive: true });
				const { runDir, targetDir, options } = ownedProof(root, callEmber, {
					fixedTargetDir: other,
				});
				writeFileSync(
					join(targetDir, "label.mjs"),
					'export const secondaryLabel = () => "Not archived";\n',
				);
				writeFileSync(
					join(other, "label.mjs"),
					'export const secondaryLabel = () => "Archived";\n',
				);
				// Independent source-of-truth control: the actual transition is unchanged.
				for (const dir of [targetDir, other]) {
					const app = await import(pathToFileURL(join(dir, "logic.mjs")).href);
					assert.equal(app.archiveItem(), archive.predicate.observed);
				}
				const result = await prove(
					archive.steps,
					[anchor],
					archive.predicate,
					options,
				);
				assert.equal(
					result.status,
					"not_verified",
					"Matching runner values do not establish that the relevant Archive behavior changed",
				);
				assert.equal(existsSync(join(runDir, "regression.test.mjs")), false);
			},
		),
	);
});

test("TC-R06-4/discriminated-predicate", async () => {
	const validateSteps = await product("src/run-schema.mjs", "validateSteps");
	const valid = [
		archive.predicate,
		{ kind: "element_count", selector: ".item", expected: 1, observed: 2 },
		{
			kind: "console_error",
			message: "Example canvas warning",
			expected: false,
			observed: true,
		},
		{
			kind: "canvas_state",
			source: "elements",
			path: [0, "type"],
			expected: "rectangle",
			observed: "ellipse",
		},
		{
			kind: "canvas_state",
			source: "appState",
			path: ["activeTool", "type"],
			expected: "selection",
			observed: "rectangle",
		},
		null,
	];
	const invalid = [
		{ ...archive.predicate, kind: "unknown" },
		{ ...archive.predicate, expected: archive.predicate.observed },
		{ ...archive.predicate, expected: 7 },
		{ ...archive.predicate, selector: "" },
		{ ...valid[1], observed: -1 },
		{ ...valid[1], observed: 1.25 },
		{ ...valid[2], message: "" },
		{ ...valid[2], expected: true },
		{ ...valid[3], source: "other" },
		{ ...valid[3], path: ["count", -1] },
	];
	assert.deepEqual(
		valid.map((predicate) => validateSteps({ ...archive, predicate })),
		valid.map(() => true),
	);
	assert.deepEqual(
		invalid.map((predicate) => validateSteps({ ...archive, predicate })),
		invalid.map(() => false),
	);
});

// This owned page implements Excalidraw's pinned test-hook data shape:
// h.elements and h.state. Its visual count and errors come from actual DOM/console events.
async function withCanvasPage(run) {
	const pageHtml = (bug) => `<!doctype html><title>Canvas fixture</title>
<button id="observe">Observe state</button>
<div class="item">One</div>${bug ? '<div class="item">Two</div>' : ""}
<script>
window.h = {
	elements: [{type: "${bug ? "ellipse" : "rectangle"}"}],
	state: {activeTool: {type: "${bug ? "rectangle" : "selection"}"}}
};
document.querySelector("#observe").addEventListener("click", () => {
	${bug ? 'console.error("Example canvas warning");' : ""}
});
</script>`;
	const server = createServer((req, res) => {
		if (req.url === "/bug" || req.url === "/fixed") {
			res.setHeader("content-type", "text/html");
			res.end(pageHtml(req.url === "/bug"));
		} else if (req.url === "/") {
			res.setHeader("content-type", "text/html");
			res.end(pageHtml(true));
		} else res.writeHead(204).end();
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	try {
		await run(`http://127.0.0.1:${server.address().port}`);
	} finally {
		server.closeAllConnections();
		await new Promise((resolve, reject) =>
			server.close((e) => (e ? reject(e) : resolve())),
		);
	}
}

const countPredicate = {
	kind: "element_count",
	selector: ".item",
	expected: 1,
	observed: 2,
};
const consolePredicate = {
	kind: "console_error",
	message: "Example canvas warning",
	expected: false,
	observed: true,
};
const shapePredicate = {
	kind: "canvas_state",
	source: "elements",
	path: [0, "type"],
	expected: "rectangle",
	observed: "ellipse",
};
const toolPredicate = {
	kind: "canvas_state",
	source: "appState",
	path: ["activeTool", "type"],
	expected: "selection",
	observed: "rectangle",
};

async function observed(check, page, predicate, context) {
	try {
		return await check(page, predicate, context);
	} catch (error) {
		return error.name;
	}
}

test("TC-R06-4/page-oracles", { timeout: 120000 }, async () => {
	const check = await product("src/predicate.mjs", "checkPredicate");
	await withCanvasPage((origin) =>
		withBrowser(async (browser) => {
			const result = [];
			for (const variant of ["bug", "fixed"]) {
				const context = await browser.newContext({ serviceWorkers: "block" });
				try {
					await context.route("**/*", (route) =>
						new URL(route.request().url()).origin === origin
							? route.continue()
							: route.abort(),
					);
					const page = await context.newPage();
					const consoleErrors = [];
					page.on("console", (message) => {
						if (message.type() === "error") consoleErrors.push(message.text());
					});
					await page.goto(`${origin}/${variant}`);
					await page.locator("#observe").click();
					for (const predicate of [
						countPredicate,
						consolePredicate,
						shapePredicate,
						toolPredicate,
					])
						result.push(
							await observed(check, page, predicate, { consoleErrors }),
						);
					result.push(
						await observed(
							check,
							page,
							{ ...toolPredicate, path: ["missing"] },
							{ consoleErrors },
						),
					);
				} finally {
					await context.close();
				}
			}
			assert.deepEqual(result, [
				true,
				true,
				true,
				true,
				false,
				false,
				false,
				false,
				false,
				false,
			]);
		}),
	);
});

test("TC-R06-4/target-canvas-state", { timeout: 120000 }, async () => {
	const check = await product("src/predicate.mjs", "checkPredicate");
	const target = excalidrawTarget();
	const cwd = join(target, "excalidraw-app");
	// Actual pinned production build, served by its pinned preview runner.
	const child = startChild(
		[
			join(target, "node_modules/vite/bin/vite.js"),
			"preview",
			"--host",
			"127.0.0.1",
			"--port",
			"0",
			"--strictPort",
		],
		{ cwd, env: localEnv(), timeoutMs: 120000 },
	);
	try {
		const [origin] = await child.waitForOutput(/http:\/\/127\.0\.0\.1:\d+/);
		await withBrowser(async (browser) => {
			const context = await browser.newContext({ serviceWorkers: "block" });
			try {
				await context.route("**/*", (route) =>
					new URL(route.request().url()).origin === origin
						? route.continue()
						: route.abort(),
				);
				const page = await context.newPage();
				await page.goto(origin);
				await page
					.locator("canvas")
					.first()
					.waitFor({ state: "visible", timeout: 60000 });
				// The owned session draws one rectangle with Excalidraw's own keyboard/mouse handlers.
				await page.keyboard.press("r");
				await page.mouse.move(400, 300);
				await page.mouse.down();
				await page.mouse.move(540, 410);
				await page.mouse.up();
				// Wait on the app's own committed scene and app-state data, not a sleep.
				await page.waitForFunction(
					() => {
						const elements = JSON.parse(
							localStorage.getItem("excalidraw") ?? "[]",
						);
						const state = JSON.parse(
							localStorage.getItem("excalidraw-state") ?? "{}",
						);
						return (
							elements.length === 1 &&
							elements[0].type === "rectangle" &&
							state.activeTool?.type === "selection"
						);
					},
					null,
					{ timeout: 30000 },
				);
				const checks = [
					{
						kind: "canvas_state",
						source: "elements",
						path: [0, "type"],
						expected: "ellipse",
						observed: "rectangle",
					},
					{
						kind: "canvas_state",
						source: "appState",
						path: ["activeTool", "type"],
						expected: "rectangle",
						observed: "selection",
					},
					{
						kind: "canvas_state",
						source: "elements",
						path: [0, "type"],
						expected: "rectangle",
						observed: "ellipse",
					},
				];
				const result = [];
				for (const predicate of checks)
					result.push(await observed(check, page, predicate));
				assert.deepEqual(
					result,
					[true, true, false],
					"Actual pinned build has usable scene/app-state data even without its dev/test hook",
				);
			} finally {
				await context.close();
			}
		});
	} finally {
		await child.stop();
	}
});

test("TC-R06-4/console-recording", { timeout: 120000 }, async () => {
	const repro = await product("src/repro.mjs", "repro");
	await withCanvasPage((origin) =>
		temporary(async (root) => {
			let outcome;
			try {
				outcome = await repro(
					[
						{
							order: 1,
							t_s: 0,
							action: "click",
							target: "Observe state",
							selector: "#observe",
						},
					],
					consolePredicate,
					origin,
					{
						runDir: root,
						scripted: true,
					},
				);
			} catch (error) {
				outcome = { status: error.name };
			}
			assert.equal(
				outcome.status,
				"reproduced",
				"Reproduction must collect actual error-level console events",
			);
			assert.equal(outcome.observed, true);
		}),
	);
});

test("TC-R04-1/unsupported-watch-predicate", { timeout: 120000 }, async () => {
	const watch = await product("src/watch.mjs", "watch");
	await temporary((root) =>
		withEmber(
			root,
			[
				modelReply({
					...archive,
					predicate: { ...archive.predicate, kind: "unknown" },
				}),
			],
			async ({ callEmber, server }) => {
				const runDir = join(root, "run");
				const result = await watch(clip, {
					runDir,
					callEmber,
					probe: frameProbe,
					caseId: "watch",
					caseBudget: 100000,
				});
				assert.equal(server.requests.length, 1);
				assert.equal(result.status, "malformed_output");
				assert.equal(existsSync(join(runDir, "steps.json")), false);
			},
		),
	);
});

test("TC-R06-5/no-paid-reproduction", { timeout: 120000 }, async () => {
	const repro = await product("src/repro.mjs", "repro");
	const actual = [];
	for (const predicate of [null, { ...archive.predicate, kind: "unknown" }]) {
		await temporary((root) =>
			withApps(root, ({ bug }) =>
				withEmber(
					root,
					[modelReply({ actions: [], done: true, verdict: "not_reproduced" })],
					async ({ callEmber, server }) => {
						let result;
						try {
							result = await repro(archive.steps, predicate, bug.origin, {
								runDir: join(root, "run"),
								callEmber,
								caseId: "invalid",
								caseBudget: 100000,
							});
						} catch (error) {
							result = { status: error.name };
						}
						actual.push({
							requests: server.requests.length,
							status: result.status,
							observed: result.observed,
							attempts: result.attempts?.length,
							reason: result.events?.find((e) => e.type === "stopped")?.reason,
						});
					},
				),
			),
		);
	}
	assert.deepEqual(
		actual,
		["no_predicate", "malformed_output"].map((reason) => ({
			requests: 0,
			status: "not_reproduced",
			observed: false,
			attempts: 0,
			reason,
		})),
	);
});

test("TC-R06-3/whole-turn", { timeout: 240000 }, async () => {
	const repro = await product("src/repro.mjs", "repro");
	const click = archive.steps[0];
	const turns = [
		{},
		{ actions: [click] },
		{ actions: [click], done: "true", verdict: "reproduced" },
		{ actions: [click], done: true, verdict: "other" },
		{
			actions: [click, { action: "type", selector: 7, value: "hello" }],
			done: true,
			verdict: "reproduced",
		},
		{ actions: [click, null], done: true, verdict: "reproduced" },
	];
	const actual = [];
	for (const reply of turns)
		await temporary((root) =>
			withApps(root, ({ bug }) =>
				withEmber(root, [modelReply(reply)], async ({ callEmber, server }) => {
					const runDir = join(root, "run");
					const replay = await repro(
						archive.steps,
						archive.predicate,
						bug.origin,
						{ runDir, callEmber, caseId: "whole-turn", caseBudget: 100000 },
					);
					assert.deepEqual(readJson(join(runDir, "replay.json")), replay);
					actual.push({
						requests: server.requests.length,
						status: replay.status,
						observed: replay.observed,
						actions: replay.events.filter((e) => e.type === "action").length,
						stopped: replay.events.find((e) => e.type === "stopped")?.reason,
					});
				}),
			),
		);
	assert.deepEqual(
		actual,
		turns.map(() => ({
			requests: 1,
			status: "not_reproduced",
			observed: false,
			actions: 0,
			stopped: "malformed_output",
		})),
	);
});

const evidence = {
	uncertainty: [
		{ t_s: 0.5, text: "Narration and picture disagree on the outcome." },
	],
	narration_evidence: [
		{ t_s: 1.25, text: "The speaker describes an earlier action." },
	],
};

test("TC-R04-5/evidence-bounds", async () => {
	const validateSteps = await product("src/run-schema.mjs", "validateSteps");
	assert.equal(validateSteps({ ...archive, ...evidence }), true);
	const invalid = [
		[{ t_s: -1, text: "Before recording" }],
		[{ t_s: 121, text: "After recording" }],
		[{ t_s: 0, text: "x".repeat(1025) }],
		Array.from({ length: 41 }, () => ({ t_s: 0, text: "Observation" })),
		[{ t_s: 0, text: 42 }],
	];
	const validateRun = await product("src/run-schema.mjs", "validateRun");
	await temporary((root) => {
		const run = fixtureRun(join(root, "run"), "finished", evidence);
		assert.equal(validateRun(run), true);
		for (const field of Object.keys(evidence)) {
			assert.deepEqual(
				invalid.map((value) => validateSteps({ ...archive, [field]: value })),
				invalid.map(() => false),
			);
			assert.deepEqual(
				invalid.map((value) => validateRun({ ...run, [field]: value })),
				invalid.map(() => false),
			);
		}
	});
});

test("TC-R04-5/evidence-replay", { timeout: 240000 }, async () => {
	await temporary((root) =>
		withApps(root, ({ bug }) =>
			withEmber(
				root,
				[modelReply({ ...archive, ...evidence }), { mode: "refused_input" }],
				async ({ env, server }) => {
					const { target, revision } = pinFixture(root);
					const recording = join(root, "recording.mp4");
					cpSync(clip, recording);
					const probe = join(root, "probe.json");
					writeJson(probe, frameProbe);
					const child = startChild(
						[
							"--import",
							fixture("stages", "loopback-only.mjs"),
							entry("bin/foley.mjs"),
							"run",
							"1",
							"--issue-url",
							"https://example.invalid/issues/1",
							"--fixture",
							"--recording",
							recording,
							"--target",
							target,
							"--revision",
							revision,
							"--app-origin",
							bug.origin,
							"--runner",
							"node-test",
							"--case-budget",
							"100000",
							"--probe",
							probe,
						],
						{ cwd: root, env },
					);
					const result = await child.done;
					assert.equal(result.code, 1, result.stderr);
					assert.equal(server.requests.length, 2);
					const runDir = join(root, "out/runs/1");
					const steps = readJson(join(runDir, "steps.json"));
					const run = readJson(join(runDir, "run.json"));
					const comment = readFileSync(join(runDir, "comment.md"), "utf8");
					const actual = {
						steps: {},
						run: {},
						embedded: {},
						comment: [],
						dom: [],
					};
					for (const field of Object.keys(evidence)) {
						actual.steps[field] = steps[field];
						actual.run[field] = run[field];
						actual.comment.push(
							comment.includes(evidence[field][0].text) &&
								comment.includes(`${evidence[field][0].t_s}s`),
						);
					}
					await withBrowser(async (browser) => {
						const view = await openStatic(browser, join(runDir, "replay.html"));
						try {
							const embedded = JSON.parse(
								await view.page.locator("#data").textContent(),
							).run;
							for (const field of Object.keys(evidence)) {
								actual.embedded[field] = embedded[field];
								const note = evidence[field][0];
								const stamp = `00:${String(Math.floor(note.t_s)).padStart(2, "0")}`;
								const locator = view.page.getByTestId(
									field.replaceAll("_", "-"),
								);
								const text = (await locator.count())
									? await locator.textContent()
									: "";
								actual.dom.push(
									Boolean(
										text?.includes(note.text) &&
											(text.includes(stamp) || text.includes(String(note.t_s))),
									),
								);
							}
						} finally {
							await view.context.close();
						}
					});
					assert.deepEqual(actual, {
						steps: evidence,
						run: evidence,
						embedded: evidence,
						comment: [true, true],
						dom: [true, true],
					});
				},
			),
		),
	);
});

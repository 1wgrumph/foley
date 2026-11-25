import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
	anchor,
	archive,
	clip,
	proofCode,
	writeJson,
} from "../stages/support.mjs";

export const pixel =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=";
export function fixtureRun(runDir, state = "finished", patch = {}) {
	mkdirSync(join(runDir, "screenshots"), { recursive: true });
	copyFileSync(clip, join(runDir, "recording.mp4"));
	writeFileSync(
		join(runDir, "screenshots", "step-1.png"),
		Buffer.from(pixel, "base64"),
	);
	writeFileSync(join(runDir, "regression.test.mjs"), proofCode);
	const document = {
		schema: "foley.run/1",
		issue: 1,
		issue_url: "https://example.invalid/issues/1",
		target_revision: "0000000000000000000000000000000000000001",
		fixture: true,
		state,
		recording: "recording.mp4",
		steps: structuredClone(archive.steps),
		predicate: structuredClone(archive.predicate),
		anchors: [structuredClone(anchor)],
		replay: {
			screenshots: [
				{ path: "screenshots/step-1.png", t_s: 1, action: "click" },
			],
			events: [{ type: "action", action: "click", t_s: 1, detail: "Archive" }],
		},
		test: { path: "regression.test.mjs", verdict: "verified" },
		verdict: "proof_verified",
		cost_micro_usd: 152,
		error: null,
		...patch,
	};
	if (state === "empty")
		Object.assign(document, {
			recording: null,
			steps: [],
			predicate: null,
			anchors: [],
			replay: { screenshots: [], events: [] },
			test: null,
			verdict: null,
			cost_micro_usd: 0,
		});
	if (state === "running")
		Object.assign(document, { test: null, verdict: null });
	if (state === "error") document.error = "Synthetic run error";
	writeJson(join(runDir, "run.json"), document);
	return document;
}

export async function withBrowser(run) {
	const { chromium } = await import("playwright");
	const browser = await chromium.launch({
		args: ["--disable-background-networking"],
	});
	try {
		await run(browser);
	} finally {
		await browser.close();
	}
}

export async function openStatic(
	browser,
	pagePath,
	viewport = { width: 1280, height: 800 },
) {
	const url = pathToFileURL(pagePath).href;
	const context = await browser.newContext({
		viewport,
		serviceWorkers: "block",
	});
	const requests = [];
	const errors = [];
	await context.route("**/*", (route) =>
		route.request().url() === url || /^(data|blob):/.test(route.request().url())
			? route.continue()
			: route.abort(),
	);
	const page = await context.newPage();
	page.setDefaultTimeout(15000);
	page.on("request", (request) => requests.push(request.url()));
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") errors.push(message.text());
	});
	try {
		await page.goto(url, { waitUntil: "load", timeout: 30000 });
		return { context, page, requests, errors, url };
	} catch (error) {
		await context.close();
		throw error;
	}
}

export async function checkSeven(page, run, runDir) {
	const names = [
		"recording",
		"replay",
		"steps",
		"location",
		"test",
		"verdict",
		"cost-meter",
	];
	for (const name of names)
		await page.getByTestId(name).waitFor({ state: "visible" });
	const includes = async (id, value) =>
		assert.ok(
			(await page.getByTestId(id).innerText()).includes(value),
			`Missing ${id}: ${value}`,
		);
	await includes("steps", run.steps[0].target);
	await includes("location", `${run.anchors[0].file}:${run.anchors[0].line}`);
	await includes("test", run.test.path);
	assert.ok(
		(await page.getByTestId("verdict").innerText())
			.toLowerCase()
			.replaceAll("_", " ")
			.includes(run.verdict.replaceAll("_", " ")),
	);
	await includes("cost-meter", `$${(run.cost_micro_usd / 1e6).toFixed(6)}`);
	await page.waitForFunction(() => {
		const video = document.querySelector('[data-testid="recording"] video');
		const image = document.querySelector('[data-testid="replay"] img');
		return video?.readyState >= 1 && image?.complete && image.naturalWidth > 0;
	});
	const assets = await page.evaluate(() => [
		document.querySelector('[data-testid="recording"] video').currentSrc,
		document.querySelector('[data-testid="replay"] img').currentSrc,
	]);
	assert.ok(
		assets.every((url) => /^(data|blob):/.test(url)),
		"Static page has non-inlined assets",
	);
	for (const [index, relative] of [
		run.recording,
		run.replay.screenshots[0].path,
	].entries()) {
		// A self-contained Blob is also legal; data URLs can be compared without
		// weakening a page's connect-src policy to fetch from the browser.
		if (assets[index].startsWith("data:")) {
			const [header, body] = assets[index].split(",", 2);
			assert.ok(header.endsWith(";base64"));
			assert.deepEqual(
				Buffer.from(body, "base64"),
				readFileSync(join(runDir, relative)),
				"Inlined media differs from run artifact",
			);
		}
	}
}

export function checkLocalPage(observation) {
	assert.ok(observation.requests.includes(observation.url));
	assert.deepEqual(
		observation.requests.filter(
			(url) => url !== observation.url && !/^(data|blob):/.test(url),
		),
		[],
	);
	assert.deepEqual(observation.errors, []);
}

export async function checkKeyboard(page) {
	const selector =
		"a[href],button,input,select,textarea,video[controls],[tabindex]";
	const expected = await page.evaluate(
		(selector) =>
			[...document.querySelectorAll(selector)]
				.map((node, index) => ({ node, index }))
				.filter(
					({ node }) =>
						node.tabIndex >= 0 &&
						!node.disabled &&
						!node.closest("[inert]") &&
						getComputedStyle(node).visibility === "visible" &&
						node.getClientRects().length,
				)
				.map(({ index }) => index),
		selector,
	);
	if (expected.length === 0) return; // Empty views need no artificial control.
	const visited = new Set();
	for (
		let i = 0;
		i < expected.length * 4 + 10 && visited.size < expected.length;
		i++
	) {
		await page.keyboard.press("Tab");
		const index = await page.evaluate(
			(selector) =>
				[...document.querySelectorAll(selector)].indexOf(
					document.activeElement,
				),
			selector,
		);
		if (expected.includes(index)) visited.add(index);
	}
	assert.deepEqual(
		[...visited].sort((a, b) => a - b),
		expected,
		"Unreachable keyboard control",
	);
}

export const screenshotBytes = (runDir) =>
	readFileSync(join(runDir, "screenshots", "step-1.png"));

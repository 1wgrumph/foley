#!/usr/bin/env node
// Records the owned ground-truth clip against the pinned local Excalidraw build.
//   node fixtures/recordings/record-owned-clip.mjs
// Needs target/ built (tools/target-pin.sh) and ffmpeg on PATH. Writes
// fixtures/recordings/owned-basic-flow.mp4 and prints the action timeline and
// the final scene read from the app's own localStorage save.
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const root = new URL("../..", import.meta.url).pathname;
const rawDir = join(root, "out/fixtures/clip-raw");
const outFile = join(root, "fixtures/recordings/owned-basic-flow.mp4");
const size = { width: 1280, height: 720 };
// Vite colours the port number; strip terminal colour codes before matching the URL.
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

function startApp() {
	const server = spawn(
		"../node_modules/.bin/vite",
		["preview", "--host", "127.0.0.1", "--port", "0", "--strictPort"],
		{ cwd: join(root, "target/excalidraw-app"), detached: true },
	);
	return new Promise((resolve, reject) => {
		let text = "";
		const timer = setTimeout(
			() => reject(new Error("app did not start")),
			60000,
		);
		server.stdout.on("data", (d) => {
			text += d.toString().replace(ANSI, "");
			const m = text.match(/http:\/\/127\.0\.0\.1:\d+/);
			if (m) {
				clearTimeout(timer);
				resolve({ origin: m[0], stop: () => process.kill(-server.pid) });
			}
		});
		server.on("exit", () => reject(new Error("app exited")));
	});
}

const app = await startApp();
rmSync(rawDir, { recursive: true, force: true });
mkdirSync(rawDir, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({
	viewport: size,
	recordVideo: { dir: rawDir, size },
});
const page = await context.newPage();
const t0 = Date.now();
const timeline = [];
const mark = (action, detail) =>
	timeline.push({
		t_s: Number(((Date.now() - t0) / 1000).toFixed(1)),
		action,
		detail,
	});
const pause = (ms) => page.waitForTimeout(ms);

try {
	await page.goto(app.origin);
	await page.waitForSelector("canvas.interactive", { timeout: 30000 });
	await pause(2000);

	mark("key", "r (rectangle tool)");
	await page.keyboard.press("r");
	await pause(700);
	mark("drag", "rectangle from (400,250) to (700,450)");
	await page.mouse.move(400, 250);
	await page.mouse.down();
	await page.mouse.move(550, 350, { steps: 15 });
	await page.mouse.move(700, 450, { steps: 15 });
	await page.mouse.up();
	await pause(1200);

	mark("key", "t (text tool)");
	await page.keyboard.press("t");
	await pause(600);
	mark("click", "canvas at (420,520)");
	await page.mouse.click(420, 520);
	await pause(600);
	mark("type", "Hello Foley");
	await page.keyboard.type("Hello Foley", { delay: 120 });
	await pause(600);
	mark("key", "Escape (finish text)");
	await page.keyboard.press("Escape");
	await pause(1200);

	mark("click", "rectangle edge at (400,350) with selection tool");
	await page.keyboard.press("v");
	await page.mouse.click(400, 350);
	await pause(1000);
	mark("key", "Control+d (duplicate)");
	await page.keyboard.press("Control+d");
	await pause(1800);
	mark("key", "Control+z (undo)");
	await page.keyboard.press("Control+z");
	await pause(2500);

	const scene = await page.evaluate(() => {
		const els = JSON.parse(localStorage.getItem("excalidraw") || "[]");
		return els
			.filter((e) => !e.isDeleted)
			.map((e) => ({ type: e.type, text: e.text ?? null }));
	});
	mark("end", `${scene.length} visible elements`);
	console.log(JSON.stringify({ origin: app.origin, timeline, scene }, null, 2));
} finally {
	await context.close();
	await browser.close();
	app.stop();
}

const raw = readdirSync(rawDir).find((f) => f.endsWith(".webm"));
execFileSync(
	"ffmpeg",
	[
		"-y",
		"-loglevel",
		"error",
		"-i",
		join(rawDir, raw),
		"-vf",
		"scale=1280:-2",
		"-c:v",
		"libx264",
		"-pix_fmt",
		"yuv420p",
		"-crf",
		"28",
		"-an",
		"-movflags",
		"+faststart",
		outFile,
	],
	{ stdio: "inherit" },
);
console.error(`wrote ${outFile}`);

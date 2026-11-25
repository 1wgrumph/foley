// Scripted bug-pair check (FOL-R07, R15): no model. Serves one built page on
// loopback, runs the pair's hand-written Playwright scenario and exits 0 when
// the page shows the right behaviour, 1 when it shows the reported wrong
// behaviour, 2 when the check cannot decide.
// Usage: node test/pairs/check.mjs <issue> <bug|fixed|BUILD_DIR>
import { readFile, realpath } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { chromium } from "playwright";

const TYPES = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript",
	".css": "text/css",
	".json": "application/json",
	".svg": "image/svg+xml",
	".png": "image/png",
	".woff2": "font/woff2",
	".wasm": "application/wasm",
};

async function serve(dir) {
	const base = await realpath(dir);
	const server = createServer(async (req, res) => {
		try {
			const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
			const file = await realpath(
				resolve(base, path === "/" ? "index.html" : `.${path}`),
			);
			const rel = relative(base, file);
			if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("outside");
			res.setHeader(
				"content-type",
				TYPES[extname(file)] ?? "application/octet-stream",
			);
			res.end(await readFile(file));
		} catch {
			res.writeHead(404).end();
		}
	});
	await new Promise((done) => server.listen(0, "127.0.0.1", done));
	return { origin: `http://127.0.0.1:${server.address().port}`, server };
}

const [issue, side] = process.argv.slice(2);
if (!/^\d+$/.test(issue ?? "") || !side) {
	console.error("usage: check.mjs <issue> <bug|fixed|BUILD_DIR>");
	process.exit(2);
}
const dir = ["bug", "fixed"].includes(side)
	? join("out/pairs", issue, side, "excalidraw-app/build")
	: side;
const { scenario } = await import(`./${issue}.mjs`);
const { origin, server } = await serve(dir);
const browser = await chromium.launch();
let code = 2;
try {
	const context = await browser.newContext({
		serviceWorkers: "block",
		viewport: { width: 1280, height: 720 },
	});
	// Nothing leaves loopback.
	await context.route("**/*", (route) =>
		new URL(route.request().url()).origin === origin
			? route.continue()
			: route.abort("blockedbyclient"),
	);
	const page = await context.newPage();
	const errors = [];
	page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
	page.on("pageerror", (e) => errors.push(String(e.message)));
	await page.goto(origin);
	await page.locator(".excalidraw").first().waitFor({ timeout: 15_000 });
	const result = await scenario(page, { errors });
	console.log(
		`issue ${issue} ${side}: ${result.right ? "right" : "wrong"} (${result.observed})`,
	);
	code = result.right ? 0 : 1;
} catch (error) {
	console.error(
		`issue ${issue} ${side}: undecided: ${String(error.message).split("\n")[0]}`,
	);
} finally {
	await browser.close();
	server.close();
}
process.exit(code);

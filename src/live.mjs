import { realpath } from "node:fs/promises";
import { createServer } from "node:http";
import {
	mediaType,
	readArtifact,
	replayPage,
	snapshot,
} from "../ui/render.mjs";

export async function startLive(runDir, { host = "127.0.0.1" } = {}) {
	if (host !== "127.0.0.1") throw new Error("Live host must be IPv4 loopback");
	const root = await realpath(runDir);
	const page = await replayPage(null, true);
	const server = createServer(async (req, res) => {
		res.setHeader("Cache-Control", "no-store");
		res.setHeader("X-Content-Type-Options", "nosniff");
		res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
		res.setHeader("X-Frame-Options", "DENY");
		if (req.headers.host !== `${host}:${server.address().port}`)
			return res.writeHead(403).end();
		if (!["GET", "HEAD"].includes(req.method))
			return res.writeHead(405, { Allow: "GET, HEAD" }).end();
		try {
			let type, body;
			if (req.url === "/") {
				type = "text/html; charset=utf-8";
				body = page;
			} else if (req.url === "/run.json?view=replay") {
				type = "application/json";
				body = JSON.stringify(await snapshot(root, false));
			} else {
				// All run-supplied files, including HTML and scripts, are inert.
				const path = decodeURIComponent(
					req.url.split("?")[0].replace(/^\/(?:media\/)?/, ""),
				);
				type =
					mediaType(path) ??
					(path.endsWith(".json")
						? "application/json"
						: "text/plain; charset=utf-8");
				res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
				body = await readArtifact(root, path);
			}
			res.writeHead(200, { "Content-Type": type });
			res.end(req.method === "HEAD" ? undefined : body);
		} catch (error) {
			const invalidSnapshot =
				req.url === "/run.json?view=replay" && error.code !== "ENOENT";
			res.writeHead(invalidSnapshot ? 422 : 404).end();
		}
	});
	await new Promise((resolve, reject) =>
		server.once("error", reject).listen(0, host, resolve),
	);
	const address = server.address();
	return {
		origin: `http://${host}:${address.port}`,
		address,
		close: () =>
			new Promise((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
				server.closeAllConnections();
			}),
	};
}

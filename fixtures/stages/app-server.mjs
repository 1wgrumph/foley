import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export async function serveApp(root, links = {}) {
	const requests = [];
	const server = createServer((req, res) => {
		requests.push(req.url);
		if (req.url === "/" || req.url === "/index.html") {
			res.setHeader("content-type", "text/html; charset=utf-8");
			res.end(
				readFileSync(join(root, "index.html"), "utf8")
					.replace("__DECOY_ORIGIN__", links.decoy ?? "#")
					.replace(
						"__FILE_URL__",
						links.file ? pathToFileURL(links.file).href : "#",
					),
			);
		} else if (req.url === "/logic.mjs") {
			res.setHeader("content-type", "text/javascript");
			res.end(readFileSync(join(root, "logic.mjs")));
		} else if (req.url === "/download.txt") {
			res.setHeader("content-disposition", "attachment; filename=fixture.txt");
			res.end("synthetic download");
		} else {
			res.writeHead(404).end();
		}
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	return {
		origin: `http://127.0.0.1:${server.address().port}`,
		requests,
		async close() {
			const closed = new Promise((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve())),
			);
			server.closeAllConnections();
			await closed;
		},
	};
}

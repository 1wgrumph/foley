import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const here = (name) => new URL(name, import.meta.url);
const [template, css, js] = await Promise.all(
	["replay.html", "replay.css", "player.js"].map((path) =>
		readFile(here(path), "utf8"),
	),
);
const hash = createHash("sha256").update(js).digest("base64");
const page = template
	.replace("@@SCRIPT_HASH@@", hash)
	.replace("@@CSS@@", () => css)
	.replace("@@JS@@", () => js);
await mkdir(here("dist/"), { recursive: true });
await writeFile(here("dist/replay.html"), page);

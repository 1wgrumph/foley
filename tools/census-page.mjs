#!/usr/bin/env node
// Writes the census index page from a rows file.
//   node tools/census-page.mjs <rows.json> <index.html> [heading]
// An issue links to ../runs/<issue>/replay.html when that file exists beside
// the page's folder.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { censusPage } from "../ui/census.mjs";

const [rowsPath, pagePath, heading = "Foley census backlog"] =
	process.argv.slice(2);
if (!rowsPath || !pagePath) {
	console.error("usage: census-page.mjs <rows.json> <index.html> [heading]");
	process.exit(2);
}
const rows = JSON.parse(readFileSync(rowsPath, "utf8"));
const runs = join(dirname(resolve(pagePath)), "..", "runs");
writeFileSync(
	pagePath,
	censusPage(rows, {
		heading,
		note: "Generated from the backlog report and the run folders.",
		replayHref: (issue) =>
			existsSync(join(runs, String(issue), "replay.html"))
				? `../runs/${issue}/replay.html`
				: null,
	}),
);
console.log(`census page written: ${pagePath} (${rows.length} issues)`);

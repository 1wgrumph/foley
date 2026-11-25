// Pause a real CLI after an external filesystem commit, before returning to the
// product caller. Parent observes stdout readiness, then kills the process group.
import fs from "node:fs";
import fsp from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";

const cut = process.env.FOLEY_TEST_CUT;
const out = join(process.cwd(), "out");
const runPath = join(out, "runs", "1", "run.json");
const ledgerPath = join(out, "ledger.json");
const pause = async () => {
	await new Promise((resolve) => process.stdout.write("W3R-CUT\n", resolve));
	process.kill(process.pid, "SIGSTOP");
	await new Promise(() => {});
};

if (cut === "settled") {
	const unlink = fsp.unlink;
	fsp.unlink = async (path, ...args) => {
		await unlink(path, ...args);
		if (path !== `${ledgerPath}.lock`) return;
		const ledger = JSON.parse(await fsp.readFile(ledgerPath, "utf8"));
		if (ledger.settled > 0 && ledger.open.length === 0) await pause();
	};
} else if (cut === "finished") {
	const rename = fsp.rename;
	fsp.rename = async (from, to, ...args) => {
		await rename(from, to, ...args);
		if (to !== runPath) return;
		const run = JSON.parse(await fsp.readFile(runPath, "utf8"));
		if (run.state === "finished") await pause();
	};
} else if (cut === "cache-read") {
	const report = (path) => {
		if (path === process.env.FOLEY_TEST_INVALID_CACHE)
			process.stdout.write("W3R-FULL-READ\n");
	};
	const readFileSync = fs.readFileSync;
	fs.readFileSync = (path, ...args) => {
		report(path);
		return readFileSync(path, ...args);
	};
	const readFile = fsp.readFile;
	fsp.readFile = (path, ...args) => {
		report(path);
		return readFile(path, ...args);
	};
	const stream = fs.createReadStream;
	fs.createReadStream = (path, options, ...args) => {
		if (options?.end === undefined) report(path);
		return stream(path, options, ...args);
	};
}
syncBuiltinESMExports();

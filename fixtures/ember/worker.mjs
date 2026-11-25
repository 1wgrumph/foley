// Product calls run in independent OS processes with only synthetic credentials.
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";

const nativeFetch = globalThis.fetch;
const unexpected = [];
const redirectViolations = [];
const allowed = new URL(process.env.FOLEY_EMBER_BASE_URL);
globalThis.fetch = (input, init) => {
	const url = new URL(input.url ?? input);
	if ((init?.redirect ?? input.redirect) !== "error")
		redirectViolations.push(url.pathname);
	if (url.origin !== allowed.origin) {
		unexpected.push(url.origin);
		throw new Error("Unexpected network destination");
	}
	return nativeFetch(input, { ...init, redirect: "error" });
};

const { callEmber } = await import("../../src/ember.mjs");
process.once("message", async ({ options, fault }) => {
	try {
		if (fault === "settlement-rename") {
			const rename = fs.rename;
			const ledger = join(process.cwd(), "out", "ledger.json");
			fs.rename = async (from, to) => {
				await rename(from, to);
				if (to !== ledger) return;
				const state = JSON.parse(await fs.readFile(ledger, "utf8"));
				if (state.settled > 0 && state.open.length === 0) {
					// Stop at the external commit boundary, while the product still holds its lock.
					process.send({ type: "transaction" });
					await new Promise(() => {});
				}
			};
			syncBuiltinESMExports();
		}
		const result = await callEmber(options);
		process.send({ type: "result", result, unexpected, redirectViolations });
	} catch (error) {
		process.send({ type: "error", name: error.name });
		process.exitCode = 1;
	} finally {
		process.disconnect();
	}
});
process.send({ type: "ready" });

// Product calls run in independent OS processes with only a synthetic credential.
const nativeFetch = globalThis.fetch;
const unexpected = [];
const allowed = new URL(process.env.FOLEY_EMBER_BASE_URL);
globalThis.fetch = (input, init) => {
	const url = new URL(input.url ?? input);
	if (url.origin !== allowed.origin) {
		unexpected.push(url.origin);
		throw new Error("Unexpected network destination");
	}
	return nativeFetch(input, { ...init, redirect: "error" });
};

const { callEmber } = await import("../../src/ember.mjs");
process.once("message", async (options) => {
	try {
		const result = await callEmber(options);
		process.send({ type: "result", result, unexpected });
	} catch (error) {
		process.send({ type: "error", name: error.name });
		process.exitCode = 1;
	} finally {
		process.disconnect();
	}
});
process.send({ type: "ready" });

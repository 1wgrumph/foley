// Child runner guard: any model request can only reach a loopback HTTP server.
const nativeFetch = globalThis.fetch;
const modelOrigin = process.env.FOLEY_EMBER_BASE_URL
	? new URL(process.env.FOLEY_EMBER_BASE_URL).origin
	: null;
globalThis.fetch = (input, init) => {
	const url = new URL(input.url ?? input);
	if (url.protocol !== "http:" || url.hostname !== "127.0.0.1")
		throw new Error("Non-loopback fetch blocked by fixture");
	if (
		url.origin === modelOrigin &&
		(init?.redirect ?? input.redirect) !== "error"
	)
		throw new Error("Model caller omitted redirect error policy");
	return nativeFetch(input, { ...init, redirect: "error" });
};

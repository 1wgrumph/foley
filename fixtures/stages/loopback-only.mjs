// Child runner guard: any model request can only reach a loopback HTTP server.
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
	const url = new URL(input.url ?? input);
	if (url.protocol !== "http:" || url.hostname !== "127.0.0.1")
		throw new Error("Non-loopback fetch blocked by fixture");
	return nativeFetch(input, { ...init, redirect: "error" });
};

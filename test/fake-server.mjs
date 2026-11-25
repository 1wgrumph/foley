import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

export const sampleUsage = {
	prompt_tokens: 1000,
	completion_tokens: 200,
	prompt_tokens_details: { cached_tokens: 500 },
	completion_tokens_details: { reasoning_tokens: 120 },
};

const answer = JSON.stringify({ answer: "ok" });

export async function startFakeServer(script = [{ mode: "ok" }]) {
	const requests = [];
	const arrivals = new EventEmitter();
	const held = new Map();
	const server = createServer(async (req, res) => {
		const chunks = [];
		try {
			for await (const chunk of req) chunks.push(chunk);
		} catch {
			return;
		}
		const raw = Buffer.concat(chunks).toString("utf8");
		let body;
		try {
			body = JSON.parse(raw);
		} catch {
			body = raw;
		}
		const index = requests.length;
		requests.push({
			method: req.method,
			url: req.url,
			headers: req.headers,
			body,
			receivedAt: Date.now(),
		});
		const reply = script[index] ?? { mode: "unexpected" };
		const respond = () => {
			if (res.destroyed) return;
			res.setHeader("Content-Type", "application/json");
			if (
				req.method !== "POST" ||
				!["/v1/chat/completions", "/v1/responses"].includes(req.url)
			) {
				res.writeHead(404).end("{}");
				return;
			}
			const usage = reply.usage ?? sampleUsage;
			const output =
				req.url === "/v1/responses"
					? {
							output: [
								{
									type: "message",
									role: "assistant",
									content: [{ type: "output_text", text: answer }],
								},
							],
						}
					: { choices: [{ message: { role: "assistant", content: answer } }] };
			switch (reply.mode) {
				case "ok":
					res.end(JSON.stringify({ ...output, usage }));
					break;
				case "missing_usage":
					res.end(JSON.stringify(output));
					break;
				case "invalid_output":
					res.end(JSON.stringify({ usage }));
					break;
				case "malformed_json":
					res.end('{"choices":');
					break;
				case "rate_limited":
					res.writeHead(429, { "Retry-After": reply.retryAfter ?? "0" });
					res.end(JSON.stringify({ error: { message: "Rate limited" } }));
					break;
				case "api_error":
				case "refused_input":
					res.writeHead(reply.mode === "api_error" ? 500 : 400);
					// Echo the submitted credential to prove the client sanitizes upstream errors.
					res.end(
						JSON.stringify({ error: { message: req.headers.authorization } }),
					);
					break;
				case "slow":
					break; // Remain open until the caller times out or cleanup closes the socket.
				default:
					res
						.writeHead(500)
						.end(JSON.stringify({ error: "Unexpected request" }));
			}
		};
		if (reply.hold) held.set(index, respond);
		else respond();
		arrivals.emit("request");
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	return {
		baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
		requests,
		async waitForRequests(count, timeoutMs = 15000) {
			const signal = AbortSignal.timeout(timeoutMs);
			while (requests.length < count)
				await once(arrivals, "request", { signal });
		},
		release(index) {
			assert.ok(held.has(index), "No held response for request");
			const respond = held.get(index);
			held.delete(index);
			respond();
		},
		async close() {
			const closed = new Promise((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve())),
			);
			server.closeAllConnections();
			await closed;
		},
	};
}

// Direct invocation is a smoke run, not a product test.
if (
	process.argv[1] &&
	pathToFileURL(process.argv[1]).href === import.meta.url
) {
	const server = await startFakeServer([
		{ mode: "ok" },
		{ mode: "ok" },
		{ mode: "rate_limited" },
		{ mode: "api_error" },
		{ mode: "malformed_json" },
		{ mode: "missing_usage" },
		{ mode: "invalid_output" },
		{ mode: "refused_input" },
		{ mode: "slow" },
		{ mode: "ok", hold: true },
	]);
	const send = (
		endpoint = "chat/completions",
		signal = AbortSignal.timeout(15000),
	) =>
		fetch(`${server.baseUrl}/${endpoint}`, {
			method: "POST",
			body: JSON.stringify({ model: "muse-ember-1.0" }),
			headers: { "Content-Type": "application/json" },
			signal,
		});
	try {
		assert.deepEqual((await (await send()).json()).usage, sampleUsage);
		assert.ok((await (await send("responses")).json()).output);
		assert.equal((await send()).status, 429);
		assert.equal((await send()).status, 500);
		await assert.rejects(async () => (await send()).json(), SyntaxError);
		assert.equal((await (await send()).json()).usage, undefined);
		assert.equal((await (await send()).json()).choices, undefined);
		assert.equal((await send()).status, 400);
		const abort = new AbortController();
		const slow = send("chat/completions", abort.signal);
		const aborted = assert.rejects(slow, { name: "AbortError" });
		await server.waitForRequests(9);
		abort.abort();
		await aborted;
		const held = send();
		await server.waitForRequests(10);
		server.release(9);
		assert.equal((await held).status, 200);
		assert.equal(server.requests.length, 10);
		assert.ok(
			server.requests.every(
				(request) => request.body.model === "muse-ember-1.0",
			),
		);
		console.log("fake-server smoke: 10 scripted requests passed");
	} finally {
		await server.close();
	}
}

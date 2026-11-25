import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	archive,
	cleanEnv,
	localEnv,
	modelReply,
	readJson,
	sha256,
	syntheticKey,
	temporary,
	wirePrice,
	withEmber,
} from "../../test/stages/support.mjs";
import { fixtureRun, pixel } from "../../test/ui/support.mjs";

assert.equal(cleanEnv().FOLEY_TEST_API_KEY, syntheticKey);
for (const env of [cleanEnv(), localEnv()])
	assert.equal(env.MODEL_API_KEY, undefined);
assert.equal(localEnv().FOLEY_TEST_API_KEY, undefined);

const usage = { prompt_tokens: 10, completion_tokens: 20 };
await temporary(async (root) => {
	const runDir = join(root, "run");
	fixtureRun(runDir);
	const png = readFileSync(join(runDir, "screenshots", "step-1.png"));
	const request = {
		messages: [
			{
				role: "user",
				content: [
					{ type: "text", text: "Synthetic frame control" },
					{
						type: "image_url",
						image_url: { url: `data:image/png;base64,${pixel}` },
					},
				],
			},
		],
		max_output_tokens: 1024,
		caseId: "fixture",
	};
	await withEmber(
		root,
		[
			modelReply(archive),
			modelReply(archive, { hold: true }),
			{
				mode: "ok",
				content: JSON.stringify({ answer: "wire content" }),
				usage,
			},
			{ mode: "ok", content: null, usage },
		],
		async ({ server, protocolCall, callEmber, ledger, trace }) => {
			const video = {
				...request,
				messages: [
					{
						role: "user",
						content: [
							{
								type: "video_url",
								video_url: { url: "data:video/mp4;base64,YQ==" },
							},
						],
					},
				],
			};
			assert.deepEqual((await protocolCall(video)).output, archive);
			const running = callEmber(request);
			running.catch(() => {});
			await server.waitForRequests(2);
			const sent = server.requests[1];
			assert.equal(sent.body.max_completion_tokens, 1024);
			const reservation = ledger().open[0];
			assert.equal(reservation.upperBound, wirePrice(sent.body));
			assert.ok(reservation.upperBound > 512);
			server.release(1);
			assert.deepEqual(await running, { status: "ok", output: archive });
			const event = trace().find(
				(entry) =>
					entry.callId === reservation.callId && entry.type === "request",
			);
			assert.equal(event.request_digest, sha256(sent.raw));
			assert.equal(event.cost_micro_usd, 11);
			assert.notEqual(event.bound_violated, true);
			const stored = readJson(
				join(root, "out", "prompts", `${event.request_digest}.json`),
			);
			assert.ok(JSON.stringify(stored).includes(sha256(png)));
			assert.ok(!JSON.stringify(stored).includes(pixel));
			assert.deepEqual(await callEmber(request), {
				status: "ok",
				output: { answer: "wire content" },
			});
			assert.equal((await callEmber(request)).status, "malformed_output");
			assert.equal(ledger().settled, 33);
			assert.equal(ledger().open.length, 0);
			for (const [i, observed] of server.requests.entries()) {
				assert.equal(observed.headers.authorization, `Bearer ${syntheticKey}`);
				if (i > 0)
					assert.ok(
						server.requests[i - 1].completedOrder < observed.startedOrder,
					);
			}
			console.log(
				"stage support: protocol and real Ember, four loopback requests; framed reservation and exact digest verified; settled 33 micro-dollars",
			);
		},
	);
});

// The single-attempt reproduction budget must refuse on case headroom,
// rather than on a provider usage overrun or on omitted wire framing.
await temporary((root) =>
	withEmber(
		root,
		[
			modelReply(archive, {
				usage: { prompt_tokens: 10, completion_tokens: 6000 },
			}),
		],
		async ({ server, callEmber, ledger, trace }) => {
			const request = {
				messages: [
					{
						role: "user",
						content: [
							{
								type: "text",
								text: "Synthetic observe-act control ".repeat(100),
							},
							{
								type: "image_url",
								image_url: { url: `data:image/png;base64,${pixel}` },
							},
						],
					},
				],
				max_output_tokens: 6000,
				caseId: "single-attempt-budget",
				caseBudget: 5500,
			};
			assert.equal((await callEmber(request)).status, "ok");
			assert.ok(wirePrice(server.requests[0].body) <= request.caseBudget);
			assert.equal(ledger().settled, 3001);
			assert.equal((await callEmber(request)).status, "budget_refused");
			assert.equal(server.requests.length, 1);
			assert.ok(!trace().some((event) => event.bound_violated === true));
			console.log(
				"stage support: framed first attempt settles 3001; second refuses within case budget 5500",
			);
		},
	),
);

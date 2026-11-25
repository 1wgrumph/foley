import assert from "node:assert/strict";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	truncateSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
	boundedPng,
	clip,
	fixture,
	modelReply,
	product,
	readJson,
	readLines,
	runCommand,
	temporary,
	withEmber,
} from "../support.mjs";

const truth = readJson(fixture("recordings", "owned-basic-flow.truth.json"));
const document = {
	schema: "foley.steps/1",
	steps: truth.steps.map(({ order, t_s, action, target, value }) => ({
		order,
		t_s,
		action,
		target: target ?? value,
		...(value !== undefined && { value }),
	})),
	predicate: null,
};
const videoProbe = {
	video: { accepted: true, tokensPerSecond: 100 },
	audio: { accepted: false },
};
const frameProbe = { video: { accepted: false }, audio: { accepted: false } };
function parts(server) {
	return server.requests.flatMap((request) =>
		request.body.messages.flatMap((message) =>
			Array.isArray(message.content) ? message.content : [],
		),
	);
}

async function checkWatch({ watch, validateSteps, path, root, model, probe }) {
	const runDir = join(root, "run");
	mkdirSync(runDir);
	const result = await watch(path, {
		runDir,
		callEmber: model,
		probe,
		caseId: "watch-test",
		caseBudget: 100000,
	});
	assert.equal(result.status, "ok");
	assert.equal(validateSteps(result.document), true);
	assert.deepEqual(readJson(join(runDir, "steps.json")), result.document);
	for (const item of truth.steps.filter((step) => step.required)) {
		const found = result.document.steps.find(
			(step) =>
				step.action === item.action &&
				step.t_s === item.t_s &&
				step.value === item.value,
		);
		assert.ok(found, `Required action missing at ${item.t_s}`);
	}
	assert.deepEqual(
		result.document.steps.map((step) => step.t_s),
		[...result.document.steps.map((step) => step.t_s)].sort((a, b) => a - b),
	);
	assert.ok(
		readLines(join(runDir, "watch.trace.jsonl")).some(
			(event) => event.path === result.document.mediaPath,
		),
	);
	return result.document;
}

test("TC-R04-1", { timeout: 120000 }, async () => {
	const watch = await product("src/watch.mjs", "watch");
	const validateSteps = await product("src/run-schema.mjs", "validateSteps");
	for (const refused of [true, false]) {
		await temporary((root) =>
			withEmber(
				root,
				refused
					? [{ mode: "refused_input" }, modelReply(document)]
					: [modelReply(document)],
				async ({ server, protocolCall }) => {
					const output = await checkWatch({
						watch,
						validateSteps,
						path: clip,
						root,
						model: protocolCall,
						probe: videoProbe,
					});
					const sent = parts(server);
					assert.ok(
						sent.some((part) => part.type === "video_url"),
						"Bounded video was not tried",
					);
					const images = sent.filter((part) => part.type === "image_url");
					assert.equal(output.mediaPath, refused ? "frames" : "video");
					if (!refused) {
						assert.equal(images.length, 0);
						return;
					}
					assert.ok(
						images.length >= Math.floor(truth.duration_s) &&
							images.length <= Math.ceil(truth.duration_s),
					);
					assert.ok(images.length <= 40);
					for (const image of images) {
						const bytes = boundedPng(image.image_url.url);
						const probe = JSON.parse(
							runCommand(
								"ffprobe",
								[
									"-v",
									"error",
									"-show_entries",
									"stream=width,height",
									"-of",
									"json",
									"pipe:0",
								],
								{ input: bytes },
							),
						);
						assert.equal(probe.streams[0].width, 1280);
						assert.ok(probe.streams[0].height <= 1280);
					}
				},
			),
		);
	}
	// Structurally valid JSON, but not valid steps: one re-ask carries the
	// validation error; a second invalid reply is malformed_output, and a valid
	// one is accepted.
	for (const second of [{ steps: "not-an-array" }, document])
		await temporary((root) =>
			withEmber(
				root,
				[modelReply({ steps: "not-an-array" }), modelReply(second)],
				async ({ callEmber, server }) => {
					const runDir = join(root, "run");
					mkdirSync(runDir);
					const result = await watch(clip, {
						runDir,
						callEmber,
						probe: frameProbe,
						caseId: "watch-invalid",
					});
					assert.equal(
						result.status,
						second === document ? "ok" : "malformed_output",
					);
					assert.equal(server.requests.length, 2);
					const reask = server.requests[1].body.messages.at(-1);
					assert.equal(reask.role, "user");
					assert.match(reask.content, /failed validation: .*steps/);
				},
			),
		);
});

test("TC-R04-2", { timeout: 120000 }, async () => {
	const watch = await product("src/watch.mjs", "watch");
	await temporary((root) =>
		withEmber(
			root,
			[
				modelReply({
					...document,
					steps: document.steps.filter((step) => step.t_s <= 10),
				}),
			],
			async ({ server, callEmber }) => {
				const runDir = join(root, "run");
				mkdirSync(runDir);
				const wrongType = join(root, "wrong.avi");
				const oversized = join(root, "oversized.mp4");
				const overlong = join(root, "overlong.mp4");
				const broken = join(root, "broken.mp4");
				runCommand("ffmpeg", [
					"-v",
					"error",
					"-f",
					"lavfi",
					"-i",
					"color=size=16x16:rate=1:duration=1",
					"-c:v",
					"mpeg4",
					wrongType,
				]);
				copyFileSync(clip, oversized);
				truncateSync(oversized, 51 * 1024 * 1024);
				runCommand("ffmpeg", [
					"-v",
					"error",
					"-f",
					"lavfi",
					"-i",
					"color=size=16x16:rate=1:duration=121",
					"-c:v",
					"libx264",
					"-threads",
					"1",
					overlong,
				]);
				writeFileSync(broken, readFileSync(clip).subarray(0, 32));
				for (const input of [wrongType, oversized, overlong, broken]) {
					const result = await watch(input, {
						runDir,
						callEmber,
						probe: frameProbe,
						caseId: "watch-invalid",
					});
					assert.equal(result.status, "refused_input");
					assert.equal(server.requests.length, 0);
				}
				const valid = join(root, "valid.mp4");
				runCommand("ffmpeg", [
					"-v",
					"error",
					"-i",
					clip,
					"-t",
					"10",
					"-c",
					"copy",
					valid,
				]);
				const result = await watch(valid, {
					runDir,
					callEmber,
					probe: frameProbe,
					caseId: "watch-valid",
					caseBudget: 100000,
				});
				assert.equal(result.status, "ok");
				assert.ok(server.requests.length > 0);
			},
		),
	);
});

test("TC-R04-6", { timeout: 120000 }, async () => {
	const watch = await product("src/watch.mjs", "watch");
	await temporary((root) =>
		withEmber(root, [modelReply(document)], async ({ server, callEmber }) => {
			const runDir = join(root, "run");
			mkdirSync(runDir);
			const result = await watch(clip, {
				runDir,
				callEmber,
				probe: {
					...frameProbe,
					audio: { accepted: true, tokensPerSecond: 100 },
				},
				caseId: "watch-silent",
				caseBudget: 100000,
				reportTitle: "Eraser shortcut ends the line tool",
				appNotes: "E or 0 eraser",
			});
			assert.ok(
				parts(server).some(
					(part) => part.type === "text" && part.text.includes("E or 0 eraser"),
				),
				"Target app notes reach the model as data",
			);
			assert.equal(result.status, "ok");
			// The issue title reaches the model as quoted data (S5 live miss).
			assert.ok(
				parts(server).some(
					(part) =>
						part.type === "text" &&
						part.text.includes('"Eraser shortcut ends the line tool"'),
				),
			);
			assert.equal(result.document.narration, undefined);
			assert.equal(result.document.transcript, undefined);
			assert.ok(parts(server).some((part) => part.type === "image_url"));
			assert.ok(!parts(server).some((part) => part.type.includes("audio")));
		}),
	);
});

// W4-11: every string of a steps document passes the one credential filter
// before it is kept, and a refused reply is never sent back to the model.
test("TC-R04-2/credential-field", { timeout: 120000 }, async () => {
	const watch = await product("src/watch.mjs", "watch");
	const shaped = ["ghp_", "A".repeat(36)].join("");
	const leaking = {
		...document,
		steps: document.steps.map((step, i) =>
			i === 0 ? { ...step, target: `button ${shaped}` } : step,
		),
	};
	await temporary((root) =>
		withEmber(
			root,
			[modelReply(leaking), modelReply(leaking)],
			async ({ callEmber, server }) => {
				const runDir = join(root, "run");
				mkdirSync(runDir);
				const result = await watch(clip, {
					runDir,
					callEmber,
					probe: frameProbe,
					caseId: "watch-credential",
					caseBudget: 100000,
				});
				assert.equal(result.status, "malformed_output");
				assert.equal(existsSync(join(runDir, "steps.json")), false);
				assert.equal(server.requests.length, 2);
				assert.ok(
					!JSON.stringify(server.requests[1].body).includes(shaped),
					"Refused text was sent back",
				);
			},
		),
	);
});

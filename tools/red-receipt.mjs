#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

function checkIds(ids) {
	assert.ok(ids.length > 0, "No expected test ids");
	assert.equal(new Set(ids).size, ids.length, "Duplicate expected test id");
	for (const id of ids) assert.match(id, /^TC-[A-Z0-9-]+$/);
	return [...ids].sort();
}

// Node's TAP reporter emits one unindented result per test and an indented
// diagnostic block for failures. Require the actual assertion error code.
function checkTap(log, ids, green) {
	assert.match(log, /^TAP version 13\r?$/m);
	const results = [
		...log.matchAll(/^(not ok|ok) (\d+) - (TC-[A-Z0-9-]+)(?: [^\r\n]*)?\r?$/gm),
	];
	const allResults = [...log.matchAll(/^(?:not ok|ok) \d+ - /gm)];
	assert.equal(allResults.length, ids.length, "Unexpected test result count");
	assert.deepEqual(checkIds(results.map((result) => result[3])), checkIds(ids));
	for (const [index, result] of results.entries()) {
		assert.equal(Number(result[2]), index + 1, "Nonsequential test result");
		assert.doesNotMatch(result[0], /#\s+(?:SKIP|TODO)\b/i);
		assert.equal(
			result[1],
			green ? "ok" : "not ok",
			`Wrong outcome for ${result[3]}`,
		);
		const diagnostic = log.slice(
			result.index,
			results[index + 1]?.index ?? log.length,
		);
		if (!green) {
			assert.match(diagnostic, /^\s+failureType: ['"]testCodeFailure['"]\r?$/m);
			assert.match(
				diagnostic,
				/^\s+code: ['"]ERR_ASSERTION['"]\r?$/m,
				`${result[3]} did not fail on an assertion`,
			);
			assert.match(diagnostic, /^\s+name: ['"]AssertionError['"]\r?$/m);
		}
	}
	const summary = (field, expected) =>
		assert.match(log, new RegExp(`^# ${field} ${expected}\\r?$`, "m"));
	assert.match(log, new RegExp(`^1\\.\\.${ids.length}\\r?$`, "m"));
	summary("tests", ids.length);
	summary("pass", green ? ids.length : 0);
	summary("fail", green ? 0 : ids.length);
	for (const field of ["cancelled", "skipped", "todo"]) summary(field, 0);
}

try {
	const args = process.argv.slice(2);
	if (args.length === 3 && args[1] === "--expect-ids") {
		const [logPath, , idsPath] = args;
		const ids = readFileSync(idsPath, "utf8").trim().split(/\s+/);
		const log = readFileSync(logPath);
		checkTap(log.toString("utf8"), ids, false);
		assert.ok(logPath.endsWith(".log"), "Expected a .log file");
		const receiptPath = logPath.replace(/\.log$/, ".receipt.json");
		const receipt = {
			status: "red",
			log: basename(logPath),
			log_sha256: createHash("sha256").update(log).digest("hex"),
			ids,
		};
		writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
		console.log(
			`red receipt: ${ids.length} assertion failures; sha256 ${receipt.log_sha256}`,
		);
	} else if (
		args.length === 4 &&
		args[0] === "--green" &&
		args[2] === "--same-ids"
	) {
		const [, logPath, , receiptPath] = args;
		const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
		assert.equal(receipt.status, "red");
		assert.match(receipt.log_sha256, /^[a-f0-9]{64}$/);
		checkTap(readFileSync(logPath, "utf8"), receipt.ids, true);
		console.log(`green receipt: all ${receipt.ids.length} red ids pass`);
	} else {
		throw new Error(
			"usage: red-receipt.mjs LOG --expect-ids IDS | --green LOG --same-ids RECEIPT",
		);
	}
} catch (error) {
	console.error(`receipt rejected: ${error.message}`);
	process.exitCode = 1;
}

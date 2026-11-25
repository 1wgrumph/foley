import { runTest } from "./test-process.mjs";

const args = process.argv.slice(2);
if (!args.length) {
	console.error("usage: concurrent2.mjs TEST_ARGS...");
	process.exitCode = 2;
} else {
	const results = await Promise.all([
		runTest(args, "copy 1"),
		runTest(args, "copy 2"),
	]);
	console.log(`concurrent2: ${results.filter(Boolean).length}/2 passed`);
	process.exitCode = results.every(Boolean) ? 0 : 1;
}

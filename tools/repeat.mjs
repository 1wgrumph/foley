import { runTest } from "./test-process.mjs";

const [count, ...args] = process.argv.slice(2);
const n = Number(count);
if (!Number.isSafeInteger(n) || n < 1 || !args.length) {
	console.error("usage: repeat.mjs COUNT TEST_ARGS...");
	process.exitCode = 2;
} else {
	let passed = 0;
	for (let i = 1; i <= n; i++) {
		if (await runTest(args, `repeat ${i}/${n}`)) passed++;
	}
	console.log(`repeat: ${passed}/${n} passed`);
	process.exitCode = passed === n ? 0 : 1;
}

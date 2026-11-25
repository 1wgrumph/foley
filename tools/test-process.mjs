import { spawn } from "node:child_process";

export async function runTest(args, label) {
	const child = spawn(process.execPath, ["--test", ...args], {
		detached: true,
		stdio: ["ignore", "pipe", "pipe"],
		env: {
			PATH: process.env.PATH,
			HOME: process.env.HOME,
			FOLEY_OFFLINE: "1",
			MODEL_API_KEY: "synthetic-repeat-only",
			...(process.env.PLAYWRIGHT_BROWSERS_PATH && {
				PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH,
			}),
		},
	});
	let output = "";
	child.stdout.on("data", (chunk) => {
		output += chunk.toString();
	});
	child.stderr.on("data", (chunk) => {
		output += chunk.toString();
	});
	const timeout = setTimeout(() => {
		try {
			process.kill(-child.pid, "SIGKILL");
		} catch (error) {
			if (error.code !== "ESRCH") throw error;
		}
	}, 300000);
	timeout.unref();
	try {
		const result = await new Promise((resolve, reject) => {
			child.once("error", reject);
			child.once("close", (code, signal) => resolve({ code, signal }));
		});
		console.log(
			`--- ${label}: exit=${result.code} signal=${result.signal ?? "none"} ---\n${output}`,
		);
		return result.code === 0 && result.signal === null;
	} finally {
		clearTimeout(timeout);
	}
}

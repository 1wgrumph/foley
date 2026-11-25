import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import {
	cpSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { serveApp } from "../../fixtures/stages/app-server.mjs";
import { startFakeServer } from "../fake-server.mjs";

export const repo = fileURLToPath(new URL("../../", import.meta.url));
export const fixture = (...parts) => join(repo, "fixtures", ...parts);
export const clip = fixture("recordings", "owned-basic-flow.mp4");
export const syntheticKey = "synthetic-stage-test-only";
export const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
export const writeJson = (path, value) =>
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
export const readLines = (path) =>
	readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
export const sha256 = (value) =>
	createHash("sha256").update(value).digest("hex");
export const archive = readJson(fixture("stages", "archive-steps.json"));
export const proofCode = readFileSync(
	fixture("stages", "generated-test.mjs.txt"),
	"utf8",
);
export const anchor = { file: "logic.mjs", line: 2, term: "Archive" };
export const modelReply = (output, extra = {}) => ({
	mode: "ok",
	output,
	usage: { prompt_tokens: 10, completion_tokens: 20 },
	...extra,
});

export async function product(path, name) {
	const file = join(repo, path);
	assert.ok(existsSync(file), `${path} is not implemented`);
	const mod = await import(new URL(path, new URL("../../", import.meta.url)));
	assert.equal(typeof mod[name], "function", `${path} must export ${name}`);
	return mod[name];
}

export function entry(path) {
	const file = join(repo, path);
	assert.ok(existsSync(file), `${path} is not implemented`);
	return file;
}

export async function temporary(run) {
	const root = mkdtempSync(join(tmpdir(), "foley-stage-"));
	try {
		return await run(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

export function cleanEnv(extra = {}) {
	// No inherited credential or routing configuration reaches a test child.
	return {
		PATH: process.env.PATH,
		HOME: process.env.HOME,
		...(process.env.PLAYWRIGHT_BROWSERS_PATH && {
			PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH,
		}),
		FOLEY_OFFLINE: "1",
		MODEL_API_KEY: syntheticKey,
		...extra,
	};
}

export function runCommand(command, args, options = {}) {
	return execFileSync(command, args, {
		encoding: "utf8",
		timeout: 60000,
		env: cleanEnv(),
		...options,
	});
}

// The only model transport allowed by the test process is the current server.
export async function withEmber(root, script, run) {
	const server = await startFakeServer(script);
	const cwd = process.cwd();
	const nativeFetch = globalThis.fetch;
	const attempted = [];
	process.chdir(root);
	process.env.FOLEY_OFFLINE = "1";
	process.env.MODEL_API_KEY = syntheticKey;
	process.env.FOLEY_EMBER_BASE_URL = server.baseUrl;
	delete process.env.FOLEY_EMBER_MODEL;
	globalThis.fetch = (input, init) => {
		const url = new URL(input.url ?? input);
		if (url.origin !== new URL(server.baseUrl).origin) {
			attempted.push(url.origin);
			throw new Error("Unexpected network destination");
		}
		return nativeFetch(input, { ...init, redirect: "error" });
	};
	try {
		const { callEmber, recordBaseline } = await import("../../src/ember.mjs");
		if (!existsSync(join(root, "out", "ledger.json"))) await recordBaseline(0);
		await run({
			server,
			callEmber,
			env: cleanEnv({ FOLEY_EMBER_BASE_URL: server.baseUrl }),
			ledger: () => readJson(join(root, "out", "ledger.json")),
			trace: () => readLines(join(root, "out", "trace.jsonl")),
			// The S2 governor currently cannot price video/audio. This adapter tests
			// only the Watch protocol's bounded-video positive and fallback controls.
			async protocolCall(request) {
				const reply = await fetch(`${server.baseUrl}/chat/completions`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ ...request, model: "muse-ember-1.0" }),
					signal: AbortSignal.timeout(15000),
				});
				if (reply.status === 400) return { status: "refused_input" };
				if (!reply.ok) return { status: "api_error" };
				try {
					return {
						status: "ok",
						output: JSON.parse((await reply.json()).choices[0].message.content),
					};
				} catch {
					return { status: "malformed_output" };
				}
			},
		});
		assert.deepEqual(attempted, [], "Unexpected model destination");
	} finally {
		globalThis.fetch = nativeFetch;
		process.chdir(cwd);
		await server.close();
	}
}

export async function withApps(root, run) {
	const decoy = await serveApp(fixture("app-fixed"));
	const outside = join(root, "outside-fixture.txt");
	writeFileSync(outside, "synthetic outside sentinel");
	const bug = await serveApp(fixture("app"), {
		decoy: decoy.origin,
		file: outside,
	});
	const fixed = await serveApp(fixture("app-fixed"), {
		decoy: decoy.origin,
		file: outside,
	});
	try {
		await run({ bug, fixed, decoy, outside });
	} finally {
		await Promise.all([bug.close(), fixed.close(), decoy.close()]);
	}
}

export function pinFixture(root, variant = "app") {
	const target = join(root, variant);
	cpSync(fixture(variant), target, { recursive: true });
	const env = cleanEnv({
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_AUTHOR_NAME: "Fixture",
		GIT_AUTHOR_EMAIL: "fixture@example.invalid",
		GIT_COMMITTER_NAME: "Fixture",
		GIT_COMMITTER_EMAIL: "fixture@example.invalid",
	});
	const git = (...args) =>
		runCommand("git", ["-C", target, ...args], { env }).trim();
	git("init", "-q");
	git("add", ".");
	git("commit", "-qm", "Pin synthetic fixture");
	return { target, revision: git("rev-parse", "HEAD") };
}

export function startChild(args, { cwd, env, timeoutMs = 120000 }) {
	const child = spawn(process.execPath, args, {
		cwd,
		env,
		detached: true,
		stdio: ["ignore", "pipe", "pipe"],
	});
	let stdout = "";
	let stderr = "";
	let result;
	let error;
	child.stdout.on("data", (chunk) => {
		stdout += chunk.toString();
	});
	child.stderr.on("data", (chunk) => {
		stderr += chunk.toString();
	});
	child.on("error", (err) => {
		error = err;
	});
	const done = new Promise((resolve) => {
		child.once("close", (code, signal) => {
			result = { code, signal, stdout, stderr };
			resolve(result);
		});
	});
	const kill = (signal) => {
		if (!child.pid) return;
		try {
			process.kill(-child.pid, signal);
		} catch (error) {
			if (error.code !== "ESRCH") throw error;
		}
	};
	const timer = setTimeout(() => kill("SIGKILL"), timeoutMs);
	timer.unref();
	done.then(() => clearTimeout(timer));
	return {
		child,
		done,
		async waitForOutput(pattern) {
			const signal = AbortSignal.timeout(timeoutMs);
			while (!pattern.test(stdout)) {
				if (error) throw error;
				assert.ok(
					!result && child.exitCode === null && child.signalCode === null,
					"Child exited before readiness",
				);
				await Promise.race([once(child.stdout, "data", { signal }), done]);
			}
			return stdout.match(pattern);
		},
		async stop(signal = "SIGTERM") {
			if (!result) kill(signal);
			const force = setTimeout(() => kill("SIGKILL"), 15000);
			force.unref();
			try {
				return await done;
			} finally {
				clearTimeout(force);
			}
		},
	};
}

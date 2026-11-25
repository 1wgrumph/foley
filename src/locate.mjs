// Locate: steps to file and line anchors through the BRAN media-evidence
// adapter. No model call and no network socket.
import { execFileSync } from "node:child_process";
import { realpathSync, renameSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const crate = fileURLToPath(
	new URL("../foley-crates/bran-media-evidence/", import.meta.url),
);
const targetDirOut = join(crate, "target");
const binary = join(targetDirOut, "debug", "bran-media-evidence");

// Child tools inherit no keys and no GIT_* overrides from the caller.
function childEnv() {
	const env = { PATH: process.env.PATH, HOME: process.env.HOME };
	for (const name of ["CARGO_HOME", "RUSTUP_HOME", "RUSTUP_TOOLCHAIN"]) {
		if (process.env[name]) env[name] = process.env[name];
	}
	return env;
}

function run(command, args, options = {}) {
	return execFileSync(command, args, {
		encoding: "utf8",
		timeout: 120000,
		maxBuffer: 16 * 1024 * 1024,
		stdio: ["ignore", "pipe", "pipe"],
		env: childEnv(),
		...options,
	});
}

// Read-only git plumbing: rev-parse and cat-file run no hooks or filters.
function git(targetDir, ...args) {
	return run("git", ["-C", targetDir, ...args]);
}

function pinnedCommit(targetDir, targetRevision) {
	if (
		typeof targetRevision !== "string" ||
		!/^[0-9a-f]{7,64}$/.test(targetRevision)
	) {
		throw new Error("locate: targetRevision must be a commit id");
	}
	const commit = git(
		targetDir,
		"rev-parse",
		"--verify",
		"--end-of-options",
		`${targetRevision}^{commit}`,
	).trim();
	const head = git(targetDir, "rev-parse", "--verify", "HEAD").trim();
	if (head !== commit) {
		throw new Error(
			`locate: target HEAD ${head} is not the pinned revision ${commit}`,
		);
	}
	return commit;
}

// Anchor files come from scanned target content: refuse anything that could
// leave the target tree before it is used as a path.
function insideTarget(root, file) {
	if (
		typeof file !== "string" ||
		file === "" ||
		isAbsolute(file) ||
		/[\\\0]/.test(file) ||
		file.split("/").some((part) => part === ".." || part === "." || part === "")
	) {
		throw new Error(`locate: anchor path refused: ${JSON.stringify(file)}`);
	}
	const full = resolve(root, file);
	if (!full.startsWith(root + sep)) {
		throw new Error(
			`locate: anchor path leaves the target: ${JSON.stringify(file)}`,
		);
	}
	return file;
}

function checkAnchors(document, targetDir, commit) {
	if (
		document?.schema !== "foley.anchors/1" ||
		!["ok", "miss"].includes(document.status) ||
		!Array.isArray(document.anchors) ||
		(document.status === "miss") !== (document.anchors.length === 0)
	) {
		throw new Error("locate: adapter returned an invalid anchors document");
	}
	const root = realpathSync(targetDir);
	// Untracked files (such as a built page beside the source) are not part of
	// the pinned revision, so they are never reported as anchors.
	const tracked = new Set(
		git(targetDir, "ls-tree", "-r", "--name-only", "-z", commit)
			.split("\0")
			.filter(Boolean),
	);
	const anchors = document.anchors.filter(({ file }) =>
		tracked.has(insideTarget(root, file)),
	);
	const sources = new Map();
	for (const { file, line, term } of anchors) {
		if (!sources.has(file)) {
			sources.set(
				file,
				git(targetDir, "cat-file", "blob", `${commit}:${file}`).split("\n"),
			);
		}
		const text = sources.get(file)[line - 1];
		if (
			!Number.isInteger(line) ||
			typeof term !== "string" ||
			!text?.includes(term)
		) {
			throw new Error(
				`locate: ${file}:${line} does not match the pinned revision`,
			);
		}
	}
	return {
		schema: document.schema,
		status: anchors.length ? "ok" : "miss",
		anchors: anchors.map(({ file, line, term }) => ({
			file,
			line,
			term,
		})),
	};
}

export async function locate(stepsPath, { targetDir, targetRevision, runDir }) {
	const commit = pinnedCommit(targetDir, targetRevision);
	// No-op when the adapter is current; --offline keeps the build off the network.
	run("cargo", [
		"build",
		"--offline",
		"--quiet",
		"--manifest-path",
		join(crate, "Cargo.toml"),
		"--target-dir",
		targetDirOut,
	]);
	const output = run(binary, ["--repo", targetDir, "--steps", stepsPath], {
		env: {},
	});
	const result = checkAnchors(JSON.parse(output), targetDir, commit);
	const file = join(runDir, "anchors.json");
	const partial = `${file}.${process.pid}.tmp`;
	writeFileSync(partial, `${JSON.stringify(result, null, 2)}\n`);
	renameSync(partial, file); // readers never see a half-written file
	return result;
}

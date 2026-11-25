import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
	open,
	readFile,
	realpath,
	rename,
	stat,
	unlink,
	writeFile,
} from "node:fs/promises";
import { extname, join, sep } from "node:path";
import { insideRun, validateRun } from "../src/run-schema.mjs";

const media = new Map(
	Object.entries({
		".png": "image/png",
		".jpg": "image/jpeg",
		".jpeg": "image/jpeg",
		".webp": "image/webp",
		".gif": "image/gif",
		".mp4": "video/mp4",
		".webm": "video/webm",
		".mov": "video/quicktime",
	}),
);

export const mediaType = (path) => media.get(extname(path).toLowerCase());

// Both the exporter and HTTP server read through the same folder boundary.
export async function readArtifact(root, name) {
	if (!insideRun(name) || name.includes(":"))
		throw new Error("Invalid artifact path");
	const path = await realpath(join(root, name));
	if (!path.startsWith(root + sep)) throw new Error("Outside run folder");
	const before = await stat(path);
	if (!before.isFile()) throw new Error("Expected a regular file");
	const handle = await open(
		path,
		constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
	);
	try {
		const actual = await handle.stat();
		const opened =
			process.platform === "linux" ? `/proc/self/fd/${handle.fd}` : path;
		if (
			before.ino !== actual.ino ||
			before.dev !== actual.dev ||
			!(await realpath(opened)).startsWith(root + sep)
		)
			throw new Error("Artifact changed");
		return await handle.readFile();
	} finally {
		await handle.close();
	}
}

async function optional(root, name) {
	try {
		return (await readArtifact(root, name)).toString("utf8");
	} catch (error) {
		if (error.code === "ENOENT") return null;
		throw error;
	}
}

export async function snapshot(root, inline) {
	const run = JSON.parse(await readArtifact(root, "run.json"));
	if (!validateRun(run)) throw new Error("Invalid run document");
	const [proof, replay, census, source] = await Promise.all([
		optional(root, "proof.json"),
		optional(root, "replay.json"),
		optional(root, "census.json"),
		run.test?.path ? optional(root, run.test.path) : null,
	]);
	const assets = Object.create(null);
	const frames = run.frames ?? [];
	const paths = [
		run.recording,
		...frames.map((f) => f.path),
		...(run.replay?.screenshots ?? []).map((f) => f.path),
	];
	for (const name of new Set(paths.filter(Boolean))) {
		if (!insideRun(name)) throw new Error("Invalid media path");
		const type = mediaType(name);
		if (!type) throw new Error("Unsupported media type");
		if (inline) {
			const bytes = await readArtifact(root, name);
			assets[name] = `data:${type};base64,${bytes.toString("base64")}`;
		} else {
			// readArtifact checks the decoded path when the browser requests it.
			assets[name] =
				`/media/${name.split("/").map(encodeURIComponent).join("/")}`;
		}
	}
	const reproduction = JSON.parse(replay);
	const report = JSON.parse(proof);
	const exits = (row) => ({
		reason: row.reason,
		bug: row.bug && { exitCode: row.bug.exitCode },
		fixed: row.fixed && { exitCode: row.fixed.exitCode },
	});
	return {
		run,
		assets,
		source,
		proof: report && {
			status: report.status,
			attempts: (report.attempts ?? []).map(exits),
			rerun_without_ember:
				report.rerun_without_ember && exits(report.rerun_without_ember),
		},
		observed: reproduction?.observed,
		reproStatus: reproduction?.status,
		candidates:
			JSON.parse(census)?.candidates?.map(({ issue, status }) => ({
				issue,
				status,
			})) ?? [],
	};
}

export async function replayPage(data, live = false) {
	const template = await readFile(
		new URL("./dist/replay.html", import.meta.url),
		"utf8",
	);
	const json = JSON.stringify(data).replaceAll("<", "\\u003c");
	return template
		.replace("@@CONNECT@@", live ? "'self'" : "'none'")
		.replace("@@DATA@@", () => json);
}

export async function renderReplay(runDir) {
	const root = await realpath(runDir);
	const page = await replayPage(await snapshot(root, true));
	const temp = join(root, `.replay-${randomUUID()}.tmp`);
	try {
		await writeFile(temp, page, { flag: "wx" });
		await rename(temp, join(root, "replay.html"));
	} finally {
		await unlink(temp).catch((error) => {
			if (error.code !== "ENOENT") throw error;
		});
	}
}

#!/usr/bin/env node
// Public-boundary check (DES-FOL-R11, CMD-PUBLIC).
//   node tools/check-public.mjs --tree <dir>       check what would be published
//   node tools/check-public.mjs --self-test <dir>  each fixture subdirectory must fail with its class
// In a Git work tree, the published set is tracked plus untracked-but-not-ignored
// files; elsewhere every file under <dir> is checked.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";

// Seeded fixtures are meant to fail; the tree check skips them and --self-test runs them.
const SKIP_PREFIXES = ["fixtures/public-negative/"];

const MEDIA_EXT =
	/\.(mp4|webm|mov|mkv|avi|gif|png|jpe?g|webp|svg|mp3|wav|ogg|m4a|flac)$/i;
const PROVENANCE = "media/PROVENANCE.json";

// Placeholder user names used by vendored BRAN tests; any other home path fails.
const PLACEHOLDER_USERS = new Set([
	"user",
	"home-user",
	"example-user",
	"other-user",
	"anyone",
	"someone",
]);
const HOME_PATH = /(?:\/home\/|\/Users\/|[A-Za-z]:\\Users\\)([A-Za-z0-9_.-]+)/g;

const KEY_SHAPES = [
	// A PEM header ends its line or is followed by key data; a bare literal in detector code is not a key.
	/-----BEGIN [A-Z ]*PRIVATE KEY-----(?:\s*$|\\n[A-Za-z0-9+/])/,
	/\b(?:sk-(?:proj-)?|ghp_|gho_|ghs_|github_pat_|xox[bp]-|GOCSPX-)[A-Za-z0-9_-]{20,}/,
	/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
	/\bAIza[0-9A-Za-z_-]{35}\b/,
	// Values that start with "synthetic" are test data by convention (vendored BRAN fixtures use it).
	/\b[A-Za-z0-9_]*(?:api[_-]?key|secret|token)\b["']?\s*[:=]\s*["']?(?!synthetic)[A-Za-z0-9_-]{24,}/i,
];

// Routing terms are kept as SHA-256 of the lower-cased token so this public file does not list them.
const ROUTING_TOKEN_SHA256 = new Set([
	"10396da1dcc03fd51af0faefe6721367a9cce795cfaa836b37fffcae4d5ee442",
	"734c18e84e1defeaf606ed051f8322b791c414237f678870cee68338ae1882aa",
	"6248adb5392378fc53afe1c75d94f9d4087b13cd8376f4250571aeb3513ed44e",
	"4dc999ed60e731a39640cd75a2212daa4d0f57c9633bab41ad769f5c14f0e50c",
	"703a6c0063bafd8fcc6b7ebcec19617d839638d9dc02e068b0371798eff765cd",
	"813b25d694b7bc36fb5fe771e72961b74989d78654d0219f8fecfcbbf6b4d6a0",
	"8814ef5cc6cedbce67c557255f1fa2c608ffc8998bbb2ee4a6a4b327f489634b",
	"b583659b3943624334faec3606b43d0aab6fb25b1bb9b66ae302c0001c197754",
	"949376e86289df076d0faa727914f02974a3ba5f3448372bfa5ab206a7c21565",
	"12824788d1f5b22f052be2de3e153fe992271ad795a5cfbc832f8d8a68e6550b",
	"d364267df993a369c92ed165a40f9b65c39a9eeb10a7cf796b00ab160868d236",
	"3be8755abeba48eb3d8c6a634142b071aa316a266b47043b7c2a9a7521da22ac",
	"d110e2b97f003b80b067e57c4d20b79722c342ecb2d3a30de2aa83f8eb7c57ba",
]);

// Published trace lines may carry only these fields.
const TRACE_FIELDS = new Set([
	"time",
	"stage",
	"model",
	"input_tokens",
	"cached_input_tokens",
	"output_tokens",
	"reasoning_tokens",
	"cost_micro_usd",
	"outcome",
]);

// Runtime source may name the Meta endpoint and loopback only; other model providers fail.
// Assignment metadata in committed return files: a harness, model, worktree, route
// or session field, or a role line naming a "<harness> / <model>" route.
const RETURN_FILE = /(?:^|\/)[^/]*RETURN[^/]*\.md$/i;
const ASSIGNMENT_LINE = [
	/^[\s>*-]*(?:harness|model|worktree|route|(?:role )?session)\**\s*:/i,
	/^[\s>*-]*(?:(?:light |test |product )?implementer|reviewer|orchestrator|author)\**\s*:[^\n]*\S \/ \S/i,
];
const RUNTIME_DIRS = ["src/", "bin/"];
const META_HOSTS = new Set(["api.meta.ai"]);
const MODEL_PROVIDER_HOST =
	/(openai|anthropic|claude\.ai|generativelanguage|googleapis|vertexai|mistral|cohere|deepseek|openrouter|groq|together|fireworks|perplexity|x\.ai|huggingface|replicate|bedrock|azure)/i;

const sha256 = (s) => createHash("sha256").update(s).digest("hex");

function listFiles(root) {
	try {
		const out = execFileSync(
			"git",
			[
				"-C",
				root,
				"ls-files",
				"-z",
				"--cached",
				"--others",
				"--exclude-standard",
			],
			{
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
			},
		);
		if (
			execFileSync("git", ["-C", root, "rev-parse", "--show-toplevel"], {
				encoding: "utf8",
			}).trim() === root
		) {
			return out.split("\0").filter((p) => p && existsSync(join(root, p)));
		}
	} catch {
		/* not a Git work tree: walk it */
	}
	const files = [];
	const walk = (dir) => {
		for (const e of readdirSync(dir, { withFileTypes: true })) {
			const p = join(dir, e.name);
			if (e.isDirectory()) {
				if (e.name !== ".git") walk(p);
			} else files.push(relative(root, p).split(sep).join("/"));
		}
	};
	walk(root);
	return files;
}

function loadProvenance(root, findings) {
	const p = join(root, PROVENANCE);
	if (!existsSync(p)) return {};
	try {
		const files = JSON.parse(readFileSync(p, "utf8")).files ?? {};
		for (const [path, e] of Object.entries(files)) {
			if (!e?.source || !e?.licence)
				findings.push({
					class: "media-provenance",
					file: PROVENANCE,
					detail: `entry ${path} needs source and licence`,
				});
		}
		return files;
	} catch (err) {
		findings.push({
			class: "media-provenance",
			file: PROVENANCE,
			detail: `unreadable: ${err.message}`,
		});
		return {};
	}
}

// Text checks applied to every line of a tracked text file.
function checkLine(f, line, at, add) {
	for (const m of line.matchAll(HOME_PATH)) {
		if (!PLACEHOLDER_USERS.has(m[1]))
			add("home-path", at, "home-directory path");
	}
	if (RETURN_FILE.test(f) && ASSIGNMENT_LINE.some((re) => re.test(line)))
		add("assignment-metadata", at, "assignment field in a return file");
	if (KEY_SHAPES.some((re) => re.test(line)))
		add("key-shaped", at, "key-shaped string (value not printed)");
	for (const tok of line.split(/[^A-Za-z0-9_.-]+/)) {
		const t = tok.replace(/^[.-]+|[.-]+$/g, "").toLowerCase();
		if (t && ROUTING_TOKEN_SHA256.has(sha256(t)))
			add("routing-term", at, "agent routing term");
	}
}

// A published JSON trace may carry prompts as text (the event asks for a prompt
// and token trace, and the prompts are this repository's own source). Its
// decoded strings get the same home-path, key and routing checks as any line,
// so a JSON escape cannot hide one, and none may hold inline media: frames,
// video and audio appear only as digests.
function checkTraceJson(f, text, add) {
	let document;
	try {
		document = JSON.parse(text);
	} catch {
		add("trace-json", f, "file is not JSON");
		return;
	}
	const visit = (value) => {
		if (typeof value === "string") {
			if (/\bdata:[a-z]+\/[a-z0-9.+-]+[;,]/i.test(value))
				add("trace-json", f, "inline media (data: URL)");
			for (const line of value.split("\n"))
				checkLine(f, line, f, (_cls, at, detail) =>
					add("trace-json", at, detail),
				);
		} else if (value !== null && typeof value === "object")
			for (const [key, child] of Object.entries(value)) {
				visit(key);
				visit(child);
			}
	};
	visit(document);
}

export function checkTree(rootArg) {
	const root = realpathSync(rootArg);
	const findings = [];
	const hosts = new Set();
	const files = listFiles(root).filter(
		(f) => !SKIP_PREFIXES.some((s) => f.startsWith(s)),
	);
	const provenance = loadProvenance(root, findings);
	const add = (cls, file, detail) =>
		findings.push({ class: cls, file, detail });

	for (const f of files) {
		if (f.startsWith("out/prompts/"))
			add("raw-prompt", f, "file under out/prompts/");
		else if (f.startsWith("out/")) add("out-file", f, "file under out/");
		if (MEDIA_EXT.test(f) && !provenance[f])
			add("media-provenance", f, `no entry in ${PROVENANCE}`);

		const abs = join(root, f);
		if (!statSync(abs).isFile()) continue;
		const buf = readFileSync(abs);
		if (buf.subarray(0, 8192).includes(0)) continue; // binary
		const text = buf.toString("utf8");
		const lines = text.split("\n");

		for (const [i, line] of lines.entries())
			checkLine(f, line, `${f}:${i + 1}`, add);

		if (f.startsWith("trace/") && f.endsWith(".json"))
			checkTraceJson(f, text, add);

		if (f.startsWith("trace/") && f.endsWith(".jsonl")) {
			lines.forEach((line, i) => {
				if (!line.trim()) return;
				let obj;
				try {
					obj = JSON.parse(line);
				} catch {
					add("trace-field", `${f}:${i + 1}`, "line is not JSON");
					return;
				}
				const extra = Object.keys(obj).filter((k) => !TRACE_FIELDS.has(k));
				if (extra.length)
					add(
						"trace-field",
						`${f}:${i + 1}`,
						`fields outside allow-list: ${extra.join(", ")}`,
					);
			});
		}

		if (RUNTIME_DIRS.some((d) => f.startsWith(d))) {
			for (const m of text.matchAll(
				/\b(?:https?|wss?):\/\/([A-Za-z0-9.-]+)/g,
			)) {
				const host = m[1].toLowerCase();
				hosts.add(host);
				if (!META_HOSTS.has(host) && MODEL_PROVIDER_HOST.test(host))
					add("model-provider", f, `model provider host ${host}`);
			}
		}
	}
	return { root, files: files.length, findings, hosts: [...hosts].sort() };
}

function report(result) {
	for (const x of result.findings)
		console.log(`FAIL ${x.class} ${x.file} ${x.detail}`);
	console.log(
		`runtime network hosts: ${result.hosts.length ? result.hosts.join(", ") : "(none)"}`,
	);
	console.log(
		`check-public: ${result.findings.length ? "FAIL" : "OK"}, ${result.files} files, ${result.findings.length} findings`,
	);
}

function selfTest(dir) {
	// Each subdirectory is named after the class it must trigger.
	const cases = readdirSync(dir, { withFileTypes: true })
		.filter((e) => e.isDirectory())
		.map((e) => e.name)
		.sort();
	let caughtCount = 0;
	for (const name of cases) {
		const r = checkTree(join(dir, name));
		const caught = r.findings.some((x) => x.class === name);
		if (caught) caughtCount++;
		console.log(
			`${name} -> ${caught ? "caught" : "MISSED"} (${r.findings.map((x) => x.class).join(", ") || "no findings"})`,
		);
	}
	// Control: a clean tree passes.
	let cleanOk = false;
	const clean = mkdtempSync(join(tmpdir(), "foley-public-clean-"));
	try {
		writeFileSync(join(clean, "README.md"), "Clean control file.\n");
		const r = checkTree(clean);
		cleanOk = r.findings.length === 0;
		console.log(`clean-control -> ${cleanOk ? "passes" : "FAILED"}`);
	} finally {
		rmSync(clean, { recursive: true, force: true });
	}
	const ok = cases.length > 0 && caughtCount === cases.length && cleanOk;
	console.log(
		`self-test: ${ok ? "OK" : "FAIL"}, ${caughtCount}/${cases.length} classes caught`,
	);
	return ok ? 0 : 1;
}

const [mode, target] = process.argv.slice(2);
if (mode === "--tree" && target) {
	const r = checkTree(target);
	report(r);
	process.exit(r.findings.length ? 1 : 0);
} else if (mode === "--self-test" && target) {
	process.exit(selfTest(target));
} else {
	console.error(
		"usage: check-public.mjs --tree <dir> | --self-test <fixtures-dir>",
	);
	process.exit(2);
}

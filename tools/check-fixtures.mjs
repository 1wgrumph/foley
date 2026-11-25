#!/usr/bin/env node
// Validates the S1b fixtures (CMD-FIXTURES): owned clip with ground truth and
// provenance, census, tuning and held-out splits, and demo candidates.
//   node tools/check-fixtures.mjs fixtures/ [--held-out <file>]
// --held-out replaces fixtures/eval/held-out.json (used by the seeded failure).
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const STATUSES = [
	"no_usable_media",
	"unsupported_device",
	"excluded_sensitive_or_security",
	"eligible_not_attempted",
	"attempted_miss",
	"failure_observed",
	"proof_verified",
];
const HELD_OUT_SIZE = 8;

const args = process.argv.slice(2);
const dir = args[0];
if (!dir || dir.startsWith("--")) {
	console.error("usage: check-fixtures.mjs <fixtures-dir> [--held-out <file>]");
	process.exit(2);
}
const flag = args.indexOf("--held-out");
const heldOutPath = flag > 0 ? args[flag + 1] : join(dir, "eval/held-out.json");
const repo = dirname(resolve(dir));

const failures = [];
const check = (name, ok, detail = "") => {
	console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
	if (!ok) failures.push(name);
};
const load = (path) => {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch (err) {
		check(`readable ${path}`, false, err.message);
		return null;
	}
};

// 1. Owned clips: each MP4 has ground truth whose digest matches, and a provenance entry.
const recDir = join(dir, "recordings");
const clips = existsSync(recDir)
	? readdirSync(recDir).filter((f) => f.endsWith(".mp4"))
	: [];
check("owned clip present", clips.length > 0, `${clips.length} clip(s)`);
const provenance = load(join(repo, "media/PROVENANCE.json")) ?? {};
for (const clip of clips) {
	const path = join(recDir, clip);
	const truth = load(path.replace(/\.mp4$/, ".truth.json"));
	const digest = createHash("sha256").update(readFileSync(path)).digest("hex");
	check(`${clip} ground truth digest`, truth?.clip_sha256 === digest);
	const steps = truth?.steps ?? [];
	check(
		`${clip} ground truth steps`,
		steps.length > 0 && steps.every((s, i) => s.order === i + 1 && s.action),
		`${steps.length} ordered steps`,
	);
	check(`${clip} expected result`, Boolean(truth?.expected_visible_result));
	const entry = provenance.files?.[relative(repo, path)];
	check(`${clip} provenance`, Boolean(entry?.source && entry?.licence));
}

// 2. Census: at least 10 candidates, unique, each with one status from the closed set.
const census = load(join(dir, "census/census.json")) ?? {};
const rows = census.candidates ?? [];
const byIssue = new Map(rows.map((r) => [r.issue, r]));
check("census has at least 10 candidates", rows.length >= 10, `${rows.length}`);
check("census issues unique", byIssue.size === rows.length);
check(
	"census status set is the closed set",
	JSON.stringify(Object.keys(census.status_set ?? {})) ===
		JSON.stringify(STATUSES),
);
const badStatus = rows
	.filter((r) => !STATUSES.includes(r.status))
	.map((r) => r.issue);
check(
	"every census row has one valid status",
	badStatus.length === 0,
	badStatus.join(", "),
);
const noMedia = rows
	.filter((r) => r.status !== "no_usable_media" && !r.media?.length)
	.map((r) => r.issue);
check(
	"every row with usable media lists it",
	noMedia.length === 0,
	noMedia.join(", "),
);
const unrecorded = rows.flatMap((r) =>
	(r.media ?? []).filter((m) => !provenance.external?.[m.url]),
);
check(
	"every census media URL has a provenance entry",
	unrecorded.length === 0,
	`${unrecorded.length} missing`,
);

// 3. Splits: held-out is fixed, has exactly 8, and is disjoint from tuning; entries are eligible census issues.
const tuning = load(join(dir, "eval/tuning.json")) ?? {};
const heldOut = load(heldOutPath) ?? {};
const tIds = (tuning.entries ?? []).map((e) => e.issue);
const hIds = (heldOut.entries ?? []).map((e) => e.issue);
const overlap = hIds.filter((n) => tIds.includes(n));
check(
	"tuning and held-out are disjoint",
	overlap.length === 0,
	overlap.length ? `overlap ${overlap.join(", ")}` : "",
);
check(
	`held-out has ${HELD_OUT_SIZE} issues`,
	new Set(hIds).size === HELD_OUT_SIZE && hIds.length === HELD_OUT_SIZE,
	`${hIds.length}`,
);
check(
	"held-out is marked fixed",
	heldOut.fixed === true && Boolean(heldOut.frozen_on),
);
check("tuning set is not empty", tIds.length > 0, `${tIds.length}`);
for (const [name, set] of [
	["tuning", tuning],
	["held-out", heldOut],
]) {
	const bad = (set.entries ?? [])
		.filter(
			(e) =>
				byIssue.get(e.issue)?.status !== "eligible_not_attempted" ||
				!e.bug ||
				!e.steps?.length ||
				!e.wrong_result,
		)
		.map((e) => e.issue);
	check(
		`${name} entries are labelled eligible census issues`,
		bad.length === 0,
		bad.join(", "),
	);
}

// 4. Demo candidates: at least 3, in the census, not held out.
const demo = load(join(dir, "eval/demo-candidates.json"))?.candidates ?? [];
check("at least 3 demo candidates", demo.length >= 3, `${demo.length}`);
const badDemo = demo
	.filter((d) => !byIssue.has(d.issue) || hIds.includes(d.issue) || !d.why)
	.map((d) => d.issue);
check(
	"demo candidates are census issues outside held-out, with a reason",
	badDemo.length === 0,
	badDemo.join(", "),
);

console.log(
	`check-fixtures: ${failures.length ? "FAIL" : "OK"}, ${failures.length} failed`,
);
process.exit(failures.length ? 1 : 0);

// Draft maintainer comment for one run (DES-FOL-R08). Foley has no GitHub write
// client: the draft is only written to the run folder for a person to review.
import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Untrusted text (issue reports, model output) is shown only inside code spans,
// so it is never rendered as markup or HTML. The fence outruns any backtick run.
function code(value) {
	const text = String(value).replace(/[\r\n]+/g, " ");
	const longest = Math.max(
		0,
		...(text.match(/`+/g) ?? []).map((r) => r.length),
	);
	const fence = "`".repeat(longest + 1);
	return `${fence} ${text} ${fence}`;
}

const usd = (micro) => `$${(micro / 1_000_000).toFixed(6)}`;

function step(s) {
	const parts = [`${s.order}.`, code(s.action), code(s.target)];
	if (s.value !== undefined) parts.push("value", code(s.value));
	if (s.selector !== undefined) parts.push("at", code(s.selector));
	return parts.join(" ");
}

// Watch's timestamped notes, each as plain text in a code span.
const notes = (title, list) =>
	Array.isArray(list) && list.length
		? [
				"",
				`## ${title}`,
				...list.map((n) => `- ${code(`${n.t_s}s`)} ${code(n.text)}`),
			]
		: [];

export async function report(run, { runDir }) {
	const p = run.predicate;
	const lines = [
		`# Foley draft for issue ${code(run.issue)}`,
		"",
		"## Steps",
		...(run.steps ?? []).map(step),
		...(p
			? ["", `Expected ${code(p.expected)}; observed ${code(p.observed)}.`]
			: []),
		...notes("Uncertainty", run.uncertainty),
		...notes("Narration evidence", run.narration_evidence),
		"",
		"## Code anchors",
		...(run.anchors?.length
			? run.anchors.map((a) => `- ${code(`${a.file}:${a.line}`)}`)
			: ["none"]),
		"",
		"## Test",
		run.test
			? `${code(run.test.path)} (verdict ${code(run.test.verdict)})`
			: "none",
		"",
		"## Verdict",
		code(run.verdict ?? "none"),
		"",
		"## Cost",
		code(usd(run.cost_micro_usd ?? 0)),
		"",
	];
	const path = join(runDir, "comment.md");
	await writeFile(`${path}.tmp`, lines.join("\n"));
	await rename(`${path}.tmp`, path);
	return { status: "ok", path: "comment.md" };
}

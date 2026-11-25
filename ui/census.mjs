// The census index: one static page listing every census issue with its status,
// first-run status, set, cost and reason. No script; all text is escaped. It has
// a language, one main landmark and a table that becomes stacked rows on a
// narrow screen, so nothing scrolls sideways.
const escape = (value) =>
	String(value ?? "").replace(
		/[&<>"']/g,
		(c) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
				c
			],
	);
const human = (value) => escape(String(value ?? "").replaceAll("_", " "));

const COLUMNS = [
	["Status", (row) => human(row.status)],
	["First-run status", (row) => human(row.s6_status ?? row.status)],
	["Set", (row) => human(row.set)],
	[
		"Rerun cost (micro-USD)",
		(row) => escape(row.rerun_cost_micro_usd ?? row.cost_micro_usd ?? 0),
	],
	["Reason", (row) => escape(row.reason ?? "")],
];

const CSS = `
body{margin:0;font:16px/1.5 system-ui,sans-serif;color:#1a1a1a;background:#fff}
main{max-width:70rem;margin:0 auto;padding:1rem}
h1{font-size:1.4rem;margin:0 0 .5rem}
table{border-collapse:collapse;width:100%}
th,td{text-align:left;vertical-align:top;padding:.35rem .5rem;border-bottom:1px solid #c8c8c8;overflow-wrap:anywhere}
a{color:#0b4fa8}
@media (max-width:640px){
thead{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
tr{display:block;padding:.5rem 0;border-bottom:2px solid #767676}
th,td{display:block;border:0;padding:.1rem 0}
td::before{content:attr(data-label) ": ";font-weight:600}
}`;

/**
 * rows: [{issue, status, s6_status?, set?, rerun_cost_micro_usd?, reason?}].
 * replayHref(issue) returns a relative link to that issue's replay page, or
 * null when there is none.
 */
export function censusPage(rows, { heading, note = "", replayHref }) {
	const body = rows
		.map((row) => {
			const href = replayHref(row.issue);
			const issue = `#${escape(row.issue)}`;
			const cells = COLUMNS.map(
				([label, value]) => `<td data-label="${label}">${value(row)}</td>`,
			).join("");
			return `<tr data-testid="census-row"><th scope="row">${
				href ? `<a href="${escape(href)}">${issue}</a>` : issue
			}</th>${cells}</tr>`;
		})
		.join("\n");
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${escape(heading)}</title>
<style>${CSS}</style>
</head>
<body>
<main>
<h1>${escape(heading)}</h1>
<p>${escape(`${rows.length} issues. ${note}`.trim())}</p>
<table>
<thead><tr><th scope="col">Issue</th>${COLUMNS.map(([label]) => `<th scope="col">${label}</th>`).join("")}</tr></thead>
<tbody>
${body}
</tbody>
</table>
</main>
</body>
</html>
`;
}

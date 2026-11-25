// One policy for untrusted model text. Credential shapes: used where model text
// enters (src/watch.mjs, src/repro.mjs, the steps schema) and where run folders
// are displayed (ui/render.mjs); matching text is refused, never stored, shown
// or sent back. Re-asks: one builder for both stages. Refused test calls: one
// matcher for prove and the proof check.
const CREDENTIAL_SHAPES = [
	/-----BEGIN [A-Z ]*PRIVATE KEY-----/,
	/\b(?:sk-(?:proj-)?|ghp_|gho_|ghs_|github_pat_|xox[bp]-|GOCSPX-)[A-Za-z0-9_-]{20,}/,
	/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
	/\bAIza[0-9A-Za-z_-]{35}\b/,
	/\b[A-Za-z0-9_]*(?:api[_-]?key|secret|token)\b["']?\s*[:=]\s*["']?[A-Za-z0-9_-]{24,}/i,
];

export const hasCredentialShape = (text) =>
	typeof text === "string" &&
	CREDENTIAL_SHAPES.some((shape) => shape.test(text));

// The messages of the one re-ask after a reply that failed validation. The
// reply is sent back only when no string in it has a credential shape. The
// diagnostic names the broken rule by position and never quotes a rejected value.
export const reask = (output, diagnostic) => {
	const echo = JSON.stringify(output);
	return [
		...(hasCredentialShape(echo) ? [] : [{ role: "assistant", content: echo }]),
		{ role: "user", content: diagnostic },
	];
};

// The first refused call a generated test uses, compared without whitespace. A
// text rule: it rejects the plain case and proves nothing about a test it lets by.
const compact = (text) => text.replace(/\s+/g, "");
export const refusedCall = (code, calls) =>
	calls.find((call) => compact(code).includes(compact(call)));

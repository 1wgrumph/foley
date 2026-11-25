// One credential-shape policy for untrusted text, used where model text enters
// (src/repro.mjs) and where run folders are displayed (ui/render.mjs). Matching
// text is refused, never stored or shown.
const CREDENTIAL_SHAPES = [
	/-----BEGIN [A-Z ]*PRIVATE KEY-----/,
	/\b(?:sk-(?:proj-)?|ghp_|gho_|ghs_|github_pat_|xox[bp]-|GOCSPX-)[A-Za-z0-9_-]{20,}/,
	/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
	/\bAIza[0-9A-Za-z_-]{35}\b/,
	/\b[A-Za-z0-9_]*(?:api[_-]?key|secret|token)\b["']?\s*[:=]\s*["']?[A-Za-z0-9_-]{24,}/i,
];

export const credentialShaped = (text) =>
	typeof text === "string" &&
	CREDENTIAL_SHAPES.some((shape) => shape.test(text));

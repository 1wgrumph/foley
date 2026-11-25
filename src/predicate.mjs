// Deterministic failure check (DES-FOL-R06). The result comes only from the
// actual page; a model verdict is never an input. Only visible_text has a
// current caller; count, canvas and console-error checks are added with theirs.
const CHECKS = {
	// True when the selected element is visible and shows the observed (buggy) text.
	async visible_text(page, { selector, observed }) {
		if (typeof selector !== "string" || typeof observed !== "string")
			throw new TypeError("visible_text needs string selector and observed");
		const element = page.locator(selector).first();
		if (!(await element.isVisible())) return false;
		// biome-ignore lint/performance/useDomNodeTextContent: Playwright locator; innerText is the rendered visible text
		return (await element.innerText()).trim() === observed.trim();
	},
};

export async function checkPredicate(page, predicate) {
	const check = Object.hasOwn(CHECKS, predicate?.kind)
		? CHECKS[predicate.kind]
		: null;
	if (!check)
		throw new TypeError(`unsupported predicate kind: ${predicate?.kind}`);
	return check(page, predicate);
}

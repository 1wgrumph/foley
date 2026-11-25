// Deterministic failure check (DES-FOL-R06). The result comes only from the
// actual page; a model verdict is never an input. Each check reads data: no
// model-supplied code runs. Unavailable data is not an observation (false).
import { validPredicate } from "./run-schema.mjs";

// Reads one JSON scalar from the target's own test hook (Excalidraw sets
// window.h.elements and window.h.state). This function is ours; source and path
// are data. Anything missing or not a scalar is unavailable.
function readHook({ source, path }) {
	const h = globalThis.h;
	let value = source === "elements" ? h?.elements : h?.state;
	for (const key of path) {
		if (
			value === null ||
			typeof value !== "object" ||
			!Object.hasOwn(value, key)
		)
			return { available: false };
		value = value[key];
	}
	const scalar =
		value === null || ["string", "number", "boolean"].includes(typeof value);
	return scalar ? { available: true, value } : { available: false };
}

const CHECKS = {
	// The selected element is visible and shows the observed (buggy) text.
	async visible_text(page, { selector, observed }) {
		const element = page.locator(selector).first();
		if (!(await element.isVisible())) return false;
		// biome-ignore lint/performance/useDomNodeTextContent: Playwright locator; innerText is the rendered visible text
		return (await element.innerText()).trim() === observed.trim();
	},
	async element_count(page, { selector, observed }) {
		return (await page.locator(selector).count()) === observed;
	},
	// Whether the exact error-level console message appeared, against observed.
	async console_error(_page, { message, observed }, { consoleErrors = [] }) {
		return consoleErrors.includes(message) === observed;
	},
	async canvas_state(page, { source, path, observed }) {
		const read = await page.evaluate(readHook, { source, path });
		return read.available && read.value === observed;
	},
};

export async function checkPredicate(page, predicate, context = {}) {
	if (!validPredicate(predicate))
		throw new TypeError(
			`unsupported or malformed predicate: ${predicate?.kind}`,
		);
	return CHECKS[predicate.kind](page, predicate, context);
}

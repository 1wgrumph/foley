// Reads the app state Excalidraw saves to local storage ("excalidraw-state").
// Saving is debounced, so wait until the saved active tool is one of `oneOf`.
export async function activeTool(page, oneOf) {
	const handle = await page.waitForFunction(
		(names) => {
			try {
				const type = JSON.parse(localStorage.getItem("excalidraw-state"))
					?.activeTool?.type;
				return names.includes(type) ? type : null;
			} catch {
				return null;
			}
		},
		oneOf,
		{ timeout: 5_000 },
	);
	return handle.jsonValue();
}

export const leftViewMode = (page) =>
	page
		.locator(".excalidraw.excalidraw-container:not(.excalidraw--view-mode)")
		.waitFor({ timeout: 5_000 });

// Resolves after the page has rendered two more frames (React commits first).
export const rendered = (page) =>
	page.evaluate(
		() =>
			new Promise((done) =>
				requestAnimationFrame(() => requestAnimationFrame(done)),
			),
	);

export const checkedTool = (page) =>
	page.evaluate(
		() =>
			document.querySelector('input[data-testid^="toolbar-"]:checked')?.dataset
				.testid ?? "none",
	);

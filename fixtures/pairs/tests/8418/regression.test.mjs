// Known-good regression test for excalidraw/excalidraw#8418, written for the
// target's own Vitest setup: after "Copy to clipboard" in the image export
// dialog succeeds, the button shows the copied state.
import { fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { vi } from "vitest";

// jsdom has no system clipboard: accept every write. Excalidraw checks for
// clipboard support when its modules load, so they are imported afterwards.
Object.defineProperty(navigator, "clipboard", {
	configurable: true,
	value: { write: vi.fn().mockResolvedValue(undefined) },
});
window.ClipboardItem = class {
	constructor(items) {
		this.items = items;
	}
};
const { Excalidraw } = await import("./packages/excalidraw/index");
const { API } = await import("./packages/excalidraw/tests/helpers/api");
const { render } = await import("./packages/excalidraw/tests/test-utils");

test("copying the image to the clipboard shows the copied state", async () => {
	const { getByText } = await render(React.createElement(Excalidraw));
	API.setElements([
		API.createElement({ type: "rectangle", width: 40, height: 40 }),
	]);
	API.setAppState({ openDialog: { name: "imageExport" } });
	fireEvent.click(getByText("Copy to clipboard"));
	await waitFor(() =>
		expect(document.querySelectorAll(".ExcButton--status-success").length).toBe(
			1,
		),
	);
});

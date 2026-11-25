// Known-good regression test for excalidraw/excalidraw#10840, written for the
// target's own Vitest setup: leaving view mode after using the laser pointer
// must leave the selection tool active, not the hand tool.
import { KEYS } from "@excalidraw/common";
import { Excalidraw } from "@excalidraw/excalidraw";
import React from "react";
import { API } from "./packages/excalidraw/tests/helpers/api";
import { Keyboard } from "./packages/excalidraw/tests/helpers/ui";
import { act, render } from "./packages/excalidraw/tests/test-utils";

test("leaving view mode after the laser pointer selects the selection tool", async () => {
	// As in excalidraw-app, keys are handled on the document.
	await render(
		React.createElement(Excalidraw, { handleKeyboardGlobally: true }),
	);
	API.setAppState({ viewModeEnabled: true });
	act(() => window.h.app.setActiveTool({ type: "laser" }));
	Keyboard.keyPress(KEYS.ESCAPE); // leave the laser pointer
	API.setAppState({ viewModeEnabled: false });
	expect(window.h.state.activeTool.type).toBe("selection");
});

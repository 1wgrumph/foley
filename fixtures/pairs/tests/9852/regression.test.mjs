// Known-good regression test for excalidraw/excalidraw#9852, written for the
// target's own Vitest setup: the eraser shortcut must not switch tools while a
// multi-point line is being created.
import { KEYS } from "@excalidraw/common";
import { Excalidraw } from "@excalidraw/excalidraw";
import React from "react";
import { Keyboard } from "./packages/excalidraw/tests/helpers/ui";
import { fireEvent, render } from "./packages/excalidraw/tests/test-utils";

test("the eraser shortcut keeps the line tool during line creation", async () => {
	const { container } = await render(
		// As in excalidraw-app, keys are handled on the document.
		React.createElement(Excalidraw, { handleKeyboardGlobally: true }),
	);
	Keyboard.keyPress(KEYS.L);
	const canvas = container.querySelector("canvas.interactive");
	fireEvent.pointerDown(canvas, { clientX: 30, clientY: 30 });
	fireEvent.pointerUp(canvas, { clientX: 30, clientY: 30 });
	fireEvent.pointerMove(canvas, { clientX: 50, clientY: 60 });
	Keyboard.keyPress(KEYS.E);
	expect(window.h.state.activeTool.type).toBe("line");
});

// excalidraw/excalidraw#10840: after view mode with the laser pointer, leaving
// view mode leaves the hand tool active. Right: the selection tool is active.
import { activeTool, leftViewMode } from "./state.mjs";

export async function scenario(page) {
	await page.keyboard.press("Alt+r"); // enter view mode
	await page.keyboard.press("k"); // laser pointer
	await page.keyboard.press("Escape"); // leave the laser pointer
	await page.keyboard.press("Alt+r"); // leave view mode
	await leftViewMode(page);
	const tool = await activeTool(page, ["hand", "selection"]);
	return { right: tool === "selection", observed: `active tool ${tool}` };
}

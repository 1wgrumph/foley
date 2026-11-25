// excalidraw/excalidraw#9852: the eraser shortcut switches tools in the middle
// of creating a multi-point line. Right: the line tool stays active.
import { checkedTool, rendered } from "./state.mjs";

export async function scenario(page) {
	await page.keyboard.press("l"); // line tool
	await page.mouse.click(400, 300); // first point; multi-point creation starts
	await page.mouse.move(520, 380);
	await page.keyboard.press("e"); // eraser shortcut
	await rendered(page);
	const tool = await checkedTool(page);
	return { right: tool === "toolbar-line", observed: `checked ${tool}` };
}

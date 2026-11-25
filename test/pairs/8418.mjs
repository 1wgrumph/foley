// excalidraw/excalidraw#8418: "Copy to clipboard" in the image export dialog
// gives no sign that the copy happened. Right: the button shows copied.
import { rendered } from "./state.mjs";

export async function scenario(page) {
	await page.keyboard.press("t"); // text tool
	await page.mouse.click(500, 300);
	await page.keyboard.type("hello");
	await page.keyboard.press("Escape");
	await page.keyboard.press("Control+Shift+e"); // export image dialog
	await page.getByText("Copy to clipboard").click();
	const copied = page.locator(".ExcButton--status-success");
	await copied.waitFor({ timeout: 3_000 }).catch(() => {});
	await rendered(page);
	const count = await copied.count();
	return { right: count === 1, observed: `copied buttons ${count}` };
}

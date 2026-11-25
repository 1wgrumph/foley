export const createScene = () => ({
	rectangle: null,
	hover: false,
	selected: false,
	editing: false,
});
export function draw(scene, start, end) {
	scene.rectangle = [...start, ...end];
}
function inside(scene, [x, y]) {
	return (
		scene.rectangle &&
		x > scene.rectangle[0] &&
		x < scene.rectangle[2] &&
		y > scene.rectangle[1] &&
		y < scene.rectangle[3]
	);
}
export function move(scene, point) {
	scene.hover = Boolean(inside(scene, point));
}
export function click(scene, point) {
	scene.selected = Boolean(inside(scene, point));
}
export function doubleClick(scene, point) {
	scene.editing =
		scene.selected && scene.hover && Boolean(inside(scene, point));
}
export function selectionStatus(scene) {
	return scene.editing ? "Selected (incorrect label)" : "Not editing";
}

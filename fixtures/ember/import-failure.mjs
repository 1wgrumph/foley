import { test } from "node:test";

test("TC-SEED-1", async () => {
	await import("./absent-fixture.mjs");
});

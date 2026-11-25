import "./loopback-only.mjs";
import { join } from "node:path";
import { backlog } from "../../src/backlog.mjs";
import { callEmber } from "../../src/ember.mjs";
import { censusOf, makeStages } from "./backlog-driver.mjs";

const result = await backlog(censusOf(["eligible_not_attempted"]), {
	runRoot: join(process.cwd(), "out", "runs"),
	stages: makeStages(callEmber),
});
console.log(JSON.stringify(result));

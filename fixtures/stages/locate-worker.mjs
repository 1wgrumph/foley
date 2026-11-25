import { locate } from "../../src/locate.mjs";

const [stepsPath, targetDir, targetRevision, runDir] = process.argv.slice(2);
const result = await locate(stepsPath, { targetDir, targetRevision, runDir });
console.log(JSON.stringify(result));

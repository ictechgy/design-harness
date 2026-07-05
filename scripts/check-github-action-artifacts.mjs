import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const workflowPath = resolve(".github/workflows/ci.yml");
const workflow = await readFile(workflowPath, "utf8");

const requiredFragments = [
  "pnpm release:check",
  "pnpm smoke:example",
  "actions/upload-artifact@v4",
  "if: always()",
  "name: design-harness-example-smoke",
  "path: runs/example-smoke",
  "if-no-files-found: warn"
];

const missing = requiredFragments.filter((fragment) => !workflow.includes(fragment));
if (missing.length > 0) {
  throw new Error(`Missing required GitHub Actions artifact fragment(s): ${missing.join(", ")}`);
}

if (workflow.indexOf("actions/upload-artifact@v4") < workflow.indexOf("pnpm smoke:example")) {
  throw new Error("Artifact upload step must run after the example smoke audit step.");
}

console.log("Validated GitHub Actions artifact upload scaffold.");

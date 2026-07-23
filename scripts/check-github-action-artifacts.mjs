import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const workflowPath = resolve(".github/workflows/ci.yml");
const workflow = await readFile(workflowPath, "utf8");

const requiredFragments = [
  "pnpm release:check",
  "pnpm smoke:example",
  "pnpm smoke:copy",
  "pnpm smoke:loop",
  "pnpm calibrate:fixtures",
  "actions/upload-artifact@v4",
  "if: always()",
  "name: design-harness-example-smoke",
  "runs/example-smoke",
  "runs/copy-smoke",
  "runs/loop-smoke",
  "runs/calibration",
  "if-no-files-found: warn"
];

const missing = requiredFragments.filter((fragment) => !workflow.includes(fragment));
if (missing.length > 0) {
  throw new Error(`Missing required GitHub Actions artifact fragment(s): ${missing.join(", ")}`);
}

const uploadIndex = workflow.indexOf("actions/upload-artifact@v4");
const lastAuditIndex = Math.max(
  workflow.indexOf("pnpm smoke:example"),
  workflow.indexOf("pnpm smoke:copy"),
  workflow.indexOf("pnpm smoke:loop"),
  workflow.indexOf("pnpm calibrate:fixtures")
);
if (uploadIndex < lastAuditIndex) {
  throw new Error("Artifact upload step must run after the example, copy, loop, and calibration audit steps.");
}

console.log("Validated GitHub Actions artifact upload scaffold.");

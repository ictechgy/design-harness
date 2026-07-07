#!/usr/bin/env node
/**
 * Enforces ADR-001: every criterion registry entry must satisfy the
 * sourceStrength x determinism x resultKind policy matrix, model-judged
 * runtimes must be subjective needs-review, declared strengths must be backed
 * by referenced sources, and clause-mapped sources (WCAG 2.2) must map every
 * citing criterion. integrity.ts only blocks heuristic/subjective failures at
 * the finding level; this guard blocks disallowed combinations at the
 * criterion level, before any finding exists.
 */
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const coreDir = resolve(root, "packages/core");
const distFiles = ["dist/criteria-policy.js", "dist/criteria.js"].map((path) => resolve(coreDir, path));
const sourceFiles = ["src/criteria-policy.ts", "src/criteria.ts", "src/types.ts"].map((path) =>
  resolve(coreDir, path)
);

if (distFiles.some((path) => !existsSync(path))) {
  console.error(
    "check-criteria-policy: packages/core/dist is missing. Run `pnpm --filter @design-harness/core build` first."
  );
  process.exit(1);
}

// A stale dist would silently validate an outdated registry and print a false
// pass when this guard is run standalone (pnpm validate rebuilds core first).
const newestSourceMtime = Math.max(...sourceFiles.map((path) => statSync(path).mtimeMs));
const oldestDistMtime = Math.min(...distFiles.map((path) => statSync(path).mtimeMs));
if (newestSourceMtime > oldestDistMtime) {
  console.error(
    "check-criteria-policy: packages/core/dist is stale relative to src. Run `pnpm --filter @design-harness/core build` first."
  );
  process.exit(1);
}

const [policyDist, criteriaDist] = distFiles;
const { validateRegistryCriteriaPolicy } = await import(pathToFileURL(policyDist).href);
const result = validateRegistryCriteriaPolicy();

if (!result.valid) {
  console.error("check-criteria-policy failed:");
  for (const issue of result.issues) {
    console.error(`- ${issue.path}: ${issue.message}`);
  }
  process.exit(1);
}

const { CRITERIA } = await import(pathToFileURL(criteriaDist).href);
console.log(`check-criteria-policy passed: ${CRITERIA.length} criteria satisfy the ADR-001 policy matrix.`);

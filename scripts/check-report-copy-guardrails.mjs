#!/usr/bin/env node
/**
 * Enforces AGENTS.md HARD RULE 9 (report copy guardrails) as a machine gate instead of a prose promise.
 *
 * `validateReportCopyGuardrails` has always existed in core, but until now it ran only in a unit test — so
 * the rule it enforces ("never claim WCAG compliant / accessible / good design unqualified") did not run on
 * real rendered output. This check runs it over the surfaces the rule is actually about: committed audit
 * reports and the README.
 *
 * Scope is deliberately narrow. `docs/**` legitimately QUOTES the banned phrases to define the rule
 * (docs/criteria-and-checks.md, docs/research/ui-ux-quality-basis.md, docs/plans/v0.2-ui-ux-quality-ralplan.md),
 * so scanning docs would false-positive on the very files that specify the guardrail. The gate covers
 * rendered reports and the README, which are the outward-facing claim surfaces.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { validateReportCopyGuardrails } from "../packages/core/dist/index.js";

const root = resolve(new URL("..", import.meta.url).pathname);

const IN_SCOPE = [
  /^examples\/reports\/.*\/report\.md$/,
  /^packages\/cli\/runs\/.*\/report\.md$/,
  /^README\.md$/
];

const trackedFiles = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
  .split("\n")
  .filter(Boolean)
  .filter((file) => IN_SCOPE.some((pattern) => pattern.test(file)));

const failures = [];
for (const file of trackedFiles) {
  const labels = validateReportCopyGuardrails(readFileSync(resolve(root, file), "utf8"));
  if (labels.length > 0) {
    failures.push(`${file}: unqualified overclaim(s): ${labels.join(", ")}`);
  }
}

if (failures.length > 0) {
  console.error("check-report-copy-guardrails failed (AGENTS.md HARD RULE 9):");
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  console.error("Report copy must use scoped phrasing; never claim WCAG compliance, accessibility, or good design unqualified.");
  process.exit(1);
}

console.log(`check-report-copy-guardrails passed: ${trackedFiles.length} report/README surface(s) free of unqualified overclaims.`);

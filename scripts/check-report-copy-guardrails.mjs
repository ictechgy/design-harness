#!/usr/bin/env node
/**
 * Enforces AGENTS.md HARD RULE 9 (report copy guardrails) as a machine gate instead of a prose promise.
 *
 * `validateReportCopyGuardrails` has always existed in core, but until now it ran only in a unit test — so
 * the rule it enforces ("never claim WCAG compliant / accessible / good design unqualified") did not run on
 * real rendered output. This check runs it over the surfaces the rule is actually about: every committed
 * rendered audit report, and every README (root + published package READMEs are "public docs" per rule 9).
 *
 * Rendered reports are detected by content (the report header), not by filename, so any committed report
 * anywhere is covered — including examples/reports/[name]/report.md and the differently-named
 * examples/merchant-dashboard/sample-report.md. docs/** is naturally excluded: those files legitimately
 * QUOTE the banned phrases to define the rule, and they are neither rendered reports nor READMEs.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

const root = fileURLToPath(new URL("..", import.meta.url));
const distEntry = resolve(root, "packages/core/dist/index.js");
if (!existsSync(distEntry)) {
  console.error("check-report-copy-guardrails: packages/core/dist is missing. Run `pnpm build` first.");
  process.exit(1);
}
const { validateReportCopyGuardrails } = await import(distEntry);

const REPORT_HEADER = "# Design Harness Audit Report";
const README_PATTERNS = [/^README\.md$/, /^packages\/[^/]+\/README\.md$/];
const ADDITIONAL_PUBLIC_REPORTS = new Set(["docs/benchmarks/obedience-v1/report.md"]);

const trackedFiles = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
  .split("\n")
  .filter(Boolean)
  .filter((file) => file.endsWith(".md"));

const failures = [];
let scanned = 0;
for (const file of trackedFiles) {
  const content = readFileSync(resolve(root, file), "utf8");
  const isReadme = README_PATTERNS.some((pattern) => pattern.test(file));
  const isRenderedReport = content.trimStart().startsWith(REPORT_HEADER);
  if (!isReadme && !isRenderedReport && !ADDITIONAL_PUBLIC_REPORTS.has(file)) {
    continue;
  }
  scanned += 1;
  const labels = validateReportCopyGuardrails(content);
  if (labels.length > 0) {
    failures.push(`${file}: unqualified overclaim(s): ${labels.join(", ")}`);
  }
}

if (failures.length > 0) {
  console.error("check-report-copy-guardrails failed (AGENTS.md HARD RULE 9):");
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  console.error("Report/README copy must use scoped phrasing; never claim WCAG compliance, accessibility, or good design unqualified.");
  process.exit(1);
}

console.log(`check-report-copy-guardrails passed: ${scanned} rendered report(s)/README(s) free of unqualified overclaims.`);

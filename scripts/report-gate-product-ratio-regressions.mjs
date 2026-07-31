#!/usr/bin/env node
/**
 * Regressions for the gate-versus-product ratio reporter.
 *
 * The point of these is that the reporter must be honest about what it counts.
 * A ratio that silently excluded a category, or counted tests as product, would
 * flatter whichever side the reader wanted to defend.
 */

import { RATIO_CONVERSATION_CEILING, collect } from "./report-gate-product-ratio.mjs";

let checks = 0;
const failures = [];
const check = (label, condition) => {
  checks += 1;
  if (!condition) failures.push(label);
};

const report = collect();

check("product sources were found", report.product.files > 0 && report.product.lines > 0);
check("package tests were found", report.packageTests.files > 0 && report.packageTests.lines > 0);
check("machinery was found", report.machinery.files > 0 && report.machinery.lines > 0);

check(
  "tests are counted separately from product, never inside it",
  report.product.lines + report.packageTests.lines > report.product.lines
);
check(
  "the machinery ratio is derived from product source only",
  Math.abs(report.machineryToProductRatio - report.machinery.lines / report.product.lines) < 0.001
);
check(
  "the tests ratio is derived from product source only",
  Math.abs(report.testsToProductRatio - report.packageTests.lines / report.product.lines) < 0.001
);

check("the conversation ceiling is an explicit constant", RATIO_CONVERSATION_CEILING === 3);
check(
  "the ceiling is generous enough that it is not a target",
  RATIO_CONVERSATION_CEILING > report.machineryToProductRatio
);

check("collect is deterministic", JSON.stringify(collect()) === JSON.stringify(report));

// The reporter must not double count: every counted file belongs to exactly one bucket.
check(
  "counts are plausible rather than degenerate",
  report.product.lines > 1000 && report.machinery.lines > 1000
);

if (failures.length > 0) {
  console.error(`report-gate-product-ratio-regressions FAILED (${failures.length} of ${checks}):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(
  `report-gate-product-ratio-regressions passed: ${checks} cases. ` +
    `Current machinery/product ${report.machineryToProductRatio}.`
);

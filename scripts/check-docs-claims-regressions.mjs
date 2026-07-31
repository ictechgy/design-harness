#!/usr/bin/env node
/**
 * Regressions for the docs claim checker.
 *
 * A gate that never fires is worthless, and a gate that fires on ordinary prose
 * is worse than nothing. These cases pin both edges: the checker must catch a
 * bare measured-sounding number, and must stay silent on versions, dates,
 * standard thresholds, tables, and fenced code.
 */

import { findUncitedClaims } from "./check-docs-claims.mjs";

let checks = 0;
const failures = [];

function flags(label, text) {
  checks += 1;
  const found = findUncitedClaims("t.md", text);
  if (found.length === 0) failures.push(`${label}: expected a finding, got none`);
}

function silent(label, text) {
  checks += 1;
  const found = findUncitedClaims("t.md", text);
  if (found.length > 0) {
    failures.push(`${label}: expected silence, got ${found.map((f) => f.excerpt).join(" | ")}`);
  }
}

// --- must fire --------------------------------------------------------------

flags("bare percentage claim", "Our detector reaches 94% accuracy on real pages.\n");
flags("bare ratio claim", "The repair closed 11 of 12 cells cleanly.\n");
flags(
  "percentage with only vague hedging",
  "It is generally believed that roughly 80% of screens have this problem.\n"
);
flags(
  "claim isolated from evidence by a blank line",
  "This paragraph mentions a measured snapshot.\n\nUnrelated heading text.\n\nAccuracy is 73%.\n"
);

// --- must stay silent -------------------------------------------------------

silent("no numbers at all", "The detector reports a risk when the value is off scale.\n");
silent("version numbers", "Install `@design-harness/cli@0.6.4` and run the audit.\n");
silent("dates alone", "Released 2026-07-29 after the maintenance train.\n");
silent(
  "percentage with an explicit measurement statement",
  "Measured on 2026-08-01, 79% of spacing values were off-contract.\n"
);
silent(
  "percentage citing a benchmarks path",
  "The snapshot in docs/benchmarks/obedience-v1/report.md records 100% cell completion.\n"
);
silent(
  "percentage citing an external author-year source",
  "Colour harmony templates explained 52% of rating variance (O'Donovan et al).\n"
);
silent(
  "percentage citing a URL",
  "The survey at https://example.org/report found 41% of pages failing.\n"
);
silent(
  "percentage near a named standard",
  "WCAG 2.2 requires 24 CSS px targets, and 38% of controls were smaller.\n"
);
silent(
  "evidence in the preceding paragraph",
  "This section reports the calibration snapshot.\n\nThe pass rate was 88%.\n"
);
silent("table rows are not prose claims", "| Cell | Rate |\n|---|---:|\n| a | 91% |\n");
silent("blockquote is quoted material", "> Some external source claims 60% coverage.\n");
silent(
  "fenced code is not a claim",
  "Run this:\n\n```bash\necho 'coverage 92%'\n```\n"
);
silent(
  "percentage with a reproducing command",
  "Running `pnpm check:slop-convergence` yields 70% of the cases below.\n"
);

// --- shape of the finding --------------------------------------------------

checks += 1;
const single = findUncitedClaims("x.md", "Accuracy is 94%.\nAnd precision is 91%.\n");
if (single.length !== 1) {
  failures.push(`one finding per paragraph expected, got ${single.length}`);
}
checks += 1;
if (single[0]?.file !== "x.md" || typeof single[0]?.line !== "number") {
  failures.push("finding must carry the file path and a line number");
}

if (failures.length > 0) {
  console.error(`check-docs-claims-regressions FAILED (${failures.length} of ${checks}):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`check-docs-claims-regressions passed: ${checks} cases.`);

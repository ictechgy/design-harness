#!/usr/bin/env node
/**
 * Regressions for the textlint output adapter.
 *
 * The load-bearing property is that hard rule 1 survives the format boundary. An
 * editor's error level is failure language, so only a deterministic failure may
 * reach it. If a heuristic risk ever mapped to `error`, this adapter would launder
 * exactly the overclaim the project exists to prevent.
 */

import {
  ADAPTER_ID,
  TEXTLINT_SEVERITY,
  renderTextlintOutput,
  severityFor,
  summarize
} from "./render-textlint-output.mjs";

let checks = 0;
const failures = [];
const check = (label, condition) => {
  checks += 1;
  if (!condition) failures.push(label);
};

const finding = (over = {}) => ({
  id: "finding-desktop-x-1",
  category: "accessibility",
  severity: "high",
  confidence: "high",
  viewport: "desktop",
  problem: "Something is wrong.",
  recommendation: "Fix it.",
  determinism: "deterministic",
  resultKind: "failure",
  checkName: "some-check",
  ...over
});

// --- hard rule 1 across the boundary ---------------------------------------

check(
  "deterministic failure is the only path to error",
  severityFor(finding()) === TEXTLINT_SEVERITY.error
);
check(
  "deterministic risk is a warning, never an error",
  severityFor(finding({ resultKind: "risk" })) === TEXTLINT_SEVERITY.warning
);
check(
  "heuristic risk is a warning, never an error",
  severityFor(finding({ determinism: "heuristic", resultKind: "risk" })) === TEXTLINT_SEVERITY.warning
);
check(
  "needs-review is info, never an error",
  severityFor(finding({ determinism: "heuristic", resultKind: "needs-review" })) ===
    TEXTLINT_SEVERITY.info
);
check(
  "subjective is info even if it claims failure",
  severityFor(finding({ determinism: "subjective", resultKind: "failure" })) ===
    TEXTLINT_SEVERITY.info
);
check(
  "a high severity heuristic still cannot reach error",
  severityFor(finding({ determinism: "heuristic", resultKind: "risk", severity: "high" })) !==
    TEXTLINT_SEVERITY.error
);
check(
  "no finding shape reaches error without deterministic failure",
  ["deterministic", "heuristic", "subjective"].every((determinism) =>
    ["risk", "needs-review"].every(
      (resultKind) => severityFor(finding({ determinism, resultKind })) !== TEXTLINT_SEVERITY.error
    )
  )
);

// --- shape -----------------------------------------------------------------

const results = renderTextlintOutput({
  metadata: { url: "http://localhost:3000" },
  findings: [
    finding(),
    finding({ id: "b", viewport: "mobile", determinism: "heuristic", resultKind: "risk" }),
    finding({ id: "c", viewport: "mobile", resultKind: "needs-review", determinism: "subjective" })
  ]
});

check("groups by viewport", results.length === 2);
check("group key carries the audited label", results.every((r) => r.filePath.startsWith("http://localhost:3000#")));
check("groups are sorted deterministically", results[0].filePath < results[1].filePath);
check("every message has a rule id namespaced to the tool", results.every((r) => r.messages.every((m) => m.ruleId.startsWith("design-harness/"))));
check("rule id uses the check name", results.some((r) => r.messages.some((m) => m.ruleId === "design-harness/some-check")));
check(
  "messages carry the grading in text so an editor reader sees it",
  results.some((r) => r.messages.some((m) => m.message.includes("[deterministic/failure]")))
);
check(
  "synthetic position is disclosed rather than invented silently",
  results.every((r) => r.messages.every((m) => m.designHarness.positionIsSynthetic === true))
);
check(
  "adapter provenance is recorded on every message",
  results.every((r) => r.messages.every((m) => m.designHarness.adapter === ADAPTER_ID))
);
check("line and column are fixed at 1", results.every((r) => r.messages.every((m) => m.line === 1 && m.column === 1)));

const counts = summarize(results);
check("summary counts each severity", counts.error === 1 && counts.warning === 1 && counts.info === 1);

// --- degenerate input ------------------------------------------------------

check("no findings yields no groups", renderTextlintOutput({ findings: [] }).length === 0);
check("missing findings array is tolerated", renderTextlintOutput({}).length === 0);
check("null audit is tolerated", renderTextlintOutput(null).length === 0);
check(
  "a finding without determinism defaults to a non-error severity",
  severityFor({ problem: "x" }) !== TEXTLINT_SEVERITY.error
);
check(
  "a finding without a viewport still groups",
  renderTextlintOutput({ findings: [{ problem: "x" }] })[0]?.filePath.endsWith("#unknown") === true
);
check("output is JSON serializable", (() => {
  try {
    JSON.parse(JSON.stringify(results));
    return true;
  } catch {
    return false;
  }
})());

if (failures.length > 0) {
  console.error(`render-textlint-output-regressions FAILED (${failures.length} of ${checks}):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`render-textlint-output-regressions passed: ${checks} cases.`);

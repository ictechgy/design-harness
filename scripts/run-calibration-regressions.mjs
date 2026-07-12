import assert from "node:assert/strict";
import { calibrationFixturePaths } from "./calibration-paths.mjs";
import { buildCalibrationSummary } from "./calibration-summary.mjs";

const flatFixture = calibrationFixturePaths(
  "/tmp/calibration",
  "examples/ui-quality-fixtures/korean--sample.html"
);
const nestedFixture = calibrationFixturePaths(
  "/tmp/calibration",
  "examples/ui-quality-fixtures/korean/sample.html"
);
assert.notEqual(flatFixture.outDir, nestedFixture.outDir);
assert.throws(
  () => calibrationFixturePaths("/tmp/calibration", "examples/ui-quality-fixtures/../escaped.html"),
  /escapes the output root/
);

const shouldNotFlag = {
  registeredCheckNames: ["quiet-check"],
  futureCriteria: [
    { criterionId: "future.check", rationale: "Declared but not implemented." }
  ]
};

const exact = buildCalibrationSummary([
  run(
    "exact.html",
    [{ checkName: "expected-check", count: 2 }],
    shouldNotFlag,
    ["expected-check", "expected-check", "visual-check"]
  )
]);
assert.equal(exact.status, "pass");
assert.deepEqual(exact.totals, { tp: 2, fp: 0, fn: 0 });
assert.equal(exact.auditFailures, 0);
assert.deepEqual(exact.checks["quiet-check"], { tp: 0, fp: 0, fn: 0 });
assert.equal(exact.checks["future.check"], undefined);
assert.deepEqual(exact.fixtures[0].outOfScopeFindings, { "visual-check": 1 });

const missing = buildCalibrationSummary([
  run("missing.html", [{ checkName: "expected-check", count: 2 }], emptyShouldNotFlag(), ["expected-check"])
]);
assert.equal(missing.status, "drift");
assert.deepEqual(missing.totals, { tp: 1, fp: 0, fn: 1 });

const unexpected = buildCalibrationSummary([
  run(
    "unexpected.html",
    [],
    { ...emptyShouldNotFlag(), registeredCheckNames: ["unexpected-check"] },
    ["unexpected-check", "unexpected-check"]
  )
]);
assert.equal(unexpected.status, "drift");
assert.deepEqual(unexpected.totals, { tp: 0, fp: 2, fn: 0 });

const mixed = buildCalibrationSummary([
  run(
    "mixed.html",
    [{ checkName: "expected-check", count: 1 }],
    { ...emptyShouldNotFlag(), registeredCheckNames: ["unexpected-check"] },
    ["expected-check", "unexpected-check"]
  )
]);
assert.deepEqual(mixed.totals, { tp: 1, fp: 1, fn: 0 });

const partial = buildCalibrationSummary([
  {
    ...run("partial.html", [], emptyShouldNotFlag(), []),
    auditResult: { findings: [], status: "partial", failedChecks: ["copy-audit"] }
  }
]);
assert.equal(partial.status, "drift");
assert.equal(partial.auditFailures, 1);

console.log("Calibration summary regression checks passed.");

function run(fixturePath, expectedFindings, expectation, checkNames) {
  return {
    record: {
      fixturePath,
      expectedFindings,
      shouldNotFlag: expectation
    },
    auditResult: {
      findings: checkNames.map((checkName) => ({ checkName })),
      status: "success",
      failedChecks: []
    }
  };
}

function emptyShouldNotFlag() {
  return {
    registeredCheckNames: [],
    futureCriteria: []
  };
}

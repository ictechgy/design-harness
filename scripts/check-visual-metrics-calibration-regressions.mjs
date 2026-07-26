import assert from "node:assert/strict";
import {
  readVisualMetricsCalibrationInputs,
  validateVisualMetricsCalibration
} from "./check-visual-metrics-calibration.mjs";

const baseline = await readVisualMetricsCalibrationInputs();
assert.deepEqual(
  validateVisualMetricsCalibration(baseline),
  [],
  "the committed visual-metrics calibration must satisfy its validator"
);

rejects("unexpected top-level key", (input) => {
  input.manifest.extra = true;
}, /keys must be exactly/u);

rejects("missing seventh case", (input) => {
  input.manifest.cases.pop();
}, /exact ordered seven-case/u);

rejects("duplicate case identity", (input) => {
  input.manifest.cases[1].id = input.manifest.cases[0].id;
}, /must equal|duplicates/u);

rejects("fixture raw-byte drift", (input) => {
  input.fixtureBytes.set(
    input.manifest.cases[0].path,
    Buffer.concat([input.fixtureBytes.get(input.manifest.cases[0].path), Buffer.from("\n")])
  );
}, /raw-byte digest|isolated/u);

rejects("selector exception in generation policy", (input) => {
  input.manifest.cases[0].policy.ignoreSelectors = [".target-exception"];
}, /selector-free|keys must be exactly/u);

rejects("policy-method drift", (input) => {
  input.manifest.cases[2].policy.methodId = "palette-method-v2";
}, /methodId/u);

rejects("open calibration pair", (input) => {
  input.manifest.pairs[0].badCaseId = "not-the-bad-twin";
}, /badCaseId/u);

rejects("measurement accounting drift", (input) => {
  input.manifest.cases[4].expected.measurement.textClusters.textNodeUniverseCount += 1;
}, /node accounting/u);

rejects("score-honesty metadata drift", (input) => {
  input.manifest.cases[1].expected.findings[0].resultKind = "failure";
}, /resultKind/u);

rejects("finding overage drift", (input) => {
  input.manifest.cases[3].expected.findings[0].overages[0].excess = 2;
}, /must exactly match/u);

rejects("criterion source-policy drift", (input) => {
  input.criteriaSource = input.criteriaSource.replace(
    'id: "typography.variant-count.budget"',
    'id: "typography.variant-count.changed"'
  );
}, /criterion typography\.variant-count\.budget/u);

rejects("frozen source identifier drift", (input) => {
  input.designGuideSource = input.designGuideSource.replace(
    'export const TYPOGRAPHY_VARIANT_METHOD_ID = "rendered-typography-variants-v1" as const;',
    'export const TYPOGRAPHY_VARIANT_METHOD_ID = "rendered-typography-variants-v2" as const;'
  );
}, /source constant TYPOGRAPHY_VARIANT_METHOD_ID/u);

rejects("missing unrelated corpus fixture", (input) => {
  input.manifest.corpus.entries.pop();
}, /exactly close over 48/u);

rejects("corpus selector exception", (input) => {
  input.manifest.corpus.policy.palette.ignoreSelectors = [".fixture-only"];
}, /selector-free|keys must be exactly/u);

rejects("corpus repeat weakening", (input) => {
  input.manifest.corpus.repeatCount = 1;
}, /repeatCount/u);

rejects("corpus projection hash drift", (input) => {
  input.manifest.corpus.entries[0].projectionSha256 = "not-a-sha";
}, /projectionSha256/u);

rejects("corpus raw fixture hash drift", (input) => {
  input.manifest.corpus.entries[0].fixtureSha256 = "0".repeat(64);
}, /raw-byte digest/u);

rejects("reviewed notice widening", (input) => {
  input.manifest.corpus.entries[0].expectedNotices.push({
    code: "palette-discipline-slots-skipped",
    viewport: "desktop",
    skippedSlotCount: 1,
    skippedByReason: { "unsupported-color": 1 },
    methodId: "rendered-rgba8-oklch-cover30-v1"
  });
}, /exactly pin|reviewed notice count/u);

console.log("Visual metrics calibration mutation regressions passed (18 fail-closed mutations).");

function rejects(label, mutate, pattern) {
  const input = cloneInputs(baseline);
  assert.deepEqual(
    validateVisualMetricsCalibration(input),
    [],
    `${label}: cloned baseline must be valid before mutation`
  );
  mutate(input);
  const errors = validateVisualMetricsCalibration(input);
  assert(
    errors.length > 0,
    `${label}: mutation unexpectedly passed calibration validation`
  );
  assert(
    errors.some((error) => pattern.test(error)),
    `${label}: expected ${pattern}, received:\n${errors.join("\n")}`
  );
}

function cloneInputs(input) {
  return {
    manifest: structuredClone(input.manifest),
    fixtureBytes: new Map(
      [...input.fixtureBytes.entries()].map(([path, bytes]) => [path, Buffer.from(bytes)])
    ),
    corpusPaths: [...input.corpusPaths],
    designGuideSource: input.designGuideSource,
    criteriaSource: input.criteriaSource
  };
}

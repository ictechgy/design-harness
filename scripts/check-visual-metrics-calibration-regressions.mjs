import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  readVisualMetricsCalibrationInputs,
  validateVisualMetricsCalibration
} from "./check-visual-metrics-calibration.mjs";
import {
  VISUAL_METRICS_CORPUS_PROJECTION_PROFILE,
  toPortableVisualMetricsCorpusProjection
} from "./visual-metrics-corpus-projection.mjs";

const baseline = await readVisualMetricsCalibrationInputs();
assert.deepEqual(
  validateVisualMetricsCalibration(baseline),
  [],
  "the committed visual-metrics calibration must satisfy its validator"
);

const fullCorpusProjection = {
  measurement: structuredClone(baseline.manifest.cases[6].expected.measurement),
  findings: [{ checkName: "preserved-finding" }],
  notices: [{ code: "preserved-notice" }]
};
const portableCorpusProjection = toPortableVisualMetricsCorpusProjection(
  VISUAL_METRICS_CORPUS_PROJECTION_PROFILE,
  fullCorpusProjection
);
const fullTextClusters = fullCorpusProjection.measurement.density.textClusters;
const portableTextClusters = portableCorpusProjection.measurement.density.textClusters;
assert(Object.hasOwn(fullTextClusters, "textFragmentCount"));
assert(Object.hasOwn(fullTextClusters, "edgeTestCount"));
assert(!Object.hasOwn(portableTextClusters, "textFragmentCount"));
assert(!Object.hasOwn(portableTextClusters, "edgeTestCount"));
assert.equal(portableTextClusters.textClusterCount, fullTextClusters.textClusterCount);
assert.equal(
  portableCorpusProjection.measurement.density.visibleElements.visibleElementCount,
  fullCorpusProjection.measurement.density.visibleElements.visibleElementCount
);
assert.equal(portableTextClusters.coverage, fullTextClusters.coverage);
assert.deepEqual(portableCorpusProjection.findings, fullCorpusProjection.findings);
assert.deepEqual(portableCorpusProjection.notices, fullCorpusProjection.notices);
assert.throws(
  () => toPortableVisualMetricsCorpusProjection(
    "visual-metrics-corpus-portable-v2",
    fullCorpusProjection
  ),
  /Unsupported visual-metrics corpus projection profile/u
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

rejects("negative ignored-reason count", (input) => {
  input.manifest.cases[2].expected.measurement.ignoredByReason.transparent = -1;
}, /non-negative safe integer/u);

rejects("unknown metric", (input) => {
  input.manifest.cases[0].metric = "typography-v2";
}, /metric must be one of/u);

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
}, /exactly close over \d+ pre-existing unrelated HTML fixtures/u);

rejects("lossy corpus id collision", (input) => {
  const sourcePath = "examples/ui-quality-fixtures/korean/copy-good.html";
  const collidingPath = "examples/ui-quality-fixtures/korean-copy-good.html";
  const bytes = Buffer.from(input.fixtureBytes.get(sourcePath));
  input.corpusPaths.push(collidingPath);
  input.corpusPaths.sort();
  input.fixtureBytes.set(collidingPath, bytes);
  input.manifest.corpus.entries.push({
    id: "korean-copy-good",
    path: collidingPath,
    fixtureSha256: createHash("sha256").update(bytes).digest("hex"),
    projectionSha256: "0".repeat(64),
    expectedNotices: []
  });
  input.manifest.corpus.entries.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0
  );
}, /id duplicates/u);

rejects("corpus selector exception", (input) => {
  input.manifest.corpus.policy.palette.ignoreSelectors = [".fixture-only"];
}, /selector-free|keys must be exactly/u);

rejects("corpus repeat weakening", (input) => {
  input.manifest.corpus.repeatCount = 1;
}, /repeatCount/u);

rejects("corpus projection profile drift", (input) => {
  input.manifest.corpus.projection.profile = "visual-metrics-corpus-portable-v2";
}, /projection\.profile/u);

rejects("corpus projection omission widening", (input) => {
  input.manifest.corpus.projection.omittedFields[0] =
    "measurement.density.textClusters.textClusterCount";
}, /projection\.omittedFields/u);

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

console.log(
  "Visual metrics calibration projection contract and mutation regressions passed "
  + "(23 fail-closed mutations)."
);

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

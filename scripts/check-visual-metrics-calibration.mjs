import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  VISUAL_METRICS_CORPUS_OMITTED_FIELDS,
  VISUAL_METRICS_CORPUS_PROJECTION_PROFILE
} from "./visual-metrics-corpus-projection.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = resolve(
  repoRoot,
  "examples/ui-quality-fixtures/visual-metrics-calibration.json"
);
const designGuideSourcePath = resolve(repoRoot, "packages/core/src/design-guide.ts");
const criteriaSourcePath = resolve(repoRoot, "packages/core/src/criteria.ts");
const fixtureRoot = resolve(repoRoot, "examples/ui-quality-fixtures");
const fixturePathPrefix = "examples/ui-quality-fixtures/";
const calibrationMetrics = Object.freeze(["typography", "palette", "density", "all"]);
const calibrationMetricSet = new Set(calibrationMetrics);
const paletteIgnoreReasonSet = new Set(["selector-exception", "transparent"]);

const expectedContracts = Object.freeze({
  typography: Object.freeze({
    criterionId: "typography.variant-count.budget",
    checkName: "typography-variant-count-budget",
    policyId: "typography-variant-budget-v1",
    methodId: "rendered-typography-variants-v1"
  }),
  palette: Object.freeze({
    criterionId: "color.palette.count-discipline",
    checkName: "palette-count-discipline",
    policyId: "palette-discipline-budget-v1",
    methodId: "rendered-rgba8-oklch-cover30-v1"
  }),
  density: Object.freeze({
    criterionId: "layout.density.complexity-budget",
    checkName: "density-complexity-budget",
    policyId: "density-complexity-budget-v1",
    methodId: "viewport-dom-density-v1",
    visibleElementMethodId: "visible-content-elements-v1",
    textClusterMethodId: "text-flow-connectivity-v1"
  })
});

const expectedCaseRecords = Object.freeze([
  Object.freeze({
    id: "visual-metrics-typography-good",
    path: "examples/ui-quality-fixtures/visual-metrics-typography-good.html",
    metric: "typography",
    role: "good"
  }),
  Object.freeze({
    id: "visual-metrics-typography-bad",
    path: "examples/ui-quality-fixtures/visual-metrics-typography-bad.html",
    metric: "typography",
    role: "bad"
  }),
  Object.freeze({
    id: "visual-metrics-palette-good",
    path: "examples/ui-quality-fixtures/visual-metrics-palette-good.html",
    metric: "palette",
    role: "good"
  }),
  Object.freeze({
    id: "visual-metrics-palette-bad",
    path: "examples/ui-quality-fixtures/visual-metrics-palette-bad.html",
    metric: "palette",
    role: "bad"
  }),
  Object.freeze({
    id: "visual-metrics-density-good",
    path: "examples/ui-quality-fixtures/visual-metrics-density-good.html",
    metric: "density",
    role: "good"
  }),
  Object.freeze({
    id: "visual-metrics-density-bad",
    path: "examples/ui-quality-fixtures/visual-metrics-density-bad.html",
    metric: "density",
    role: "bad"
  }),
  Object.freeze({
    id: "merchant-dashboard-non-regression",
    path: "examples/merchant-dashboard/index.html",
    metric: "all",
    role: "non-regression"
  })
]);
const atomicFixturePathSet = new Set(expectedAtomicFixturePaths());

const expectedPairs = Object.freeze([
  Object.freeze({
    id: "typography",
    goodCaseId: "visual-metrics-typography-good",
    badCaseId: "visual-metrics-typography-bad",
    isolatedCriterionId: expectedContracts.typography.criterionId
  }),
  Object.freeze({
    id: "palette",
    goodCaseId: "visual-metrics-palette-good",
    badCaseId: "visual-metrics-palette-bad",
    isolatedCriterionId: expectedContracts.palette.criterionId
  }),
  Object.freeze({
    id: "density",
    goodCaseId: "visual-metrics-density-good",
    badCaseId: "visual-metrics-density-bad",
    isolatedCriterionId: expectedContracts.density.criterionId
  })
]);

const policyKeys = Object.freeze({
  typography: ["methodId", "maxDistinctVariants", "policyId"],
  palette: ["maxChromaticHueFamilies", "maxDistinctColors", "methodId", "policyId"],
  density: [
    "maxTextClusters",
    "maxVisibleElements",
    "methodId",
    "policyId",
    "textClusterMethodId",
    "visibleElementMethodId"
  ]
});

const expectedCorpusPolicy = Object.freeze({
  typography: Object.freeze({
    policyId: expectedContracts.typography.policyId,
    methodId: expectedContracts.typography.methodId,
    maxDistinctVariants: 64
  }),
  palette: Object.freeze({
    policyId: expectedContracts.palette.policyId,
    methodId: expectedContracts.palette.methodId,
    maxDistinctColors: 64,
    maxChromaticHueFamilies: 12
  }),
  density: Object.freeze({
    policyId: expectedContracts.density.policyId,
    methodId: expectedContracts.density.methodId,
    visibleElementMethodId: expectedContracts.density.visibleElementMethodId,
    textClusterMethodId: expectedContracts.density.textClusterMethodId,
    maxVisibleElements: 500,
    maxTextClusters: 200
  })
});

const measurementKeys = Object.freeze({
  typography: [
    "candidateElementCount",
    "collectedElementCount",
    "coverage",
    "distinctVariantCount",
    "emittedVariantCount",
    "evaluatedElementCount",
    "ignoredElementCount",
    "maxDistinctVariants",
    "methodId",
    "omittedVariantCount",
    "policyId",
    "skippedByReason",
    "skippedElementCount"
  ],
  palette: [
    "candidateSlotCount",
    "collectedSlotCount",
    "coverage",
    "distinctColorCount",
    "emittedColorCount",
    "evaluatedSlotCount",
    "hueFamilyCount",
    "ignoredByReason",
    "ignoredSlotCount",
    "maxChromaticHueFamilies",
    "maxDistinctColors",
    "methodId",
    "omittedColorCount",
    "policyId",
    "skippedByReason",
    "skippedSlotCount"
  ],
  density: [
    "maxTextClusters",
    "maxVisibleElements",
    "methodId",
    "policyId",
    "textClusterMethodId",
    "textClusters",
    "visibleElementMethodId",
    "visibleElements"
  ]
});

export async function readVisualMetricsCalibrationInputs() {
  const manifestBytes = await readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const corpusPaths = await listHtmlFixturePaths(fixtureRoot);
  const fixtureBytes = new Map();
  if (Array.isArray(manifest.cases)) {
    for (const record of manifest.cases) {
      if (isRecord(record) && typeof record.path === "string") {
        const absolutePath = resolve(repoRoot, record.path);
        if (absolutePath.startsWith(`${repoRoot}${sep}`)) {
          fixtureBytes.set(record.path, await readFile(absolutePath));
        }
      }
    }
  }
  for (const path of corpusPaths) {
    fixtureBytes.set(path, await readFile(resolve(repoRoot, path)));
  }
  const [designGuideSource, criteriaSource] = await Promise.all([
    readFile(designGuideSourcePath, "utf8"),
    readFile(criteriaSourcePath, "utf8")
  ]);
  return { manifest, fixtureBytes, corpusPaths, designGuideSource, criteriaSource };
}

export function validateVisualMetricsCalibration({
  manifest,
  fixtureBytes,
  corpusPaths,
  designGuideSource,
  criteriaSource
}) {
  const errors = [];
  if (!checkExactKeys(
    manifest,
    ["cases", "contracts", "corpus", "pairs", "provenance", "schemaVersion", "viewport"],
    "$",
    errors
  )) {
    return errors;
  }

  equal(manifest.schemaVersion, "visual-metrics-calibration/v1", "$.schemaVersion", errors);
  validateProvenance(manifest.provenance, errors);
  validateViewport(manifest.viewport, errors);
  validateContracts(manifest.contracts, designGuideSource, criteriaSource, errors);
  validatePairs(manifest.pairs, errors);
  validateCases(manifest.cases, fixtureBytes, errors);
  validateCorpus(manifest.corpus, corpusPaths, fixtureBytes, errors);
  validateAtomicSourceDeltas(fixtureBytes, errors);
  return errors;
}

function validateProvenance(value, errors) {
  if (!checkExactKeys(
    value,
    ["fixtureAuthorship", "hashAlgorithm", "hashInput", "license", "recordedAt"],
    "$.provenance",
    errors
  )) {
    return;
  }
  equal(
    value.fixtureAuthorship,
    "project-authored synthetic fixtures plus the existing project merchant dashboard",
    "$.provenance.fixtureAuthorship",
    errors
  );
  equal(value.license, "Apache-2.0", "$.provenance.license", errors);
  equal(value.hashAlgorithm, "sha256", "$.provenance.hashAlgorithm", errors);
  equal(value.hashInput, "raw-file-bytes", "$.provenance.hashInput", errors);
  equal(value.recordedAt, "2026-07-26", "$.provenance.recordedAt", errors);
}

function validateViewport(value, errors) {
  if (!checkExactKeys(
    value,
    ["deviceScaleFactor", "height", "isMobile", "name", "width"],
    "$.viewport",
    errors
  )) {
    return;
  }
  const expected = {
    name: "desktop",
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    isMobile: false
  };
  for (const [key, expectedValue] of Object.entries(expected)) {
    equal(value[key], expectedValue, `$.viewport.${key}`, errors);
  }
}

function validateContracts(value, designGuideSource, criteriaSource, errors) {
  if (!checkExactKeys(value, ["density", "palette", "typography"], "$.contracts", errors)) {
    return;
  }
  for (const metric of ["typography", "palette", "density"]) {
    const contract = value[metric];
    const expected = expectedContracts[metric];
    if (!checkExactKeys(contract, Object.keys(expected), `$.contracts.${metric}`, errors)) {
      continue;
    }
    for (const [key, expectedValue] of Object.entries(expected)) {
      equal(contract[key], expectedValue, `$.contracts.${metric}.${key}`, errors);
    }
  }
  validateSourceConstant(
    designGuideSource,
    "TYPOGRAPHY_VARIANT_BUDGET_POLICY_ID",
    expectedContracts.typography.policyId,
    errors
  );
  validateSourceConstant(
    designGuideSource,
    "TYPOGRAPHY_VARIANT_METHOD_ID",
    expectedContracts.typography.methodId,
    errors
  );
  validateSourceConstant(
    designGuideSource,
    "PALETTE_DISCIPLINE_BUDGET_POLICY_ID",
    expectedContracts.palette.policyId,
    errors
  );
  validateSourceConstant(
    designGuideSource,
    "PALETTE_DISCIPLINE_METHOD_ID",
    expectedContracts.palette.methodId,
    errors
  );
  validateSourceConstant(
    designGuideSource,
    "DENSITY_COMPLEXITY_BUDGET_POLICY_ID",
    expectedContracts.density.policyId,
    errors
  );
  validateSourceConstant(
    designGuideSource,
    "DENSITY_COMPLEXITY_METHOD_ID",
    expectedContracts.density.methodId,
    errors
  );
  validateSourceConstant(
    designGuideSource,
    "DENSITY_VISIBLE_ELEMENT_METHOD_ID",
    expectedContracts.density.visibleElementMethodId,
    errors
  );
  validateSourceConstant(
    designGuideSource,
    "DENSITY_TEXT_CLUSTER_METHOD_ID",
    expectedContracts.density.textClusterMethodId,
    errors
  );
  for (const contract of Object.values(expectedContracts)) {
    validateCriterionSource(criteriaSource, contract, errors);
  }
}

function validatePairs(value, errors) {
  if (!Array.isArray(value) || value.length !== expectedPairs.length) {
    errors.push("$.pairs must contain the exact three closed pair records");
    return;
  }
  for (const [index, expected] of expectedPairs.entries()) {
    const pair = value[index];
    const path = `$.pairs[${index}]`;
    if (!checkExactKeys(
      pair,
      ["badCaseId", "goodCaseId", "id", "isolatedCriterionId"],
      path,
      errors
    )) {
      continue;
    }
    for (const [key, expectedValue] of Object.entries(expected)) {
      equal(pair[key], expectedValue, `${path}.${key}`, errors);
    }
  }
}

function validateCases(value, fixtureBytes, errors) {
  if (!Array.isArray(value) || value.length !== expectedCaseRecords.length) {
    errors.push("$.cases must contain the exact ordered seven-case calibration set");
    return;
  }
  const seenIds = new Set();
  const seenPaths = new Set();
  for (const [index, expected] of expectedCaseRecords.entries()) {
    const record = value[index];
    const path = `$.cases[${index}]`;
    if (!checkExactKeys(
      record,
      ["expected", "fixtureSha256", "id", "metric", "path", "policy", "role"],
      path,
      errors
    )) {
      continue;
    }
    for (const key of ["id", "path", "metric", "role"]) {
      equal(record[key], expected[key], `${path}.${key}`, errors);
    }
    const metricIsSupported = calibrationMetricSet.has(record.metric);
    if (!metricIsSupported) {
      errors.push(
        `${path}.metric must be one of ${calibrationMetrics.map(JSON.stringify).join(", ")}`
      );
    }
    if (seenIds.has(record.id)) {
      errors.push(`${path}.id duplicates ${JSON.stringify(record.id)}`);
    }
    if (seenPaths.has(record.path)) {
      errors.push(`${path}.path duplicates ${JSON.stringify(record.path)}`);
    }
    seenIds.add(record.id);
    seenPaths.add(record.path);
    validateFixture(record, fixtureBytes?.get(record.path), path, errors);
    if (!metricIsSupported) {
      continue;
    }
    validateRecordPolicyAndExpectation(record, path, errors);
  }
}

function validateCorpus(value, discoveredPaths, fixtureBytes, errors) {
  if (!checkExactKeys(
    value,
    ["entries", "policy", "projection", "repeatCount"],
    "$.corpus",
    errors
  )) {
    return;
  }
  equal(value.repeatCount, 3, "$.corpus.repeatCount", errors);
  validateCorpusProjection(value.projection, errors);
  rejectSelectorKeys(value.policy, "$.corpus.policy", errors);
  if (checkExactKeys(value.policy, ["density", "palette", "typography"], "$.corpus.policy", errors)) {
    for (const metric of ["typography", "palette", "density"]) {
      const policy = value.policy[metric];
      const expected = expectedCorpusPolicy[metric];
      if (!checkExactKeys(policy, policyKeys[metric], `$.corpus.policy.${metric}`, errors)) {
        continue;
      }
      for (const [key, expectedValue] of Object.entries(expected)) {
        equal(policy[key], expectedValue, `$.corpus.policy.${metric}.${key}`, errors);
      }
    }
  }

  const expectedPaths = Array.isArray(discoveredPaths)
    ? discoveredPaths.filter((path) => !atomicFixturePathSet.has(path)).sort(compareCodePoints)
    : [];
  if (!Array.isArray(value.entries) || value.entries.length !== expectedPaths.length) {
    errors.push(
      `$.corpus.entries must exactly close over ${expectedPaths.length} pre-existing unrelated HTML fixtures`
    );
    return;
  }

  let reviewedNoticeCount = 0;
  const seenIds = new Set();
  for (const [index, expectedPath] of expectedPaths.entries()) {
    const entry = value.entries[index];
    const path = `$.corpus.entries[${index}]`;
    if (!checkExactKeys(
      entry,
      ["expectedNotices", "fixtureSha256", "id", "path", "projectionSha256"],
      path,
      errors
    )) {
      continue;
    }
    equal(entry.path, expectedPath, `${path}.path`, errors);
    equal(entry.id, corpusIdForPath(expectedPath), `${path}.id`, errors);
    if (
      typeof entry.id !== "string"
      || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(entry.id)
    ) {
      errors.push(`${path}.id must be a lowercase kebab-case path segment`);
    } else if (seenIds.has(entry.id)) {
      errors.push(`${path}.id duplicates ${JSON.stringify(entry.id)}`);
    } else {
      seenIds.add(entry.id);
    }
    validateSha256(entry.fixtureSha256, `${path}.fixtureSha256`, errors);
    validateSha256(entry.projectionSha256, `${path}.projectionSha256`, errors);
    const bytes = fixtureBytes?.get(entry.path);
    if (!Buffer.isBuffer(bytes)) {
      errors.push(`${path}.path could not be read as a corpus fixture`);
    } else {
      equal(
        entry.fixtureSha256,
        createHash("sha256").update(bytes).digest("hex"),
        `${path}.fixtureSha256 raw-byte digest`,
        errors
      );
    }
    const expectedNotices = expectedCorpusNotices(expectedPath);
    if (JSON.stringify(entry.expectedNotices) !== JSON.stringify(expectedNotices)) {
      errors.push(`${path}.expectedNotices must exactly pin the reviewed metric notices`);
    }
    reviewedNoticeCount += Array.isArray(entry.expectedNotices)
      ? entry.expectedNotices.length
      : 0;
  }
  equal(reviewedNoticeCount, 1, "$.corpus exact reviewed notice count", errors);
}

function validateCorpusProjection(value, errors) {
  if (!checkExactKeys(value, ["omittedFields", "profile"], "$.corpus.projection", errors)) {
    return;
  }
  equal(
    value.profile,
    VISUAL_METRICS_CORPUS_PROJECTION_PROFILE,
    "$.corpus.projection.profile",
    errors
  );
  if (
    JSON.stringify(value.omittedFields)
    !== JSON.stringify(VISUAL_METRICS_CORPUS_OMITTED_FIELDS)
  ) {
    errors.push(
      "$.corpus.projection.omittedFields must exactly name the two "
      + "font-layout-sensitive diagnostic fields"
    );
  }
}

function validateFixture(record, bytes, path, errors) {
  if (typeof record.fixtureSha256 !== "string" || !/^[0-9a-f]{64}$/u.test(record.fixtureSha256)) {
    errors.push(`${path}.fixtureSha256 must be 64 lowercase hexadecimal characters`);
    return;
  }
  if (!Buffer.isBuffer(bytes)) {
    errors.push(`${path}.path could not be read as a repository fixture`);
    return;
  }
  const actualHash = createHash("sha256").update(bytes).digest("hex");
  equal(record.fixtureSha256, actualHash, `${path}.fixtureSha256 raw-byte digest`, errors);
  const source = bytes.toString("utf8");
  if (!/^<!doctype html>/u.test(source)) {
    errors.push(`${path}.path must start with the HTML doctype`);
  }
  if (!/<html lang="en">/u.test(source)) {
    errors.push(`${path}.path must declare exact lang=en provenance`);
  }
  if (!/<main(?:\s|>)/u.test(source) || !/<\/main>/u.test(source)) {
    errors.push(`${path}.path must contain a main landmark`);
  }
}

function validateRecordPolicyAndExpectation(record, path, errors) {
  if (!checkExactKeys(record.expected, ["findings", "measurement"], `${path}.expected`, errors)) {
    return;
  }
  rejectSelectorKeys(record.policy, `${path}.policy`, errors);
  if (record.metric === "all") {
    if (!checkExactKeys(record.policy, ["density", "palette", "typography"], `${path}.policy`, errors)) {
      return;
    }
    if (!checkExactKeys(
      record.expected.measurement,
      ["density", "palette", "typography"],
      `${path}.expected.measurement`,
      errors
    )) {
      return;
    }
    for (const metric of ["typography", "palette", "density"]) {
      validateMetric(
        metric,
        record.policy[metric],
        record.expected.measurement[metric],
        `${path}.${metric}`,
        errors
      );
    }
  } else {
    validateMetric(
      record.metric,
      record.policy,
      record.expected.measurement,
      path,
      errors
    );
  }
  validateFindings(record, path, errors);
}

function validateMetric(metric, policy, measurement, path, errors) {
  if (!calibrationMetricSet.has(metric) || metric === "all") {
    errors.push(`${path} uses unsupported atomic metric ${JSON.stringify(metric)}`);
    return;
  }
  if (!checkExactKeys(policy, policyKeys[metric], `${path}.policy`, errors)) {
    return;
  }
  if (!checkExactKeys(
    measurement,
    measurementKeys[metric],
    `${path}.expected.measurement`,
    errors
  )) {
    return;
  }
  const contract = expectedContracts[metric];
  for (const idKey of ["policyId", "methodId", "visibleElementMethodId", "textClusterMethodId"]) {
    if (idKey in contract) {
      equal(policy[idKey], contract[idKey], `${path}.policy.${idKey}`, errors);
      equal(measurement[idKey], contract[idKey], `${path}.expected.measurement.${idKey}`, errors);
    }
  }
  for (const budget of metricBudgets(metric)) {
    validateBudget(metric, budget, policy[budget], `${path}.policy.${budget}`, errors);
    equal(
      measurement[budget],
      policy[budget],
      `${path}.expected.measurement.${budget}`,
      errors
    );
  }
  equal(measurement.coverage, metric === "density" ? undefined : "complete", `${path}.expected.measurement.coverage`, errors, metric === "density");
  switch (metric) {
    case "typography":
      validateTypographyMeasurement(measurement, path, errors);
      break;
    case "palette":
      validatePaletteMeasurement(measurement, path, errors);
      break;
    case "density":
      validateDensityMeasurement(measurement, policy, path, errors);
      break;
  }
}

function validateTypographyMeasurement(value, path, errors) {
  validateCountFields(value, [
    "candidateElementCount",
    "collectedElementCount",
    "evaluatedElementCount",
    "ignoredElementCount",
    "skippedElementCount",
    "distinctVariantCount",
    "emittedVariantCount",
    "omittedVariantCount"
  ], `${path}.expected.measurement`, errors);
  validateEmptyCountMap(value.skippedByReason, `${path}.expected.measurement.skippedByReason`, errors);
  equal(
    value.candidateElementCount,
    value.evaluatedElementCount + value.ignoredElementCount + value.skippedElementCount,
    `${path}.expected.measurement typography accounting`,
    errors
  );
  equal(
    value.collectedElementCount,
    value.evaluatedElementCount,
    `${path}.expected.measurement complete collected/evaluated count`,
    errors
  );
  equal(
    value.emittedVariantCount + value.omittedVariantCount,
    value.distinctVariantCount,
    `${path}.expected.measurement variant sample accounting`,
    errors
  );
  equal(
    value.emittedVariantCount,
    Math.min(5, value.distinctVariantCount),
    `${path}.expected.measurement emittedVariantCount`,
    errors
  );
  if (value.distinctVariantCount > value.evaluatedElementCount) {
    errors.push(`${path}.expected.measurement distinct variants exceed evaluated elements`);
  }
  if (value.candidateElementCount > 2_000) {
    errors.push(`${path}.expected.measurement exceeds the typography candidate safety cap`);
  }
}

function validatePaletteMeasurement(value, path, errors) {
  validateCountFields(value, [
    "candidateSlotCount",
    "collectedSlotCount",
    "evaluatedSlotCount",
    "ignoredSlotCount",
    "skippedSlotCount",
    "distinctColorCount",
    "emittedColorCount",
    "omittedColorCount",
    "hueFamilyCount"
  ], `${path}.expected.measurement`, errors);
  validateEmptyCountMap(value.skippedByReason, `${path}.expected.measurement.skippedByReason`, errors);
  const ignoredTotal = validateReasonCountMap(
    value.ignoredByReason,
    paletteIgnoreReasonSet,
    `${path}.expected.measurement.ignoredByReason`,
    errors
  );
  if (ignoredTotal !== undefined) {
    equal(
      ignoredTotal,
      value.ignoredSlotCount,
      `${path}.expected.measurement ignored-slot accounting`,
      errors
    );
  }
  equal(
    value.candidateSlotCount,
    value.evaluatedSlotCount + value.ignoredSlotCount + value.skippedSlotCount,
    `${path}.expected.measurement palette accounting`,
    errors
  );
  if (value.candidateSlotCount > 5_000) {
    errors.push(`${path}.expected.measurement exceeds the palette slot safety cap`);
  }
  equal(
    value.collectedSlotCount,
    value.candidateSlotCount,
    `${path}.expected.measurement complete collected/candidate count`,
    errors
  );
  equal(
    value.emittedColorCount + value.omittedColorCount,
    value.distinctColorCount,
    `${path}.expected.measurement color sample accounting`,
    errors
  );
  equal(
    value.emittedColorCount,
    Math.min(5, value.distinctColorCount),
    `${path}.expected.measurement emittedColorCount`,
    errors
  );
}

function validateDensityMeasurement(value, policy, path, errors) {
  const visible = value.visibleElements;
  const text = value.textClusters;
  if (!checkExactKeys(visible, [
    "coverage",
    "elementUniverseCount",
    "emittedSampleCount",
    "ignoredElementCount",
    "ineligibleElementCount",
    "maxVisibleElements",
    "methodId",
    "omittedSampleCount",
    "skippedByReason",
    "skippedElementCount",
    "visibleElementCount"
  ], `${path}.expected.measurement.visibleElements`, errors)) {
    return;
  }
  if (!checkExactKeys(text, [
    "coverage",
    "edgeTestCount",
    "emittedSampleCount",
    "evaluatedTextNodeCount",
    "ignoredTextNodeCount",
    "ineligibleTextNodeCount",
    "maxTextClusters",
    "methodId",
    "omittedSampleCount",
    "skippedByReason",
    "skippedTextNodeCount",
    "textClusterCount",
    "textFragmentCount",
    "textNodeUniverseCount"
  ], `${path}.expected.measurement.textClusters`, errors)) {
    return;
  }
  equal(visible.methodId, expectedContracts.density.visibleElementMethodId, `${path}.visibleElements.methodId`, errors);
  equal(text.methodId, expectedContracts.density.textClusterMethodId, `${path}.textClusters.methodId`, errors);
  equal(visible.maxVisibleElements, policy.maxVisibleElements, `${path}.visibleElements.maxVisibleElements`, errors);
  equal(text.maxTextClusters, policy.maxTextClusters, `${path}.textClusters.maxTextClusters`, errors);
  equal(visible.coverage, "complete", `${path}.visibleElements.coverage`, errors);
  equal(text.coverage, "complete", `${path}.textClusters.coverage`, errors);
  validateCountFields(visible, [
    "elementUniverseCount",
    "visibleElementCount",
    "ignoredElementCount",
    "ineligibleElementCount",
    "skippedElementCount",
    "emittedSampleCount",
    "omittedSampleCount"
  ], `${path}.visibleElements`, errors);
  validateCountFields(text, [
    "textNodeUniverseCount",
    "ignoredTextNodeCount",
    "ineligibleTextNodeCount",
    "skippedTextNodeCount",
    "evaluatedTextNodeCount",
    "textFragmentCount",
    "textClusterCount",
    "edgeTestCount",
    "emittedSampleCount",
    "omittedSampleCount"
  ], `${path}.textClusters`, errors);
  validateEmptyCountMap(visible.skippedByReason, `${path}.visibleElements.skippedByReason`, errors);
  validateEmptyCountMap(text.skippedByReason, `${path}.textClusters.skippedByReason`, errors);
  equal(
    visible.elementUniverseCount,
    visible.visibleElementCount + visible.ignoredElementCount
      + visible.ineligibleElementCount + visible.skippedElementCount,
    `${path}.visibleElements accounting`,
    errors
  );
  equal(
    text.textNodeUniverseCount,
    text.ignoredTextNodeCount + text.ineligibleTextNodeCount
      + text.skippedTextNodeCount + text.evaluatedTextNodeCount,
    `${path}.textClusters node accounting`,
    errors
  );
  equal(
    visible.emittedSampleCount + visible.omittedSampleCount,
    visible.visibleElementCount,
    `${path}.visibleElements sample accounting`,
    errors
  );
  equal(
    text.emittedSampleCount + text.omittedSampleCount,
    text.textClusterCount,
    `${path}.textClusters sample accounting`,
    errors
  );
  equal(visible.emittedSampleCount, Math.min(10, visible.visibleElementCount), `${path}.visibleElements emittedSampleCount`, errors);
  equal(text.emittedSampleCount, Math.min(10, text.textClusterCount), `${path}.textClusters emittedSampleCount`, errors);
  if (text.textClusterCount > text.textFragmentCount) {
    errors.push(`${path}.textClusters textClusterCount exceeds textFragmentCount`);
  }
  if (visible.elementUniverseCount > 10_000) {
    errors.push(`${path}.visibleElements exceeds the DOM safety cap`);
  }
  if (text.textNodeUniverseCount > 20_000 || text.textFragmentCount > 20_000) {
    errors.push(`${path}.textClusters exceeds a text evidence safety cap`);
  }
  if (text.edgeTestCount > 1_000_000) {
    errors.push(`${path}.textClusters exceeds the edge-test safety cap`);
  }
}

function validateFindings(record, path, errors) {
  const findings = record.expected.findings;
  if (!Array.isArray(findings)) {
    errors.push(`${path}.expected.findings must be an array`);
    return;
  }
  const metrics = record.metric === "all"
    ? ["typography", "palette", "density"]
    : [record.metric];
  const derived = metrics.flatMap((metric) => {
    const measurement = record.metric === "all"
      ? record.expected.measurement[metric]
      : record.expected.measurement;
    const overages = deriveOverages(metric, measurement);
    return overages.length === 0 ? [] : [{ metric, overages }];
  });
  if (record.role === "bad") {
    if (derived.length !== 1 || findings.length !== 1) {
      errors.push(`${path} bad case must record exactly one metric finding`);
      return;
    }
  } else if (derived.length !== 0 || findings.length !== 0) {
    errors.push(`${path} ${record.role} case must have no metric overage or finding`);
    return;
  } else {
    return;
  }

  const finding = findings[0];
  if (!checkExactKeys(finding, [
    "checkName",
    "confidence",
    "criterionId",
    "determinism",
    "overages",
    "resultKind",
    "severity"
  ], `${path}.expected.findings[0]`, errors)) {
    return;
  }
  const contract = expectedContracts[derived[0].metric];
  equal(finding.checkName, contract.checkName, `${path}.expected.findings[0].checkName`, errors);
  equal(finding.criterionId, contract.criterionId, `${path}.expected.findings[0].criterionId`, errors);
  equal(finding.determinism, "heuristic", `${path}.expected.findings[0].determinism`, errors);
  equal(finding.resultKind, "risk", `${path}.expected.findings[0].resultKind`, errors);
  equal(finding.severity, "low", `${path}.expected.findings[0].severity`, errors);
  equal(finding.confidence, "low", `${path}.expected.findings[0].confidence`, errors);
  if (JSON.stringify(finding.overages) !== JSON.stringify(derived[0].overages)) {
    errors.push(`${path}.expected.findings[0].overages must exactly match the measurement overages`);
  }
}

function deriveOverages(metric, measurement) {
  let candidates;
  switch (metric) {
    case "typography":
      candidates = [[
        "distinctVariantCount",
        measurement.distinctVariantCount,
        measurement.maxDistinctVariants,
        measurement.coverage
      ]];
      break;
    case "palette":
      candidates = [
        [
          "distinctColorCount",
          measurement.distinctColorCount,
          measurement.maxDistinctColors,
          measurement.coverage
        ],
        [
          "hueFamilyCount",
          measurement.hueFamilyCount,
          measurement.maxChromaticHueFamilies,
          measurement.coverage
        ]
      ];
      break;
    case "density":
      candidates = [
        [
          "visibleElementCount",
          measurement.visibleElements.visibleElementCount,
          measurement.maxVisibleElements,
          measurement.visibleElements.coverage
        ],
        [
          "textClusterCount",
          measurement.textClusters.textClusterCount,
          measurement.maxTextClusters,
          measurement.textClusters.coverage
        ]
      ];
      break;
    default:
      throw new Error(`Unsupported calibration metric: ${metric}`);
  }
  return candidates
    .filter(([, observed, maximum]) => observed > maximum)
    .map(([component, observedCount, configuredMaximum, coverage]) => ({
      component,
      observedCount,
      configuredMaximum,
      excess: observedCount - configuredMaximum,
      coverage
    }));
}

function validateAtomicSourceDeltas(fixtureBytes, errors) {
  const source = (path) => fixtureBytes?.get(path)?.toString("utf8");
  const typographyGood = source(expectedCaseRecords[0].path);
  const typographyBad = source(expectedCaseRecords[1].path);
  if (
    typographyGood
    && typographyBad
    && typographyBad.replace(
      "      h1 {\n        font-size: 20px;\n      }\n",
      ""
    ) !== typographyGood
  ) {
    errors.push("typography pair must differ only by the isolated h1 font-size defect");
  }
  const paletteGood = source(expectedCaseRecords[2].path);
  const paletteBad = source(expectedCaseRecords[3].path);
  if (
    paletteGood
    && paletteBad
    && paletteBad.replace(
      "        margin-top: 1rem;\n        color: #1565c0;",
      "        margin-top: 1rem;"
    ) !== paletteGood
  ) {
    errors.push("palette pair must differ only by the isolated paragraph color defect");
  }
  const densityGood = source(expectedCaseRecords[4].path);
  const densityBad = source(expectedCaseRecords[5].path);
  if (
    densityGood
    && densityBad
    && densityBad.replace(
      "<p>A third text owner introduces one isolated density overage.</p>",
      ""
    ) !== densityGood
  ) {
    errors.push("density pair must differ only by the isolated third text owner");
  }
}

function validateSourceConstant(source, name, expected, errors) {
  const pattern = new RegExp(
    `export const ${name} = "([^"]+)" as const;`,
    "u"
  );
  const match = typeof source === "string" ? source.match(pattern) : null;
  if (!match) {
    errors.push(`packages/core/src/design-guide.ts must expose ${name} as a string literal`);
    return;
  }
  equal(match[1], expected, `source constant ${name}`, errors);
}

function validateCriterionSource(source, contract, errors) {
  if (typeof source !== "string") {
    errors.push("packages/core/src/criteria.ts could not be parsed");
    return;
  }
  const start = source.indexOf(`id: "${contract.criterionId}"`);
  const end = start < 0 ? -1 : source.indexOf("\n  },", start);
  const block = start < 0 || end < 0 ? "" : source.slice(start, end);
  for (const required of [
    `sourceStrength: "research-emerging"`,
    `determinism: "heuristic"`,
    `resultKind: "risk"`,
    `confidenceDefault: "low"`,
    `runtime: "computed-style"`,
    `checkNames: ["${contract.checkName}"]`
  ]) {
    if (!block.includes(required)) {
      errors.push(`criterion ${contract.criterionId} source block must contain ${required}`);
    }
  }
}

function rejectSelectorKeys(value, path, errors) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectSelectorKeys(entry, `${path}[${index}]`, errors));
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (key === "ignoreSelectors") {
      errors.push(`${path} must be selector-free`);
    }
    rejectSelectorKeys(nested, `${path}.${key}`, errors);
  }
}

function validateCountFields(value, keys, path, errors) {
  for (const key of keys) {
    if (!Number.isSafeInteger(value[key]) || value[key] < 0) {
      errors.push(`${path}.${key} must be a non-negative safe integer`);
    }
  }
}

function validateEmptyCountMap(value, path, errors) {
  if (!isRecord(value) || Object.keys(value).length !== 0) {
    errors.push(`${path} must be the exact empty object for complete calibration coverage`);
  }
}

function validateReasonCountMap(value, allowedReasons, path, errors) {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return undefined;
  }
  let total = 0;
  let countsAreValid = true;
  for (const [reason, count] of Object.entries(value)) {
    if (!allowedReasons.has(reason)) {
      errors.push(`${path}.${reason} is not a recognized reason`);
    }
    if (!Number.isSafeInteger(count) || count < 0) {
      errors.push(`${path}.${reason} must be a non-negative safe integer`);
      countsAreValid = false;
    } else {
      total += count;
    }
  }
  return countsAreValid ? total : undefined;
}

function validatePositiveInteger(value, path, errors) {
  if (!Number.isSafeInteger(value) || value < 1) {
    errors.push(`${path} must be a positive safe integer`);
  }
}

function validateBudget(metric, budget, value, path, errors) {
  validatePositiveInteger(value, path, errors);
  let maximum;
  switch (metric) {
    case "typography":
      if (budget !== "maxDistinctVariants") {
        throw new Error(`Unsupported typography budget: ${budget}`);
      }
      maximum = 2_000;
      break;
    case "palette":
      if (budget === "maxDistinctColors") {
        maximum = 5_000;
      } else if (budget === "maxChromaticHueFamilies") {
        maximum = 12;
      } else {
        throw new Error(`Unsupported palette budget: ${budget}`);
      }
      break;
    case "density":
      if (budget === "maxVisibleElements") {
        maximum = 10_000;
      } else if (budget === "maxTextClusters") {
        maximum = 20_000;
      } else {
        throw new Error(`Unsupported density budget: ${budget}`);
      }
      break;
    default:
      throw new Error(`Unsupported calibration metric: ${metric}`);
  }
  if (Number.isSafeInteger(value) && value > maximum) {
    errors.push(`${path} exceeds the frozen safety maximum ${maximum}`);
  }
}

function validateSha256(value, path, errors) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) {
    errors.push(`${path} must be 64 lowercase hexadecimal characters`);
  }
}

function expectedAtomicFixturePaths() {
  return expectedCaseRecords
    .filter((record) => record.role === "good" || record.role === "bad")
    .map((record) => record.path);
}

function expectedCorpusNotices(path) {
  if (path !== "examples/ui-quality-fixtures/color-adherence-incomplete.html") {
    return [];
  }
  return [{
    code: "palette-discipline-slots-skipped",
    viewport: "desktop",
    skippedSlotCount: 1,
    skippedByReason: {
      "unsupported-color": 1
    },
    methodId: expectedContracts.palette.methodId
  }];
}

function corpusIdForPath(path) {
  return path
    .slice(fixturePathPrefix.length, -".html".length)
    .replaceAll("/", "-");
}

async function listHtmlFixturePaths(root) {
  const output = [];
  await visit(root);
  return output.sort(compareCodePoints);

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => compareCodePoints(left.name, right.name))) {
      const absolutePath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (entry.isFile() && entry.name.endsWith(".html")) {
        output.push(absolutePath.slice(repoRoot.length + 1));
      }
    }
  }
}

function compareCodePoints(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function metricBudgets(metric) {
  switch (metric) {
    case "typography":
      return ["maxDistinctVariants"];
    case "palette":
      return ["maxDistinctColors", "maxChromaticHueFamilies"];
    case "density":
      return ["maxVisibleElements", "maxTextClusters"];
    default:
      throw new Error(`Unsupported calibration metric: ${metric}`);
  }
}

function checkExactKeys(value, keys, path, errors) {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return false;
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    errors.push(`${path} keys must be exactly ${expected.join(", ")}`);
    return false;
  }
  return true;
}

function equal(actual, expected, path, errors, skip = false) {
  if (!skip && !Object.is(actual, expected)) {
    errors.push(`${path} must equal ${JSON.stringify(expected)}; received ${JSON.stringify(actual)}`);
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function main() {
  let inputs;
  try {
    inputs = await readVisualMetricsCalibrationInputs();
  } catch (error) {
    console.error(
      `Visual metrics calibration validation could not read its inputs: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    process.exitCode = 1;
    return;
  }
  const errors = validateVisualMetricsCalibration(inputs);
  if (errors.length > 0) {
    console.error(
      `Visual metrics calibration validation failed:\n${errors.map((error) => `- ${error}`).join("\n")}`
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    "Visual metrics calibration validation passed "
    + `(${inputs.manifest?.cases?.length ?? 0} exact cases, ${inputs.manifest?.pairs?.length ?? 0} closed pairs, `
    + `${inputs.manifest?.corpus?.entries?.length ?? 0} unrelated fixtures).`
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}

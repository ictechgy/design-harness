import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { startLocalFixtureServer } from "./local-fixture-server.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const examplesRoot = join(repoRoot, "examples");
const uiFixtureRoot = join(examplesRoot, "ui-quality-fixtures");
const manifestPath = join(
  uiFixtureRoot,
  "visual-metrics-calibration.json"
);
const outRoot = join(repoRoot, "runs", "visual-metrics");
const coreEntry = join(repoRoot, "packages", "core", "dist", "index.js");
const visualAuditEntry = join(
  repoRoot,
  "packages",
  "visual-audit",
  "dist",
  "index.js"
);
const viewport = {
  name: "desktop",
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
  isMobile: false
};
const metricCheckNames = new Set([
  "typography-variant-count-budget",
  "palette-count-discipline",
  "density-complexity-budget"
]);
const metricNoticePrefix =
  /^(?:typography-variant|palette-discipline|density-)/u;

assertBuiltPackages();

const [core, { auditUrl }] = await Promise.all([
  import(coreEntry),
  import(visualAuditEntry)
]);
const { renderMarkdownReport } = core;
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
assert.equal(
  manifest.schemaVersion,
  "visual-metrics-calibration/v1",
  "Calibration manifest schema version drifted."
);
assert(Array.isArray(manifest.cases), "Calibration manifest cases must be an array.");
assert.deepStrictEqual(
  manifest.viewport,
  viewport,
  "Calibration manifest viewport drifted from the live smoke viewport."
);
assert.deepStrictEqual(
  manifest.contracts,
  expectedContracts(core),
  "Calibration manifest policy, method, criterion, or check contracts drifted."
);
assert.equal(
  manifest.cases.filter((calibrationCase) =>
    canonicalMetric(calibrationCase.metric) !== "all"
  ).length,
  6,
  "Calibration manifest must contain the six atomic good/bad cases."
);
assert.equal(
  manifest.cases.filter((calibrationCase) =>
    canonicalMetric(calibrationCase.metric) === "all"
  ).length,
  1,
  "Calibration manifest must contain one all-metric merchant non-regression case."
);
await assertCorpusManifest(manifest);

await rm(outRoot, { recursive: true, force: true });
const fixtureServer = await startLocalFixtureServer(examplesRoot);

try {
  for (const calibrationCase of manifest.cases) {
    await runCalibrationCase(calibrationCase, fixtureServer.baseUrl);
  }
  await runCorpus(manifest.corpus, fixtureServer.baseUrl);
  console.log(
    "Visual-metrics smoke passed: "
    + `${manifest.cases.length} calibration cases and ${manifest.corpus.entries.length} `
    + `unrelated fixtures reproduced the committed matrix across ${manifest.corpus.repeatCount} corpus runs.`
  );
} finally {
  await fixtureServer.close();
}

async function runCalibrationCase(calibrationCase, baseUrl) {
  assertCalibrationCase(calibrationCase);
  const fixturePath = resolve(repoRoot, calibrationCase.path);
  assert(
    pathIsInside(examplesRoot, fixturePath),
    `${calibrationCase.id}: fixture path must remain under examples/.`
  );
  assert(
    existsSync(fixturePath),
    `${calibrationCase.id}: fixture does not exist: ${calibrationCase.path}`
  );
  assert.equal(
    createHash("sha256")
      .update(await readFile(fixturePath))
      .digest("hex"),
    calibrationCase.fixtureSha256,
    `${calibrationCase.id}: fixture hash drifted from the committed oracle.`
  );

  const outDir = join(outRoot, calibrationCase.id);
  const policies = runtimePolicies(calibrationCase);
  const urlPath = relative(examplesRoot, fixturePath)
    .split(sep)
    .map(encodeURIComponent)
    .join("/");
  const result = await auditUrl({
    url: `${baseUrl}/${urlPath}`,
    outDir,
    viewportPresets: [viewport],
    ...policies
  });

  await writeAuditArtifacts(outDir, result);

  assertAuditHealth(calibrationCase, result.auditResult);
  const measurement = measurementFor(result.auditResult, viewport.name);
  const actual = {
    measurement: projectMetricMeasurements(
      calibrationCase.metric,
      measurement
    ),
    findings: projectMetricFindings(result.auditResult.findings)
  };
  assert.deepStrictEqual(
    actual,
    calibrationCase.expected,
    `${calibrationCase.id}: live metric projection did not match the committed oracle.`
  );
}

async function runCorpus(corpus, baseUrl) {
  const firstRunHashes = new Map();
  for (let repeat = 1; repeat <= corpus.repeatCount; repeat += 1) {
    for (const entry of corpus.entries) {
      const fixturePath = resolve(repoRoot, entry.path);
      assert.equal(
        sha256(await readFile(fixturePath)),
        entry.fixtureSha256,
        `${entry.id}: corpus fixture hash drifted from the committed oracle.`
      );
      const outDir = join(
        outRoot,
        "corpus",
        `repeat-${repeat}`,
        entry.id
      );
      const urlPath = relative(examplesRoot, fixturePath)
        .split(sep)
        .map(encodeURIComponent)
        .join("/");
      const result = await auditUrl({
        url: `${baseUrl}/${urlPath}`,
        outDir,
        viewportPresets: [viewport],
        ...allRuntimePolicies(corpus.policy)
      });
      await writeAuditArtifacts(outDir, result);
      assertCorpusAuditHealth(entry, result.auditResult);

      const measurement = measurementFor(result.auditResult, viewport.name);
      const projection = {
        measurement: projectMetricMeasurements("all", measurement),
        findings: projectMetricFindings(result.auditResult.findings),
        notices: projectMetricNotices(result.auditResult.notices ?? [])
      };
      assert.deepStrictEqual(
        projection.notices,
        entry.expectedNotices,
        `${entry.id}: reviewed corpus metric notices drifted on repeat ${repeat}.`
      );
      const actualHash = sha256(stableJson(projection));
      assert.equal(
        actualHash,
        entry.projectionSha256,
        `${entry.id}: corpus projection drifted from the committed oracle on repeat ${repeat}.`
      );
      const firstRunHash = firstRunHashes.get(entry.id);
      if (firstRunHash === undefined) {
        firstRunHashes.set(entry.id, actualHash);
      } else {
        assert.equal(
          actualHash,
          firstRunHash,
          `${entry.id}: corpus projection was not repeatable on repeat ${repeat}.`
        );
      }
    }
  }
}

async function writeAuditArtifacts(outDir, result) {
  await Promise.all([
    writeFile(
      join(outDir, "audit.json"),
      `${JSON.stringify(result.auditResult, null, 2)}\n`
    ),
    writeFile(
      join(outDir, "metadata.json"),
      `${JSON.stringify(result.metadata, null, 2)}\n`
    ),
    writeFile(
      join(outDir, "report.md"),
      renderMarkdownReport({ auditResult: result.auditResult })
    )
  ]);
}

function assertBuiltPackages() {
  const missing = [coreEntry, visualAuditEntry].filter((path) => !existsSync(path));
  if (missing.length > 0) {
    throw new Error(
      "Visual-metrics smoke requires built workspace packages. "
      + `Run \`pnpm build\` first. Missing: ${missing.join(", ")}`
    );
  }
}

function expectedContracts(coreModule) {
  return {
    typography: {
      criterionId: "typography.variant-count.budget",
      checkName: "typography-variant-count-budget",
      policyId: coreModule.TYPOGRAPHY_VARIANT_BUDGET_POLICY_ID,
      methodId: coreModule.TYPOGRAPHY_VARIANT_METHOD_ID
    },
    palette: {
      criterionId: "color.palette.count-discipline",
      checkName: "palette-count-discipline",
      policyId: coreModule.PALETTE_DISCIPLINE_BUDGET_POLICY_ID,
      methodId: coreModule.PALETTE_DISCIPLINE_METHOD_ID
    },
    density: {
      criterionId: "layout.density.complexity-budget",
      checkName: "density-complexity-budget",
      policyId: coreModule.DENSITY_COMPLEXITY_BUDGET_POLICY_ID,
      methodId: coreModule.DENSITY_COMPLEXITY_METHOD_ID,
      visibleElementMethodId: coreModule.DENSITY_VISIBLE_ELEMENT_METHOD_ID,
      textClusterMethodId: coreModule.DENSITY_TEXT_CLUSTER_METHOD_ID
    }
  };
}

async function assertCorpusManifest(calibrationManifest) {
  const corpus = calibrationManifest.corpus;
  assert(
    corpus !== null && typeof corpus === "object" && !Array.isArray(corpus),
    "Calibration manifest corpus must be an object."
  );
  assert.equal(
    corpus.repeatCount,
    3,
    "Unrelated-fixture corpus must run exactly three times."
  );
  assert(
    corpus.policy !== null
      && typeof corpus.policy === "object"
      && !Array.isArray(corpus.policy),
    "Unrelated-fixture corpus policy must be an object."
  );
  assert(
    !containsKey(corpus.policy, "ignoreSelectors"),
    "Unrelated-fixture corpus policy must be selector-free."
  );
  assert.deepStrictEqual(
    Object.keys(corpus.policy).sort(),
    ["density", "palette", "typography"],
    "Unrelated-fixture corpus must configure all three metrics."
  );
  assert(Array.isArray(corpus.entries), "Calibration manifest corpus entries must be an array.");

  const atomicPaths = new Set(
    calibrationManifest.cases
      .filter((calibrationCase) => canonicalMetric(calibrationCase.metric) !== "all")
      .map((calibrationCase) => calibrationCase.path)
  );
  const expectedPaths = (await htmlFixturePaths(uiFixtureRoot))
    .map((path) => relative(repoRoot, path).split(sep).join("/"))
    .filter((path) => !atomicPaths.has(path))
    .sort();
  const entryPaths = corpus.entries.map((entry) => entry.path).sort();
  assert.deepStrictEqual(
    entryPaths,
    expectedPaths,
    "Calibration manifest corpus does not close over every unrelated UI-quality HTML fixture."
  );

  const ids = new Set();
  const paths = new Set();
  for (const entry of corpus.entries) {
    assert(
      entry !== null && typeof entry === "object" && !Array.isArray(entry),
      "Every corpus entry must be an object."
    );
    assertSafeId(entry.id, "corpus entry");
    assert(!ids.has(entry.id), `Duplicate corpus entry id: ${entry.id}`);
    ids.add(entry.id);
    assert(
      typeof entry.path === "string" && entry.path.length > 0,
      `${entry.id}: corpus path must be a non-empty string.`
    );
    assert(!paths.has(entry.path), `Duplicate corpus fixture path: ${entry.path}`);
    paths.add(entry.path);
    const fixturePath = resolve(repoRoot, entry.path);
    assert(
      pathIsInside(uiFixtureRoot, fixturePath),
      `${entry.id}: corpus fixture path must remain under examples/ui-quality-fixtures/.`
    );
    assert(
      /^[a-f0-9]{64}$/u.test(entry.fixtureSha256),
      `${entry.id}: corpus fixture SHA-256 must be lowercase hexadecimal.`
    );
    assert(
      /^[a-f0-9]{64}$/u.test(entry.projectionSha256),
      `${entry.id}: corpus projection SHA-256 must be lowercase hexadecimal.`
    );
    assert(
      Array.isArray(entry.expectedNotices),
      `${entry.id}: expectedNotices must be an array.`
    );
  }
}

function assertCalibrationCase(calibrationCase) {
  assert(
    calibrationCase !== null && typeof calibrationCase === "object",
    "Every calibration case must be an object."
  );
  for (const key of ["id", "path", "metric", "role"]) {
    assert(
      typeof calibrationCase[key] === "string" && calibrationCase[key].length > 0,
      `Calibration case ${key} must be a non-empty string.`
    );
  }
  assertSafeId(calibrationCase.id, "calibration case");
  assert(
    calibrationCase.policy !== null
      && typeof calibrationCase.policy === "object"
      && !Array.isArray(calibrationCase.policy),
    `${calibrationCase.id}: policy must be an object.`
  );
  assert(
    calibrationCase.expected !== null
      && typeof calibrationCase.expected === "object"
      && !Array.isArray(calibrationCase.expected),
    `${calibrationCase.id}: expected must be an object.`
  );
  assert(
    !containsKey(calibrationCase.policy, "ignoreSelectors"),
    `${calibrationCase.id}: committed calibration policies must be selector-free.`
  );
}

function runtimePolicies(calibrationCase) {
  switch (canonicalMetric(calibrationCase.metric)) {
    case "typography":
      return {
        typographyVariantsPolicy: {
          ...calibrationCase.policy,
          ignoreSelectors: []
        }
      };
    case "palette":
      return {
        paletteDisciplinePolicy: {
          ...calibrationCase.policy,
          ignoreSelectors: []
        }
      };
    case "density":
      return {
        densityComplexityPolicy: {
          ...calibrationCase.policy,
          ignoreSelectors: []
        }
      };
    case "all":
      return allRuntimePolicies(calibrationCase.policy);
  }
}

function allRuntimePolicies(policy) {
  return {
    typographyVariantsPolicy: {
      ...policy.typography,
      ignoreSelectors: []
    },
    paletteDisciplinePolicy: {
      ...policy.palette,
      ignoreSelectors: []
    },
    densityComplexityPolicy: {
      ...policy.density,
      ignoreSelectors: []
    }
  };
}

function canonicalMetric(metric) {
  switch (metric) {
    case "typography":
    case "typographyVariants":
    case "typography-variants":
      return "typography";
    case "palette":
    case "paletteDiscipline":
    case "palette-discipline":
      return "palette";
    case "density":
    case "densityComplexity":
    case "density-complexity":
      return "density";
    case "all":
    case "visual-metrics":
      return "all";
    default:
      throw new Error(`Unsupported calibration metric: ${metric}`);
  }
}

function assertAuditHealth(calibrationCase, auditResult) {
  assert.equal(
    auditResult.status,
    "success",
    `${calibrationCase.id}: audit status was ${auditResult.status}.`
  );
  assert.deepStrictEqual(
    auditResult.failedChecks,
    [],
    `${calibrationCase.id}: audit recorded failed checks.`
  );
  const partialMetricNotices = (auditResult.notices ?? []).filter((notice) =>
    metricNoticePrefix.test(notice.code)
  );
  assert.deepStrictEqual(
    partialMetricNotices,
    [],
    `${calibrationCase.id}: metric collection emitted a partial-coverage notice.`
  );

  const metricFindings = auditResult.findings.filter((finding) =>
    metricCheckNames.has(finding.checkName)
  );
  for (const finding of metricFindings) {
    assert.equal(
      finding.determinism,
      "heuristic",
      `${calibrationCase.id}: ${finding.checkName} determinism drifted.`
    );
    assert.equal(
      finding.resultKind,
      "risk",
      `${calibrationCase.id}: ${finding.checkName} result kind drifted.`
    );
    assert.equal(
      finding.severity,
      "low",
      `${calibrationCase.id}: ${finding.checkName} severity drifted.`
    );
    assert.equal(
      finding.confidence,
      "low",
      `${calibrationCase.id}: ${finding.checkName} confidence drifted.`
    );
    assert.equal(
      finding.runtime,
      "computed-style",
      `${calibrationCase.id}: ${finding.checkName} runtime drifted.`
    );
    assert.equal(
      finding.humanReviewRecommended,
      true,
      `${calibrationCase.id}: ${finding.checkName} review flag drifted.`
    );
  }

  if (canonicalMetric(calibrationCase.metric) === "all") {
    assert.equal(
      metricFindings.length,
      0,
      `${calibrationCase.id}: merchant non-regression emitted a visual-metric finding.`
    );
  } else {
    assert.equal(
      auditResult.findings.length,
      metricFindings.length,
      `${calibrationCase.id}: atomic fixture emitted unrelated findings: ${
        auditResult.findings
          .filter((finding) => !metricCheckNames.has(finding.checkName))
          .map((finding) => finding.checkName)
          .join(", ")
      }`
    );
  }
}

function assertCorpusAuditHealth(entry, auditResult) {
  assert.equal(
    auditResult.status,
    "success",
    `${entry.id}: corpus audit status was ${auditResult.status}.`
  );
  assert.deepStrictEqual(
    auditResult.failedChecks,
    [],
    `${entry.id}: corpus audit recorded failed checks.`
  );
  const metricFindings = auditResult.findings.filter((finding) =>
    metricCheckNames.has(finding.checkName)
  );
  assert.deepStrictEqual(
    metricFindings,
    [],
    `${entry.id}: unrelated fixture emitted a visual-metric risk.`
  );
}

function measurementFor(auditResult, viewportName) {
  const evidence = auditResult.evidenceAssets.find(
    (asset) => asset.id === `measurement-${viewportName}`
  );
  assert(evidence, `Missing measurement evidence for viewport ${viewportName}.`);
  assert(
    evidence.data !== null && typeof evidence.data === "object",
    `Measurement evidence for ${viewportName} has no data.`
  );
  return evidence.data;
}

function projectMetricMeasurements(metric, measurement) {
  switch (canonicalMetric(metric)) {
    case "typography":
      return projectTypography(measurement.typographyVariants);
    case "palette":
      return projectPalette(measurement.paletteDiscipline);
    case "density":
      return projectDensity(measurement.densityComplexity);
    case "all":
      return {
        typography: projectTypography(measurement.typographyVariants),
        palette: projectPalette(measurement.paletteDiscipline),
        density: projectDensity(measurement.densityComplexity)
      };
  }
}

function projectTypography(summary) {
  assertMetricSummary(summary, "typographyVariants");
  return {
    policyId: summary.policyId,
    methodId: summary.methodId,
    maxDistinctVariants: summary.maxDistinctVariants,
    coverage: summary.coverage,
    candidateElementCount: summary.candidateElementCount,
    collectedElementCount: summary.collectedElementCount,
    evaluatedElementCount: summary.evaluatedElementCount,
    ignoredElementCount: summary.ignoredElementCount,
    skippedElementCount: summary.skippedElementCount,
    skippedByReason: summary.skippedByReason,
    distinctVariantCount: summary.distinctVariantCount,
    emittedVariantCount: summary.emittedVariantCount,
    omittedVariantCount: summary.omittedVariantCount
  };
}

function projectPalette(summary) {
  assertMetricSummary(summary, "paletteDiscipline");
  return {
    policyId: summary.policyId,
    methodId: summary.methodId,
    ...(summary.maxDistinctColors === undefined
      ? {}
      : { maxDistinctColors: summary.maxDistinctColors }),
    ...(summary.maxChromaticHueFamilies === undefined
      ? {}
      : { maxChromaticHueFamilies: summary.maxChromaticHueFamilies }),
    coverage: summary.coverage,
    candidateSlotCount: summary.candidateSlotCount,
    collectedSlotCount: summary.collectedSlotCount,
    evaluatedSlotCount: summary.evaluatedSlotCount,
    ignoredSlotCount: summary.ignoredSlotCount,
    ignoredByReason: summary.ignoredByReason,
    skippedSlotCount: summary.skippedSlotCount,
    skippedByReason: summary.skippedByReason,
    distinctColorCount: summary.distinctColorCount,
    emittedColorCount: summary.emittedColorCount,
    omittedColorCount: summary.omittedColorCount,
    hueFamilyCount: summary.hueFamilyCount
  };
}

function projectDensity(summary) {
  assertMetricSummary(summary, "densityComplexity");
  return {
    policyId: summary.policyId,
    methodId: summary.methodId,
    visibleElementMethodId: summary.visibleElementMethodId,
    textClusterMethodId: summary.textClusterMethodId,
    ...(summary.maxVisibleElements === undefined
      ? {}
      : { maxVisibleElements: summary.maxVisibleElements }),
    ...(summary.maxTextClusters === undefined
      ? {}
      : { maxTextClusters: summary.maxTextClusters }),
    ...(summary.visibleElements
      ? { visibleElements: projectVisibleElements(summary.visibleElements) }
      : {}),
    ...(summary.textClusters
      ? { textClusters: projectTextClusters(summary.textClusters) }
      : {})
  };
}

function projectVisibleElements(summary) {
  return {
    methodId: summary.methodId,
    maxVisibleElements: summary.maxVisibleElements,
    coverage: summary.coverage,
    elementUniverseCount: summary.elementUniverseCount,
    visibleElementCount: summary.visibleElementCount,
    ignoredElementCount: summary.ignoredElementCount,
    ineligibleElementCount: summary.ineligibleElementCount,
    skippedElementCount: summary.skippedElementCount,
    skippedByReason: summary.skippedByReason,
    emittedSampleCount: summary.emittedSampleCount,
    omittedSampleCount: summary.omittedSampleCount
  };
}

function projectTextClusters(summary) {
  return {
    methodId: summary.methodId,
    maxTextClusters: summary.maxTextClusters,
    coverage: summary.coverage,
    textNodeUniverseCount: summary.textNodeUniverseCount,
    ignoredTextNodeCount: summary.ignoredTextNodeCount,
    ineligibleTextNodeCount: summary.ineligibleTextNodeCount,
    skippedTextNodeCount: summary.skippedTextNodeCount,
    evaluatedTextNodeCount: summary.evaluatedTextNodeCount,
    skippedByReason: summary.skippedByReason,
    textFragmentCount: summary.textFragmentCount,
    textClusterCount: summary.textClusterCount,
    edgeTestCount: summary.edgeTestCount,
    emittedSampleCount: summary.emittedSampleCount,
    omittedSampleCount: summary.omittedSampleCount
  };
}

function projectMetricFindings(findings) {
  return findings
    .filter((finding) => metricCheckNames.has(finding.checkName))
    .map((finding) => ({
      checkName: finding.checkName,
      criterionId: finding.criterionId,
      determinism: finding.determinism,
      resultKind: finding.resultKind,
      severity: finding.severity,
      confidence: finding.confidence,
      overages: finding.observed?.overages
    }));
}

function projectMetricNotices(notices) {
  return notices
    .filter((notice) => metricNoticePrefix.test(notice.code))
    .map((notice) => ({
      code: notice.code,
      viewport: notice.viewport ?? notice.details?.viewport,
      ...("skippedElementCount" in (notice.details ?? {})
        ? { skippedElementCount: notice.details.skippedElementCount }
        : {}),
      ...("skippedTextNodeCount" in (notice.details ?? {})
        ? { skippedTextNodeCount: notice.details.skippedTextNodeCount }
        : {}),
      ...("skippedSlotCount" in (notice.details ?? {})
        ? { skippedSlotCount: notice.details.skippedSlotCount }
        : {}),
      ...("skippedByReason" in (notice.details ?? {})
        ? { skippedByReason: notice.details.skippedByReason }
        : {}),
      ...("methodId" in (notice.details ?? {})
        ? { methodId: notice.details.methodId }
        : {}),
      ...("reasonCode" in (notice.details ?? {})
        ? { reasonCode: notice.details.reasonCode }
        : {}),
      ...("component" in (notice.details ?? {})
        ? { component: notice.details.component }
        : {})
    }))
    .sort((left, right) => compareText(
      `${left.code}\u0000${left.viewport ?? ""}`,
      `${right.code}\u0000${right.viewport ?? ""}`
    ));
}

function assertMetricSummary(summary, name) {
  assert(
    summary !== null && typeof summary === "object" && !Array.isArray(summary),
    `Measurement evidence omitted ${name}; run \`pnpm build\` before this smoke if source changed.`
  );
}

function containsKey(value, wantedKey) {
  if (Array.isArray(value)) {
    return value.some((child) => containsKey(child, wantedKey));
  }
  if (value === null || typeof value !== "object") {
    return false;
  }
  return Object.entries(value).some(
    ([key, child]) => key === wantedKey || containsKey(child, wantedKey)
  );
}

async function htmlFixturePaths(root) {
  const paths = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      paths.push(...await htmlFixturePaths(path));
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      paths.push(path);
    }
  }
  return paths.sort(compareText);
}

function assertSafeId(id, label) {
  assert(
    typeof id === "string" && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(id),
    `${label} id must be a lowercase kebab-case path segment.`
  );
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value) {
  return JSON.stringify(canonicalJson(value));
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalJson);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => compareText(left, right))
        .map(([key, child]) => [key, canonicalJson(child)])
    );
  }
  return value;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function pathIsInside(parent, candidate) {
  const child = relative(parent, candidate);
  return child !== "" && child !== ".." && !child.startsWith(`..${sep}`);
}

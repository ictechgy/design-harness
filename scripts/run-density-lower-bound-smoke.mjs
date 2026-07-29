import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startLocalFixtureServer } from "./local-fixture-server.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const outRoot = join(repoRoot, "runs", "density-lower-bound");
const tempRoot = await mkdtemp(join(tmpdir(), "design-harness-density-lower-bound-"));
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
const densityPolicy = {
  policyId: "density-complexity-budget-v1",
  methodId: "viewport-dom-density-v1",
  visibleElementMethodId: "visible-content-elements-v1",
  textClusterMethodId: "text-flow-connectivity-v1",
  ignoreSelectors: [],
  maxTextClusters: 1
};

const [core, { auditUrl }] = await Promise.all([
  import(coreEntry),
  import(visualAuditEntry)
]);
const { renderMarkdownReport } = core;

await rm(outRoot, { recursive: true, force: true });
await mkdir(outRoot, { recursive: true });
await Promise.all([
  writeFile(join(tempRoot, "good.html"), fixture(1)),
  writeFile(join(tempRoot, "bad.html"), fixture(2))
]);

const fixtureServer = await startLocalFixtureServer(tempRoot);
try {
  await runCase({
    id: "good",
    expectedLowerBound: 1,
    expectedFindingCount: 0
  });
  await runCase({
    id: "bad",
    expectedLowerBound: 2,
    expectedFindingCount: 1
  });
  console.log(
    "Density lower-bound smoke passed: partial one-root evidence stayed silent "
    + "and partial two-root evidence emitted one heuristic risk."
  );
} finally {
  await fixtureServer.close();
  await rm(tempRoot, { recursive: true, force: true });
}

async function runCase({ id, expectedLowerBound, expectedFindingCount }) {
  const outDir = join(outRoot, id);
  const result = await auditUrl({
    url: `${fixtureServer.baseUrl}/${id}.html`,
    outDir,
    viewportPresets: [viewport],
    densityComplexityPolicy: densityPolicy
  });
  await mkdir(outDir, { recursive: true });
  const report = renderMarkdownReport({ auditResult: result.auditResult });
  await Promise.all([
    writeFile(
      join(outDir, "audit.json"),
      `${JSON.stringify(result.auditResult, null, 2)}\n`
    ),
    writeFile(
      join(outDir, "metadata.json"),
      `${JSON.stringify(result.metadata, null, 2)}\n`
    ),
    writeFile(join(outDir, "report.md"), report)
  ]);

  assert.equal(result.auditResult.status, "success", `${id}: audit was not successful`);
  assert.deepStrictEqual(
    result.auditResult.failedChecks,
    [],
    `${id}: expected unsupported text evidence became a failed check`
  );

  const measurement = result.auditResult.evidenceAssets.find(
    (asset) => asset.id === "measurement-desktop"
  );
  assert(measurement, `${id}: missing desktop measurement evidence`);
  assert.deepStrictEqual(
    projectTextClusters(measurement.data?.densityComplexity?.textClusters),
    {
      coverage: "lower-bound",
      lowerBoundMethodId: "supported-flow-root-count-v1",
      textClusterCount: expectedLowerBound,
      edgeTestCount: null,
      emittedSampleCount: 0,
      omittedSampleCount: expectedLowerBound,
      skippedTextNodeCount: 1,
      skippedByReason: { "unsupported-clip-or-mask": 1 },
      samples: []
    },
    `${id}: text-cluster lower-bound evidence drifted`
  );

  const findings = result.auditResult.findings.filter(
    (finding) => finding.checkName === "density-complexity-budget"
  );
  assert.equal(
    findings.length,
    expectedFindingCount,
    `${id}: density finding count drifted`
  );
  if (expectedFindingCount === 1) {
    assert.deepStrictEqual(findings[0].observed?.overages, [{
      component: "textClusterCount",
      observedCount: 2,
      configuredMaximum: 1,
      excess: 1,
      coverage: "lower-bound"
    }]);
    assert.equal(findings[0].determinism, "heuristic");
    assert.equal(findings[0].resultKind, "risk");
    assert.equal(findings[0].severity, "low");
    assert.equal(findings[0].confidence, "low");
  }

  const notices = (result.auditResult.notices ?? []).filter(
    (notice) => notice.code === "density-text-clusters-incomplete"
  );
  assert.equal(notices.length, 1, `${id}: expected one partial-evidence notice`);
  assert.deepStrictEqual(notices[0].details, {
    viewport: "desktop",
    textClusterCount: expectedLowerBound,
    lowerBoundMethodId: "supported-flow-root-count-v1",
    skippedTextNodeCount: 1,
    skippedByReason: { "unsupported-clip-or-mask": 1 },
    methodId: "text-flow-connectivity-v1"
  });
  assert(
    report.includes("supported-flow-root lower bound"),
    `${id}: report did not disclose the conservative lower bound`
  );
  assert(
    !report.includes("## Failed Checks"),
    `${id}: report incorrectly rendered expected partial evidence as a failed check`
  );
}

function projectTextClusters(summary) {
  assert(summary, "Missing text-cluster summary");
  return {
    coverage: summary.coverage,
    lowerBoundMethodId: summary.lowerBoundMethodId,
    textClusterCount: summary.textClusterCount,
    edgeTestCount: summary.edgeTestCount,
    emittedSampleCount: summary.emittedSampleCount,
    omittedSampleCount: summary.omittedSampleCount,
    skippedTextNodeCount: summary.skippedTextNodeCount,
    skippedByReason: summary.skippedByReason,
    samples: summary.samples
  };
}

function fixture(representedRootCount) {
  const supported = Array.from(
    { length: representedRootCount },
    (_, index) => `<p id="supported-${index + 1}">Supported flow root ${index + 1}</p>`
  ).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Density lower-bound fixture</title>
  <style>
    body { margin: 32px; font: 16px/1.5 sans-serif; }
    p { margin: 0 0 24px; }
    .unsupported { clip-path: inset(0); }
  </style>
</head>
<body>
  <main>
    ${supported}
    <span class="unsupported">Unsupported clipped text evidence</span>
  </main>
</body>
</html>
`;
}

import { spawn } from "node:child_process";
import { createReadStream, existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { parserFreeCopyCheckNames } from "./copy-calibration-config.mjs";

const root = resolve("examples");
const outRoot = resolve("runs/example-smoke");
const noConfigOutDir = join(outRoot, "no-config");
const validGuide = resolve("examples/configs/design-guide.example.yaml");
const realStackGuide = resolve("examples/configs/design-guide.font-family-real-stack.yaml");
const invalidSelectorGuide = resolve("examples/configs/design-guide.invalid-font-selector.yaml");
const port = 4174;
const expectedRealStackAllowedFamilies = [
  { value: "Space Grotesk", kind: "named" },
  { value: "sans-serif", kind: "generic" },
  { value: "Pretendard", kind: "named" },
  { value: "Pretendard Fallback", kind: "named" },
  { value: "-apple-system", kind: "named" },
  { value: "BlinkMacSystemFont", kind: "named" },
  { value: "system-ui", kind: "generic" },
  { value: "Apple SD Gothic Neo", kind: "named" },
  { value: "Noto Sans KR", kind: "named" },
  { value: "Malgun Gothic", kind: "named" },
  { value: "JetBrains Mono", kind: "named" },
  { value: "JetBrains Mono Fallback", kind: "named" },
  { value: "ui-monospace", kind: "generic" },
  { value: "SFMono-Regular", kind: "named" },
  { value: "Menlo", kind: "named" },
  { value: "monospace", kind: "generic" },
  { value: "Space Grotesk Fallback", kind: "named" },
  { value: "system-ui", kind: "named" },
  { value: "Rogue", kind: "named" }
];

// v0.5c step 1 — measurement tripwires.
//
// `textElements` (browser-measurements.ts) is shared by four consumers: clippedText, contrastRisks,
// excessiveLineLength, and meaningfulElementCount. Narrowing that array would silently delete unrelated
// detectors, and the DOM-side clipping collector has no test coverage of any kind. These pins exist so a
// guard intended for one consumer cannot quietly change the others.
//
// meaningfulElementCount is textElements.length, so it moves if and only if the shared array moves.
const meaningfulElementCountBaseline = { desktop: 71, mobile: 66 };
const lineLengthTripwireFixture = "responsive-readability-bad.html";
const findingCoverageFixture = "finding-coverage-over-limit.html";
const overLimitCheckNames = ["dom-contrast-risk", "tap-target-risk", "text-clipping"];

// v0.5c step 2 — clean-corpus false-positive gate for dom-contrast-risk.
//
// Each pair is one correct page plus the same page with one genuinely sub-4.5:1 label. The good half
// proves the detector stays silent on correct modern styling; the defective half proves it has not been
// disabled to achieve that silence. Hand-computed reference values, written before the detector was ever
// run against these pages, live in examples/ui-quality-fixtures/clean-corpus-expected.md.
//
// `expected` pins the defective element and its ratio. A bare count is satisfiable by implementations that
// are still wrong — assuming a black backdrop scores these 2.02/2.57, ignoring translucent layers 2.19/2.53,
// compositing only the background 16.78 — so the band rejects each of those while tolerating the
// rounded-versus-fractional channel ambiguity. `evaluated` pins how many elements were actually scored,
// because a bail-out that skips everything also emits zero findings.
const cleanCorpusPairs = [
  {
    name: "clean-corpus-surface",
    good: "clean-corpus-surface.html",
    defective: "clean-corpus-surface-defective.html",
    goodEvaluated: 4,
    defectiveEvaluated: 5,
    selector: "#surface-too-faint",
    ratio: 2.28
  },
  {
    name: "clean-corpus-tokens",
    good: "clean-corpus-tokens.html",
    defective: "clean-corpus-tokens-defective.html",
    goodEvaluated: 2,
    defectiveEvaluated: 3,
    selector: "#tokens-too-faint",
    ratio: 2.2
  }
];
const cleanCorpusRatioTolerance = 0.05;
const contrastEffectFixtures = [
  {
    name: "contrast-effects",
    fixture: "contrast-effects.html",
    expectedEvaluated: 2,
    expectedSkipped: 3,
    expectedReasons: {
      filter: 1,
      "mix-blend-mode": 1,
      opacity: 1
    },
    expectedFindingSelectors: ["#contrast-control"]
  },
  {
    name: "contrast-effect-priority",
    fixture: "contrast-effect-priority.html",
    expectedEvaluated: 0,
    expectedSkipped: 6,
    expectedReasons: {
      "background-image": 1,
      "backdrop-filter": 1,
      "detached-backdrop": 1,
      filter: 1,
      "mix-blend-mode": 1,
      opacity: 1
    },
    expectedFindingSelectors: []
  }
];
// #disc is the CONJ-vs-ASYM discriminator: it fires only under the conjunctive reading of the Spacing
// exception, so pinning it rejects the asymmetric misreading, and the exact set rejects a disabled check.
const expectedTapTargetBadSelectors = ["#cramp-a", "#cramp-b", "#disc"];
const cleanCorpusFailures = [];

rmSync(outRoot, { recursive: true, force: true });

const server = createServer((request, response) => {
  const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const pathname = decodePathname(requestUrl.pathname, response);
  if (!pathname) {
    return;
  }
  const candidate = safeJoin(root, pathname === "/" ? "/index.html" : pathname);
  if (!candidate || !existsSync(candidate) || !statSync(candidate).isFile()) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  response.writeHead(200, { "content-type": mimeType(candidate) });
  createReadStream(candidate).pipe(response);
});

function decodePathname(pathname, response) {
  try {
    return decodeURIComponent(pathname);
  } catch {
    response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    response.end("Bad request");
    return null;
  }
}

await new Promise((resolveListen) => {
  server.listen(port, "127.0.0.1", resolveListen);
});

try {
  const cliPath = resolve("packages/cli/dist/index.js");
  const exitCode = await run(process.execPath, [
    cliPath,
    "audit",
    "--url",
    `http://127.0.0.1:${port}/merchant-dashboard/index.html`,
    "--out",
    noConfigOutDir
  ]);
  if (exitCode !== 0) {
    throw new Error(`No-config example CLI exited ${exitCode}`);
  }
  assertNoConfigArtifacts(noConfigOutDir);

  const lineLengthOutDir = join(outRoot, "line-length-tripwire");
  const lineLengthExit = await run(process.execPath, [
    cliPath,
    "audit",
    "--url",
    `http://127.0.0.1:${port}/ui-quality-fixtures/${lineLengthTripwireFixture}`,
    "--out",
    lineLengthOutDir
  ]);
  if (lineLengthExit !== 0) {
    throw new Error(`Line-length tripwire CLI exited ${lineLengthExit}`);
  }
  assertLineLengthTripwire(readAuditResult(lineLengthOutDir));

  const tapTargetGoodOut = join(outRoot, "tap-target-good");
  if (await run(process.execPath, [cliPath, "audit", "--url",
    `http://127.0.0.1:${port}/ui-quality-fixtures/tap-target-good.html`, "--out", tapTargetGoodOut]) !== 0) {
    throw new Error("tap-target-good CLI exited non-zero");
  }
  assertTapTargetGood(readAuditResult(tapTargetGoodOut));

  const tapTargetBadOut = join(outRoot, "tap-target-bad");
  if (await run(process.execPath, [cliPath, "audit", "--url",
    `http://127.0.0.1:${port}/ui-quality-fixtures/tap-target-bad.html`, "--out", tapTargetBadOut]) !== 0) {
    throw new Error("tap-target-bad CLI exited non-zero");
  }
  assertTapTargetBad(readAuditResult(tapTargetBadOut));

  const findingCoverageOut = join(outRoot, "finding-coverage-over-limit");
  const findingCoverageExit = await run(process.execPath, [
    cliPath,
    "audit",
    "--url",
    `http://127.0.0.1:${port}/ui-quality-fixtures/${findingCoverageFixture}`,
    "--out",
    findingCoverageOut
  ]);
  if (findingCoverageExit !== 0) {
    throw new Error(`Finding-coverage over-limit CLI exited ${findingCoverageExit}`);
  }
  assertFindingCoverageOverLimit(readAuditResult(findingCoverageOut));

  // Collect failures so later independent fixture gates still run; the suite always fails after aggregation.
  for (const pair of cleanCorpusPairs) {
    for (const [half, fixture, assertHalf] of [
      ["good", pair.good, assertCleanCorpusGood],
      ["defective", pair.defective, assertCleanCorpusDefective]
    ]) {
      const outDir = join(outRoot, `${pair.name}-${half}`);
      try {
        const exitCode = await run(process.execPath, [
          cliPath,
          "audit",
          "--url",
          `http://127.0.0.1:${port}/ui-quality-fixtures/${fixture}`,
          "--out",
          outDir
        ]);
        if (exitCode !== 0) {
          throw new Error(`${pair.name} (${half}) CLI exited ${exitCode}`);
        }
        assertHalf(readAuditResult(outDir), pair);
      } catch (error) {
        cleanCorpusFailures.push(error instanceof Error ? error.message : String(error));
        console.error(`CLEAN CORPUS FAIL: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  for (const scenario of contrastEffectFixtures) {
    const outDir = join(outRoot, scenario.name);
    const contrastEffectExit = await run(process.execPath, [
      cliPath,
      "audit",
      "--url",
      `http://127.0.0.1:${port}/ui-quality-fixtures/${scenario.fixture}`,
      "--out",
      outDir
    ]);
    if (contrastEffectExit !== 0) {
      throw new Error(`${scenario.name} CLI exited ${contrastEffectExit}`);
    }
    assertContrastEffectRun(readAuditResult(outDir), scenario);
  }

  await runFontFamilyFixture({
    cliPath,
    name: "font-family-good",
    fixture: "font-family-adherence-good.html",
    guide: validGuide,
    expectedExitCode: 0,
    assertResult: assertGoodFontFamilyRun
  });
  await runFontFamilyFixture({
    cliPath,
    name: "font-family-bad",
    fixture: "font-family-adherence-bad.html",
    guide: validGuide,
    expectedExitCode: 0,
    assertResult: assertBadFontFamilyRun
  });
  await runFontFamilyFixture({
    cliPath,
    name: "font-family-real-stack-good",
    fixture: "font-family-adherence-real-stack-good.html",
    guide: realStackGuide,
    expectedExitCode: 0,
    assertResult: assertRealStackGoodFontFamilyRun
  });
  await runFontFamilyFixture({
    cliPath,
    name: "font-family-real-stack-bad",
    fixture: "font-family-adherence-real-stack-bad.html",
    guide: realStackGuide,
    expectedExitCode: 0,
    assertResult: assertRealStackBadFontFamilyRun
  });
  await runFontFamilyFixture({
    cliPath,
    name: "font-family-ignored",
    fixture: "font-family-adherence-ignored.html",
    guide: validGuide,
    expectedExitCode: 0,
    assertResult: assertIgnoredFontFamilyRun
  });
  await runFontFamilyFixture({
    cliPath,
    name: "font-family-invalid-selector",
    fixture: "font-family-adherence-good.html",
    guide: invalidSelectorGuide,
    expectedExitCode: 2,
    assertResult: assertInvalidSelectorRun
  });
  for (const scenario of [
    { query: "candidate-limit", reasonCode: "candidate-limit" },
    { query: "computed-family-limit", reasonCode: "computed-family" },
    { query: "selector-evaluation", reasonCode: "selector-evaluation" }
  ]) {
    await runFontFamilyFixture({
      cliPath,
      name: `font-family-${scenario.query}`,
      fixture: `font-family-adherence-errors.html?scenario=${scenario.query}`,
      guide: validGuide,
      expectedExitCode: 2,
      assertResult: (auditResult) => assertScopedFontErrorRun(auditResult, scenario.reasonCode)
    });
  }
  if (cleanCorpusFailures.length > 0) {
    throw new Error(
      `Clean corpus gate failed ${cleanCorpusFailures.length} assertion(s); every other example-smoke `
      + `assertion above passed.\n  - ${cleanCorpusFailures.join("\n  - ")}`
    );
  }
  console.log("Example smoke passed: no-config regression, measurement tripwires, clean corpus, contrast paint-effect ancestry and priority, tap-target spacing, capped-finding coverage, plus live real-stack font-family success, exact companion mismatch, exception, and scoped-error audits.");
} finally {
  await new Promise((resolveClose) => server.close(resolveClose));
}

function assertNoConfigArtifacts(outDir) {
  const auditResult = readAuditResult(outDir);
  const metadata = JSON.parse(readFileSync(join(outDir, "metadata.json"), "utf8"));
  const copyCheckNames = new Set(parserFreeCopyCheckNames);
  const copyNoticeCodes = new Set([
    "copy-analysis-capability-unavailable",
    "copy-surface-unsupported-adapter",
    "copy-surface-invalid-query"
  ]);
  if (auditResult.findings.some((finding) => copyCheckNames.has(finding.checkName))) {
    throw new Error("No-copy example emitted parser-free copy findings");
  }
  if ((auditResult.notices ?? []).some((notice) => copyNoticeCodes.has(notice.code))) {
    throw new Error("No-copy example emitted copy-derived notices");
  }
  const textItems = auditResult.evidenceAssets
    .filter((asset) => asset.type === "text-inventory")
    .flatMap((asset) => Array.isArray(asset.data?.items) ? asset.data.items : []);
  if (textItems.some((item) => item.copySurface !== undefined)) {
    throw new Error("No-copy example materialized copy surfaces");
  }
  if (textItems.some((item) => item.fontFamily !== undefined)) {
    throw new Error("No-guide example materialized font-family evidence");
  }
  const measurements = auditResult.evidenceAssets.filter((asset) => asset.id.startsWith("measurement-"));
  if (measurements.some((asset) => asset.data?.fontFamilyAdherence !== undefined)) {
    throw new Error("No-guide example materialized font-family summaries");
  }
  if (auditResult.findings.some((finding) => finding.checkName === "unapproved-font-family")) {
    throw new Error("No-guide example emitted font-family findings");
  }
  if (auditResult.failedChecks.some((check) => check.endsWith(":unapproved-font-family"))) {
    throw new Error("No-guide example recorded a font-family failed check");
  }
  if (metadata.toolVersions?.["@design-harness/copy-audit"] !== undefined) {
    throw new Error("No-copy example recorded copy-audit metadata");
  }
  assertMeaningfulElementCountBaseline(auditResult);
  assertLayoutMetricsPresent(auditResult);
}

// A measurement-only block has no finding to protect it, so this smoke assertion is its only guard: a bug
// that silently stops populating it would otherwise pass every test. merchant-dashboard uses a bounded set
// of radii, which is exactly the consistency signal the block exists to record.
function assertLayoutMetricsPresent(auditResult) {
  const layoutMetrics = auditResult.layoutMetrics;
  if (!Array.isArray(layoutMetrics) || layoutMetrics.length !== auditResult.viewportPresets.length) {
    throw new Error(
      `merchant-dashboard layoutMetrics has ${layoutMetrics?.length ?? 0} viewport entries, `
      + `expected ${auditResult.viewportPresets.length}.`
    );
  }
  // Every group must be populated, not just one: a single-group regression (e.g. a mistyped source key on
  // letter-spacing) would otherwise pass while that group silently stops collecting. On merchant-dashboard
  // every element reports a value for all six groups (0px / normal by default), so each is non-empty.
  const expectedGroups = ["margin", "padding", "gap", "border-radius", "line-height", "letter-spacing"];
  const presetNames = new Set(auditResult.viewportPresets.map((preset) => preset.name));
  for (const entry of layoutMetrics) {
    if (!presetNames.has(entry.viewport)) {
      throw new Error(
        `merchant-dashboard layoutMetrics has an entry for viewport "${entry.viewport}", `
        + `which is not one of ${[...presetNames].join(", ")}.`
      );
    }
    for (const group of expectedGroups) {
      const distribution = entry.properties?.find((property) => property.property === group);
      if (!distribution || !(distribution.sampledElementCount > 0) || !(distribution.distinctValueCount > 0)) {
        throw new Error(
          `merchant-dashboard ${entry.viewport} layoutMetrics ${group} is empty; `
          + "the raw metric block stopped collecting for that property group."
        );
      }
    }
  }
}

function assertMeaningfulElementCountBaseline(auditResult) {
  for (const asset of auditResult.evidenceAssets) {
    if (asset.type !== "measurement") {
      continue;
    }
    const expected = meaningfulElementCountBaseline[asset.viewport];
    if (expected === undefined) {
      throw new Error(`No meaningfulElementCount baseline pinned for viewport ${asset.viewport}`);
    }
    if (asset.data?.meaningfulElementCount !== expected) {
      throw new Error(
        `merchant-dashboard ${asset.viewport} meaningfulElementCount is ${asset.data?.meaningfulElementCount}, `
        + `expected ${expected}. The shared textElements array changed; clippedText, contrastRisks, `
        + `excessiveLineLength, and blank-render all read from it.`
      );
    }
  }
}

function contrastFindings(auditResult, viewport) {
  return auditResult.findings.filter(
    (finding) => finding.checkName === "dom-contrast-risk" && finding.viewport === viewport
  );
}

function assertContrastEffectRun(auditResult, scenario) {
  if (auditResult.status !== "success") {
    throw new Error(`${scenario.name} status is ${auditResult.status}, expected success`);
  }
  if (auditResult.failedChecks.length !== 0) {
    throw new Error(`${scenario.name} recorded failed checks: ${auditResult.failedChecks.join(", ")}`);
  }

  const viewportNames = auditResult.viewportPresets.map((preset) => preset.name).sort();
  if (JSON.stringify(viewportNames) !== JSON.stringify(["desktop", "mobile"])) {
    throw new Error(`${scenario.name} audited [${viewportNames.join(", ")}], expected desktop and mobile`);
  }

  for (const viewport of viewportNames) {
    const matchingMeasurements = auditResult.evidenceAssets.filter(
      (asset) => asset.type === "measurement" && asset.viewport === viewport
    );
    if (matchingMeasurements.length !== 1) {
      throw new Error(`${scenario.name} produced ${matchingMeasurements.length} measurements for ${viewport}`);
    }
    const coverage = matchingMeasurements[0].data?.contrastCoverage;
    if (!coverage) {
      throw new Error(`${scenario.name} ${viewport} measurement carries no contrastCoverage block`);
    }
    if (
      coverage.evaluatedElementCount !== scenario.expectedEvaluated
      || coverage.skippedElementCount !== scenario.expectedSkipped
      || coverage.evaluatedElementCount + coverage.skippedElementCount
        !== scenario.expectedEvaluated + scenario.expectedSkipped
    ) {
      throw new Error(
        `${scenario.name} ${viewport} coverage was evaluated=${coverage.evaluatedElementCount}, `
        + `skipped=${coverage.skippedElementCount}; expected evaluated=${scenario.expectedEvaluated}, `
        + `skipped=${scenario.expectedSkipped}`
      );
    }
    assertExactReasonCounts(
      coverage.skippedByReason,
      scenario.expectedReasons,
      `${scenario.name} ${viewport} contrast coverage`
    );

    const selectors = contrastFindings(auditResult, viewport)
      .map((finding) => finding.selector)
      .sort();
    const expectedSelectors = [...scenario.expectedFindingSelectors].sort();
    if (
      selectors.length !== expectedSelectors.length
      || selectors.some((selector, index) => selector !== expectedSelectors[index])
    ) {
      throw new Error(
        `${scenario.name} ${viewport} contrast selectors were [${selectors.join(", ")}], `
        + `expected [${expectedSelectors.join(", ")}]`
      );
    }
  }

  const skipNotices = (auditResult.notices ?? []).filter(
    (notice) => notice.code === "contrast-elements-skipped"
  );
  if (skipNotices.length !== 1) {
    throw new Error(`${scenario.name} emitted ${skipNotices.length} contrast skip notices, expected 1`);
  }
  const [notice] = skipNotices;
  if (notice.viewport !== undefined) {
    throw new Error(`${scenario.name} contrast skip notice retained a top-level viewport after deduplication`);
  }
  if (!/painted/i.test(notice.message) || !/contrast/i.test(notice.message)) {
    throw new Error(`${scenario.name} contrast skip notice does not describe painted contrast uncertainty`);
  }
  const noticeViewports = notice.details?.viewports;
  if (!Array.isArray(noticeViewports) || noticeViewports.length !== viewportNames.length) {
    throw new Error(
      `${scenario.name} contrast skip notice summarized ${noticeViewports?.length ?? 0} viewport(s), `
      + `expected ${viewportNames.length}`
    );
  }
  for (const [index, viewport] of viewportNames.entries()) {
    const summary = noticeViewports[index];
    if (summary?.viewport !== viewport || summary.skippedElementCount !== scenario.expectedSkipped) {
      throw new Error(
        `${scenario.name} contrast skip notice summary ${index} was `
        + `${summary?.viewport}:${summary?.skippedElementCount}, expected ${viewport}:${scenario.expectedSkipped}`
      );
    }
    assertExactReasonCounts(
      summary.skippedByReason,
      scenario.expectedReasons,
      `${scenario.name} ${viewport} contrast skip notice`
    );
  }
}

function assertExactReasonCounts(actual, expected, label) {
  const actualEntries = Object.entries(actual ?? {}).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  const expectedEntries = Object.entries(expected).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  if (JSON.stringify(actualEntries) !== JSON.stringify(expectedEntries)) {
    throw new Error(
      `${label} reasons were ${JSON.stringify(Object.fromEntries(actualEntries))}, `
      + `expected ${JSON.stringify(Object.fromEntries(expectedEntries))}`
    );
  }
}

// A zero-findings assertion alone is satisfied by a dead measurement closure, which produces zero findings
// for every check. These integrity clauses are what separate "the page is correct" from "the harness
// stopped measuring".
function assertCleanCorpusIntegrity(auditResult, label, expectedEvaluated) {
  if (auditResult.status !== "success") {
    throw new Error(`${label} status is ${auditResult.status}, expected success`);
  }
  if (auditResult.failedChecks.length !== 0) {
    throw new Error(`${label} recorded failed checks: ${auditResult.failedChecks.join(", ")}`);
  }
  for (const preset of auditResult.viewportPresets) {
    const measurement = auditResult.evidenceAssets.find(
      (asset) => asset.type === "measurement" && asset.viewport === preset.name
    );
    if (!measurement) {
      throw new Error(`${label} produced no measurement evidence for ${preset.name}`);
    }
    if (!Array.isArray(measurement.data?.contrastRisks)) {
      throw new Error(`${label} ${preset.name} measurement carries no contrastRisks array`);
    }
    if (!(measurement.data?.meaningfulElementCount > 0)) {
      throw new Error(
        `${label} ${preset.name} measured ${measurement.data?.meaningfulElementCount} elements; `
        + "the page has text, so the measurement closure did not run"
      );
    }
    // Silence is only meaningful alongside coverage: a bail-out that skips every element emits zero
    // findings too. This is what separates "the detector looked and found nothing" from "it never looked".
    const coverage = measurement.data?.contrastCoverage;
    if (!coverage) {
      throw new Error(`${label} ${preset.name} measurement carries no contrastCoverage block`);
    }
    if (coverage.evaluatedElementCount !== expectedEvaluated) {
      throw new Error(
        `${label} ${preset.name} scored ${coverage.evaluatedElementCount} elements, expected ${expectedEvaluated}. `
        + `Skipped ${coverage.skippedElementCount}: ${JSON.stringify(coverage.skippedByReason)}.`
      );
    }
  }
}

function assertCleanCorpusGood(auditResult, pair) {
  const name = pair.name;
  assertCleanCorpusIntegrity(auditResult, `${name} (good)`, pair.goodEvaluated);
  for (const preset of auditResult.viewportPresets) {
    const findings = contrastFindings(auditResult, preset.name);
    if (findings.length !== 0) {
      const detail = findings
        .map((finding) => `${finding.selector} (${finding.observed?.ratio}:1)`)
        .join(", ");
      throw new Error(
        `${name} (good) emitted ${findings.length} dom-contrast-risk findings on ${preset.name}: ${detail}. `
        + "Every element on this page clears its required ratio; "
        + "see examples/ui-quality-fixtures/clean-corpus-expected.md."
      );
    }
  }
}

function assertCleanCorpusDefective(auditResult, pair) {
  const name = pair.name;
  assertCleanCorpusIntegrity(auditResult, `${name} (defective)`, pair.defectiveEvaluated);
  for (const preset of auditResult.viewportPresets) {
    const findings = contrastFindings(auditResult, preset.name);
    if (findings.length !== 1) {
      throw new Error(
        `${name} (defective) emitted ${findings.length} dom-contrast-risk findings on ${preset.name}, expected 1. `
        + "Exactly one label on this page is genuinely below 4.5:1; more means false positives, "
        + "fewer means the detector was disabled."
      );
    }
    const [finding] = findings;
    if (finding.selector !== pair.selector) {
      throw new Error(
        `${name} (defective) flagged ${finding.selector} on ${preset.name}, expected ${pair.selector}. `
        + "The right count on the wrong element is not the right answer."
      );
    }
    const observed = finding.observed?.ratio;
    if (Math.abs(observed - pair.ratio) > cleanCorpusRatioTolerance) {
      throw new Error(
        `${name} (defective) computed ${observed}:1 for ${pair.selector} on ${preset.name}, expected `
        + `${pair.ratio}:1 +/- ${cleanCorpusRatioTolerance}. See examples/ui-quality-fixtures/`
        + "clean-corpus-expected.md — a right/wrong verdict from wrong arithmetic still fails."
      );
    }
  }
}

function tapTargetSelectors(auditResult, viewport) {
  return auditResult.findings
    .filter((finding) => finding.checkName === "tap-target-risk" && finding.viewport === viewport)
    .map((finding) => finding.selector)
    .sort();
}

function assertTapTargetGood(auditResult) {
  if (auditResult.status !== "success") {
    throw new Error(`tap-target-good status is ${auditResult.status}, expected success`);
  }
  for (const preset of auditResult.viewportPresets) {
    const selectors = tapTargetSelectors(auditResult, preset.name);
    if (selectors.length !== 0) {
      throw new Error(
        `tap-target-good emitted ${selectors.length} tap-target-risk findings on ${preset.name}: `
        + `${selectors.join(", ")}. Every target clears 24px spacing; see `
        + "examples/ui-quality-fixtures/tap-target-expected.md."
      );
    }
  }
}

// Pinning the exact selector set means a disabled check (0 findings) fails via the count, and the
// asymmetric misreading (which would drop #disc) fails here.
function assertTapTargetBad(auditResult) {
  if (auditResult.status !== "success") {
    throw new Error(`tap-target-bad status is ${auditResult.status}, expected success`);
  }
  for (const preset of auditResult.viewportPresets) {
    const selectors = tapTargetSelectors(auditResult, preset.name);
    const expected = [...expectedTapTargetBadSelectors].sort();
    if (selectors.length !== expected.length || selectors.some((selector, index) => selector !== expected[index])) {
      throw new Error(
        `tap-target-bad flagged [${selectors.join(", ")}] on ${preset.name}, expected [${expected.join(", ")}]. `
        + "#disc fires only under the conjunctive Spacing predicate; its absence means the wrong reading, "
        + "and a different count means over- or under-exemption. See tap-target-expected.md."
      );
    }
  }
}

function assertFindingCoverageOverLimit(auditResult) {
  const label = "finding-coverage-over-limit";
  if (auditResult.status !== "success") {
    throw new Error(`${label} status is ${auditResult.status}, expected success`);
  }
  if (auditResult.failedChecks.length !== 0) {
    throw new Error(`${label} recorded failed checks: ${auditResult.failedChecks.join(", ")}`);
  }

  const viewportNames = auditResult.viewportPresets.map((preset) => preset.name).sort();
  if (JSON.stringify(viewportNames) !== JSON.stringify(["desktop", "mobile"])) {
    throw new Error(`${label} audited [${viewportNames.join(", ")}], expected desktop and mobile`);
  }

  const expectedCheckNames = [...overLimitCheckNames];
  const expectedCheckSet = new Set(expectedCheckNames);
  const unrelatedFindings = auditResult.findings.filter((finding) => !expectedCheckSet.has(finding.checkName));
  if (unrelatedFindings.length !== 0) {
    throw new Error(
      `${label} emitted unrelated finding families: `
      + unrelatedFindings.map((finding) => `${finding.viewport}:${finding.checkName}`).join(", ")
    );
  }

  for (const viewport of viewportNames) {
    for (const checkName of expectedCheckNames) {
      const findingCount = auditResult.findings.filter(
        (finding) => finding.viewport === viewport && finding.checkName === checkName
      ).length;
      if (findingCount !== 5) {
        throw new Error(`${label} ${viewport} emitted ${findingCount} ${checkName} findings, expected 5`);
      }
    }

    const measurements = auditResult.evidenceAssets.filter(
      (asset) => asset.type === "measurement" && asset.viewport === viewport
    );
    if (measurements.length !== 1) {
      throw new Error(`${label} produced ${measurements.length} measurements for ${viewport}, expected 1`);
    }
    const coverage = measurements[0].data?.findingCoverage;
    if (coverage?.viewport !== viewport || !Array.isArray(coverage.entries)) {
      throw new Error(`${label} ${viewport} has no matching findingCoverage { viewport, entries } block`);
    }
    if (coverage.entries.length !== 20) {
      throw new Error(`${label} ${viewport} findingCoverage has ${coverage.entries.length} entries, expected 20`);
    }
    const distinctCheckNames = new Set(coverage.entries.map((entry) => entry.checkName));
    if (distinctCheckNames.size !== coverage.entries.length) {
      throw new Error(`${label} ${viewport} findingCoverage contains duplicate check names`);
    }

    const omittedEntries = coverage.entries.filter((entry) => entry.omittedCount !== 0);
    const omittedCheckNames = omittedEntries.map((entry) => entry.checkName).sort();
    if (JSON.stringify(omittedCheckNames) !== JSON.stringify(expectedCheckNames)) {
      throw new Error(
        `${label} ${viewport} omitted checks were [${omittedCheckNames.join(", ")}], `
        + `expected exactly [${expectedCheckNames.join(", ")}]`
      );
    }
    for (const checkName of expectedCheckNames) {
      const entry = coverage.entries.find((candidate) => candidate.checkName === checkName);
      assertOverLimitCoverageEntry(entry, `${label} ${viewport} measurement ${checkName}`);
    }
  }

  const notices = auditResult.notices ?? [];
  const truncationNotices = notices.filter((notice) => notice.code === "finding-samples-truncated");
  if (truncationNotices.length !== 1) {
    throw new Error(`${label} emitted ${truncationNotices.length} finding-samples-truncated notices, expected 1`);
  }
  if (notices.length !== 1) {
    throw new Error(`${label} emitted unrelated notices: ${notices.map((notice) => notice.code).join(", ")}`);
  }
  const [notice] = truncationNotices;
  if (Object.hasOwn(notice, "viewport")) {
    throw new Error(`${label} truncation notice retained a top-level viewport`);
  }
  const noticeViewports = notice.details?.viewports;
  if (!Array.isArray(noticeViewports) || noticeViewports.length !== 2) {
    throw new Error(`${label} truncation notice must carry exactly two viewport detail entries`);
  }
  if (JSON.stringify(noticeViewports.map((entry) => entry.viewport)) !== JSON.stringify(["desktop", "mobile"])) {
    throw new Error(`${label} truncation notice viewport details are not in canonical desktop/mobile order`);
  }
  for (const viewportEntry of noticeViewports) {
    if (!Array.isArray(viewportEntry.checks)) {
      throw new Error(`${label} notice ${viewportEntry.viewport} detail has no checks array`);
    }
    const checkNames = viewportEntry.checks.map((entry) => entry.checkName);
    if (JSON.stringify(checkNames) !== JSON.stringify(expectedCheckNames)) {
      throw new Error(
        `${label} notice ${viewportEntry.viewport} checks were [${checkNames.join(", ")}], `
        + `expected canonical [${expectedCheckNames.join(", ")}]`
      );
    }
    for (const entry of viewportEntry.checks) {
      assertOverLimitCoverageEntry(entry, `${label} notice ${viewportEntry.viewport} ${entry.checkName}`);
    }
  }

  const score = auditResult.advisoryScore;
  if (score.formulaVersion !== "epistemic-criterion-max-v2") {
    throw new Error(`${label} score formula is ${score.formulaVersion}, expected epistemic-criterion-max-v2`);
  }
  if (score.deductions.length !== 3 || score.totalDeduction !== 13.5 || score.value !== 86.5 || score.saturated) {
    throw new Error(
      `${label} score was groups=${score.deductions.length}, total=${score.totalDeduction}, `
      + `value=${score.value}, saturated=${score.saturated}; expected 3/13.5/86.5/false`
    );
  }
  const findingsById = new Map(auditResult.findings.map((finding) => [finding.id, finding]));
  const scoredCheckNames = score.deductions.map((deduction) => findingsById.get(deduction.findingId)?.checkName).sort();
  if (JSON.stringify(scoredCheckNames) !== JSON.stringify(expectedCheckNames)) {
    throw new Error(`${label} score groups were [${scoredCheckNames.join(", ")}], expected one per capped check`);
  }
  for (const deduction of score.deductions) {
    if (
      deduction.findingIds.length !== 10
      || JSON.stringify(deduction.viewports) !== JSON.stringify(["desktop", "mobile"])
    ) {
      throw new Error(
        `${label} score group ${deduction.findingId} has ${deduction.findingIds.length} occurrences `
        + `across [${deduction.viewports.join(", ")}], expected 10 across desktop/mobile`
      );
    }
  }
}

function assertOverLimitCoverageEntry(entry, label) {
  if (
    !entry
    || entry.detectedCount !== 25
    || entry.emittedCount !== 5
    || entry.omittedCount !== 20
    || entry.limit !== 5
    || entry.capGroup !== undefined
  ) {
    throw new Error(
      `${label} was ${JSON.stringify(entry)}, expected detected=25, emitted=5, omitted=20, limit=5, no capGroup`
    );
  }
}

function assertLineLengthTripwire(auditResult) {
  if (auditResult.status !== "success") {
    throw new Error(`Line-length tripwire run status is ${auditResult.status}, expected success`);
  }
  if (auditResult.failedChecks.length !== 0) {
    throw new Error(`Line-length tripwire run recorded failed checks: ${auditResult.failedChecks.join(", ")}`);
  }
  const perViewport = new Map();
  for (const finding of auditResult.findings) {
    if (finding.checkName === "excessive-line-length") {
      perViewport.set(finding.viewport, (perViewport.get(finding.viewport) ?? 0) + 1);
    }
  }
  // Exactly one per viewport, not "at least one": the lower bound alone would let a detector that flags
  // every P/LI/TD/TH pass while flooding, and no other gate catches excessive-line-length (it is a risk,
  // not a failedCheck). Pinning the count makes this two-sided — a shrink drops it to 0, an over-fire
  // raises it above 1, and both fail.
  for (const preset of auditResult.viewportPresets) {
    const count = perViewport.get(preset.name) ?? 0;
    if (count !== 1) {
      throw new Error(
        `${lineLengthTripwireFixture} emitted ${count} excessive-line-length findings on ${preset.name}, `
        + "expected exactly 1. A shrink of the shared textElements array drops it to 0; an over-firing "
        + "line-length detector raises it above 1."
      );
    }
  }
}

async function runFontFamilyFixture({
  cliPath,
  name,
  fixture,
  guide,
  expectedExitCode,
  assertResult
}) {
  const outDir = join(outRoot, name);
  const exitCode = await run(process.execPath, [
    cliPath,
    "audit",
    "--url",
    `http://127.0.0.1:${port}/ui-quality-fixtures/${fixture}`,
    "--out",
    outDir,
    "--guide",
    guide
  ]);
  if (exitCode !== expectedExitCode) {
    throw new Error(`${name} CLI exited ${exitCode}, expected ${expectedExitCode}`);
  }
  assertResult(readAuditResult(outDir));
}

function assertGoodFontFamilyRun(auditResult) {
  assertFontRunIntegrity(auditResult, "success");
  if (fontFindings(auditResult).length !== 0) {
    throw new Error("Good font-family fixture emitted an adherence finding");
  }
  for (const summary of fontSummaries(auditResult)) {
    if (
      summary.evaluatedElementCount < 1
      || summary.ignoredElementCount !== 0
      || summary.violatingElementCount !== 0
      || summary.distinctViolationStackCount !== 0
      || summary.emittedStackCount !== 0
      || summary.truncated
      || summary.stacks.length !== 0
    ) {
      throw new Error("Good font-family fixture did not record a clean evaluated summary");
    }
  }
}

function assertBadFontFamilyRun(auditResult) {
  assertFontRunIntegrity(auditResult, "success");
  const findings = fontFindings(auditResult);
  if (findings.length !== auditResult.viewportPresets.length) {
    throw new Error(`Bad font-family fixture emitted ${findings.length} findings for ${auditResult.viewportPresets.length} viewports`);
  }
  if (findings.some((finding) => (
    finding.determinism !== "deterministic"
    || finding.resultKind !== "risk"
    || finding.severity !== "low"
    || finding.confidence !== "high"
    || !finding.evidenceRefs.some((reference) => reference.startsWith("measurement-"))
  ))) {
    throw new Error("Bad font-family fixture emitted incorrect finding metadata or evidence refs");
  }
}

function assertRealStackGoodFontFamilyRun(auditResult) {
  assertFontRunIntegrity(auditResult, "success");
  assertRealStackProjectedAllowedFamilies(auditResult);
  if (auditResult.findings.length !== 0) {
    throw new Error("Good real-stack font-family fixture emitted a finding");
  }
  for (const summary of fontSummaries(auditResult)) {
    if (
      summary.evaluatedElementCount < 1
      || summary.ignoredElementCount !== 0
      || summary.violatingElementCount !== 0
      || summary.distinctViolationStackCount !== 0
      || summary.emittedStackCount !== 0
      || summary.truncated
      || summary.stacks.length !== 0
    ) {
      throw new Error("Good real-stack font-family fixture did not record a clean evaluated summary");
    }
  }
}

function assertRealStackBadFontFamilyRun(auditResult) {
  assertFontRunIntegrity(auditResult, "success");
  assertRealStackProjectedAllowedFamilies(auditResult);
  const findings = fontFindings(auditResult);
  if (findings.length !== auditResult.viewportPresets.length) {
    throw new Error(`Bad real-stack font-family fixture emitted ${findings.length} findings for ${auditResult.viewportPresets.length} viewports`);
  }
  if (auditResult.findings.length !== findings.length) {
    throw new Error("Bad real-stack font-family fixture emitted an unrelated finding");
  }
  if (findings.some((finding) => (
    finding.determinism !== "deterministic"
    || finding.resultKind !== "risk"
    || finding.severity !== "low"
    || finding.confidence !== "high"
    || !finding.evidenceRefs.some((reference) => reference.startsWith("measurement-"))
  ))) {
    throw new Error("Bad real-stack font-family fixture emitted incorrect finding metadata or evidence refs");
  }
  for (const finding of findings) {
    if (
      finding.observed?.rawComputedStack !== 'Rogue, "Rogue Fallback", sans-serif'
      || JSON.stringify(finding.observed?.unexpectedFamilies) !== JSON.stringify([
        { value: "Rogue Fallback", kind: "named" }
      ])
      || finding.observed?.affectedElementCount !== 1
      || finding.selector !== "main > p"
      || !Array.isArray(finding.observed?.selectors)
      || finding.observed.selectors.length !== 1
      || finding.observed.selectors[0] !== "main > p"
      || !Array.isArray(finding.observed?.regions)
      || finding.observed.regions.length !== 1
      || finding.observed.regions[0]?.width <= 0
      || finding.observed.regions[0]?.height <= 0
      || JSON.stringify(finding.expected?.allowedFamilies) !== JSON.stringify(expectedRealStackAllowedFamilies)
    ) {
      throw new Error("Bad font-family fixture did not isolate the undeclared Rogue Fallback companion");
    }
  }
  for (const summary of fontSummaries(auditResult)) {
    if (
      summary.ignoredElementCount !== 0
      || summary.violatingElementCount !== 1
      || summary.distinctViolationStackCount !== 1
      || summary.emittedStackCount !== 1
      || summary.truncated
      || summary.stacks.length !== 1
      || JSON.stringify(summary.stacks[0]?.unexpectedFamilies) !== JSON.stringify([
        { value: "Rogue Fallback", kind: "named" }
      ])
    ) {
      throw new Error("Bad font-family fixture summary did not preserve the exact companion mismatch");
    }
  }
}

function assertIgnoredFontFamilyRun(auditResult) {
  assertFontRunIntegrity(auditResult, "success");
  if (fontFindings(auditResult).length !== 0) {
    throw new Error("Ignored font-family fixture emitted an adherence finding");
  }
  for (const summary of fontSummaries(auditResult)) {
    if (summary.evaluatedElementCount < 1 || summary.ignoredElementCount < 1 || summary.violatingElementCount !== 0) {
      throw new Error("Ignored font-family fixture did not prove both evaluation and subtree exclusion");
    }
  }
}

function assertInvalidSelectorRun(auditResult) {
  assertScopedFontErrorRun(auditResult, "invalid-selector");
}

function assertScopedFontErrorRun(auditResult, reasonCode) {
  assertFontRunIntegrity(auditResult, "partial", { expectSummaries: false });
  const expectedFailures = auditResult.viewportPresets.map((viewport) => `${viewport.name}:unapproved-font-family`);
  if (JSON.stringify(auditResult.failedChecks) !== JSON.stringify(expectedFailures)) {
    throw new Error(`${reasonCode} failedChecks mismatch: ${auditResult.failedChecks.join(", ")}`);
  }
  if (fontFindings(auditResult).length !== 0) {
    throw new Error(`${reasonCode} run emitted a font finding from failed evidence`);
  }
  const textItems = auditResult.evidenceAssets
    .filter((asset) => asset.type === "text-inventory")
    .flatMap((asset) => Array.isArray(asset.data?.items) ? asset.data.items : []);
  if (textItems.some((item) => item.fontFamily !== undefined)) {
    throw new Error(`${reasonCode} run retained partial font-family item evidence`);
  }
  const failures = (auditResult.notices ?? []).filter((notice) => (
    notice.code === "font-family-adherence-measurement-failed"
    && notice.details?.reasonCode === reasonCode
  ));
  if (failures.length !== auditResult.viewportPresets.length) {
    throw new Error(`${reasonCode} run omitted bounded per-viewport failure notices`);
  }
}

function assertFontRunIntegrity(auditResult, expectedStatus, { expectSummaries = true } = {}) {
  if (auditResult.status !== expectedStatus) {
    throw new Error(`Font-family audit status was ${auditResult.status}, expected ${expectedStatus}`);
  }
  const summaries = fontSummaries(auditResult);
  const expectedCount = expectSummaries ? auditResult.viewportPresets.length : 0;
  if (summaries.length !== expectedCount) {
    throw new Error(`Font-family audit recorded ${summaries.length} summaries, expected ${expectedCount}`);
  }
  if (
    expectedStatus === "success"
    && auditResult.failedChecks.some((check) => check.endsWith(":unapproved-font-family"))
  ) {
    throw new Error("Successful font-family audit retained a failed adherence check");
  }
  const measurementCount = auditResult.evidenceAssets.filter((asset) => asset.id.startsWith("measurement-")).length;
  if (measurementCount < auditResult.viewportPresets.length) {
    throw new Error("Font-family audit lost base measurement assets");
  }
}

function assertRealStackProjectedAllowedFamilies(auditResult) {
  for (const summary of fontSummaries(auditResult)) {
    if (JSON.stringify(summary.allowedFamilies) !== JSON.stringify(expectedRealStackAllowedFamilies)) {
      throw new Error("Font-family audit did not preserve the guide-projected family order and kinds");
    }
  }
}

function fontFindings(auditResult) {
  return auditResult.findings.filter((finding) => finding.checkName === "unapproved-font-family");
}

function fontSummaries(auditResult) {
  return auditResult.evidenceAssets
    .filter((asset) => asset.id.startsWith("measurement-"))
    .flatMap((asset) => asset.data?.fontFamilyAdherence ? [asset.data.fontFamilyAdherence] : []);
}

function readAuditResult(outDir) {
  return JSON.parse(readFileSync(join(outDir, "audit.json"), "utf8"));
}

function run(command, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => resolveRun(code ?? 1));
  });
}

function safeJoin(rootDir, pathname) {
  const fullPath = normalize(join(rootDir, pathname));
  return fullPath === rootDir || fullPath.startsWith(`${rootDir}${sep}`) ? fullPath : null;
}

function mimeType(filePath) {
  switch (extname(filePath)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    default:
      return "application/octet-stream";
  }
}

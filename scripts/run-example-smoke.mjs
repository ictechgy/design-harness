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

// v0.5c step 2 — clean-corpus false-positive gate for dom-contrast-risk.
//
// Each pair is one correct page plus the same page with one genuinely sub-4.5:1 label. The good half
// proves the detector stays silent on correct modern styling; the defective half proves it has not been
// disabled to achieve that silence. Hand-computed reference values, written before the detector was ever
// run against these pages, live in examples/ui-quality-fixtures/clean-corpus-expected.md.
//
// This gate is RED on the current build and is meant to be: it is the definition of done for the contrast
// repair. Set DESIGN_HARNESS_CLEAN_CORPUS=off only to unblock unrelated work on a shared branch.
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
// #disc is the CONJ-vs-ASYM discriminator: it fires only under the conjunctive reading of the Spacing
// exception, so pinning it rejects the asymmetric misreading, and the exact set rejects a disabled check.
const expectedTapTargetBadSelectors = ["#cramp-a", "#cramp-b", "#disc"];
const cleanCorpusEnabled = process.env.DESIGN_HARNESS_CLEAN_CORPUS !== "off";
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

  // Collected rather than thrown: this gate is red until the contrast repair lands, and a throw here
  // would skip every font-family assertion below it, masking an unrelated regression for the duration of
  // the milestone. Failures are reported immediately and rethrown after the rest of the suite has run.
  if (cleanCorpusEnabled) {
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
  } else {
    console.warn("Clean corpus gate SKIPPED via DESIGN_HARNESS_CLEAN_CORPUS=off.");
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
  console.log("Example smoke passed: no-config regression, measurement tripwires, clean corpus, tap-target spacing, plus live real-stack font-family success, exact companion mismatch, exception, and scoped-error audits.");
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
  for (const entry of layoutMetrics) {
    const radius = entry.properties?.find((property) => property.property === "border-radius");
    if (!radius || !(radius.sampledElementCount > 0) || !(radius.distinctValueCount > 0)) {
      throw new Error(
        `merchant-dashboard ${entry.viewport} layoutMetrics border-radius is empty; `
        + "the raw metric block stopped collecting."
      );
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
  for (const preset of auditResult.viewportPresets) {
    if ((perViewport.get(preset.name) ?? 0) < 1) {
      throw new Error(
        `${lineLengthTripwireFixture} stopped emitting excessive-line-length on ${preset.name}. `
        + "A change to the shared textElements array most likely removed its candidates."
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

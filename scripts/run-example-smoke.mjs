import { spawn } from "node:child_process";
import { createReadStream, existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { parserFreeCopyCheckNames } from "./copy-calibration-config.mjs";

const root = resolve("examples");
const outRoot = resolve("runs/example-smoke");
const noConfigOutDir = join(outRoot, "no-config");
const validGuide = resolve("examples/configs/design-guide.example.yaml");
const invalidSelectorGuide = resolve("examples/configs/design-guide.invalid-font-selector.yaml");
const port = 4174;

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
  console.log("Example smoke passed: no-config regression plus live font-family success, mismatch, exception, and scoped-error audits.");
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
    if (summary.evaluatedElementCount < 1 || summary.violatingElementCount !== 0 || summary.stacks.length !== 0) {
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
  const measurementCount = auditResult.evidenceAssets.filter((asset) => asset.id.startsWith("measurement-")).length;
  if (measurementCount < auditResult.viewportPresets.length) {
    throw new Error("Font-family audit lost base measurement assets");
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

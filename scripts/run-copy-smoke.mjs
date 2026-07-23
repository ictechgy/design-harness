import { spawn } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DEFAULT_VIEWPORT_PRESETS, HARNESS_VERSION, renderMarkdownReport } from "../packages/core/dist/index.js";
import { auditUrl } from "../packages/visual-audit/dist/index.js";
import {
  copyStyleForSmoke,
  desktopViewport,
  directNodeSelector,
  explicitRoleEvidence,
  nearestAncestorSelector,
  nonMatchingWebDomSelector,
  parserFreeCopyCheckNames
} from "./copy-calibration-config.mjs";
import { startLocalFixtureServer } from "./local-fixture-server.mjs";

const fixtureRoot = resolve("examples/ui-quality-fixtures/korean");
const outRoot = resolve("runs/copy-smoke");

rmSync(outRoot, { recursive: true, force: true });

const fixtureServer = await startLocalFixtureServer(fixtureRoot);

try {
  const { baseUrl } = fixtureServer;
  const bad = await auditFixture("bad", `${baseUrl}/copy-bad.html`, copyStyleForSmoke("flag"));
  const good = await auditFixture("good", `${baseUrl}/copy-good.html`, copyStyleForSmoke("allow"));
  const noCopy = await auditFixture("no-copy", `${baseUrl}/copy-good.html`);
  const cli = await auditCliFixture(`${baseUrl}/copy-bad.html`);

  assertBadResult(bad.auditResult);
  assertGoodResult(good.auditResult);
  assertNoCopyResult(noCopy.auditResult);
  assertCliResult(cli.auditResult, cli.metadata);
  console.log("Copy smoke passed: criterion-bounded programmatic and CLI scoring, parser-free findings, no-copy behavior, surfaces, evidence, and provenance verified.");
} finally {
  await fixtureServer.close();
}

async function auditCliFixture(url) {
  const outDir = join(outRoot, "cli-bad");
  const exitCode = await run(process.execPath, [
    resolve("packages/cli/dist/index.js"),
    "audit",
    "--url",
    url,
    "--out",
    outDir,
    "--copy",
    resolve("examples/configs/copy-style.ko-example.yaml")
  ]);
  assert(exitCode === 0, `built CLI copy audit exited ${exitCode}`);
  return {
    auditResult: JSON.parse(readFileSync(join(outDir, "audit.json"), "utf8")),
    metadata: JSON.parse(readFileSync(join(outDir, "metadata.json"), "utf8"))
  };
}

function assertCliResult(auditResult, metadata) {
  assert(auditResult.status === "success", `CLI fixture status was ${auditResult.status}`);
  assert(auditResult.failedChecks.length === 0, "CLI fixture recorded failed checks");
  for (const viewport of DEFAULT_VIEWPORT_PRESETS) {
    const findings = auditResult.findings.filter((finding) => finding.viewport === viewport.name);
    assert(
      JSON.stringify(findings.map((finding) => finding.checkName)) === JSON.stringify(parserFreeCopyCheckNames),
      `CLI ${viewport.name} checks were ${findings.map((finding) => finding.checkName).join(", ")}`
    );
    assert(
      findings.every((finding) => (
        finding.evidenceRefs.length === 1 &&
        finding.evidenceRefs[0] === `text-inventory-${viewport.name}`
      )),
      `CLI ${viewport.name} findings did not use exact text-inventory evidence`
    );
  }
  assert(
    auditResult.findings.length === parserFreeCopyCheckNames.length * DEFAULT_VIEWPORT_PRESETS.length,
    `CLI fixture emitted ${auditResult.findings.length} findings`
  );
  assertCriterionMaxScore(auditResult, DEFAULT_VIEWPORT_PRESETS.map((viewport) => viewport.name));
  assert(
    metadata.toolVersions?.["@design-harness/copy-audit"] === HARNESS_VERSION,
    "CLI metadata omitted or changed the copy-audit tool version"
  );
}

async function auditFixture(name, url, style) {
  const outDir = join(outRoot, name);
  const result = await auditUrl({
    url,
    outDir,
    viewportPresets: [desktopViewport],
    copyStyle: style
  });
  writeFileSync(join(outDir, "audit.json"), `${JSON.stringify(result.auditResult, null, 2)}\n`);
  writeFileSync(join(outDir, "metadata.json"), `${JSON.stringify(result.metadata, null, 2)}\n`);
  writeFileSync(join(outDir, "report.md"), renderMarkdownReport({ auditResult: result.auditResult }));
  return result;
}

function assertBadResult(auditResult) {
  assert(auditResult.status === "success", `bad fixture status was ${auditResult.status}`);
  assert(auditResult.failedChecks.length === 0, "bad fixture recorded failed checks");
  assert(auditResult.findings.length === 5, `bad fixture emitted ${auditResult.findings.length} findings`);
  assert(
    JSON.stringify(auditResult.findings.map((finding) => finding.checkName)) === JSON.stringify(parserFreeCopyCheckNames),
    `bad fixture check order was ${auditResult.findings.map((finding) => finding.checkName).join(", ")}`
  );
  assertCriterionMaxScore(auditResult, ["desktop"]);
  assert(
    auditResult.findings.every((finding) => (
      finding.viewport === "desktop" &&
      finding.evidenceRefs.length === 1 &&
      finding.evidenceRefs[0] === "text-inventory-desktop"
    )),
    "bad fixture findings did not use the exact desktop text-inventory evidence"
  );
  assertNoticeAndSurfaceContract(auditResult);
}

function assertGoodResult(auditResult) {
  assert(auditResult.status === "success", `good fixture status was ${auditResult.status}`);
  assert(auditResult.failedChecks.length === 0, "good fixture recorded failed checks");
  assert(auditResult.findings.length === 0, `good fixture emitted ${auditResult.findings.length} findings`);
  assertEmptyCriterionMaxScore(auditResult, "good fixture");
  assertNoticeAndSurfaceContract(auditResult);
  assertNestedSurfaceInheritance(auditResult);
  assertSurfacePrecedence(auditResult);
}

function assertNoCopyResult(auditResult) {
  assert(auditResult.status === "success", `no-copy fixture status was ${auditResult.status}`);
  assert((auditResult.notices?.length ?? 0) === 0, "no-copy audit emitted notices");
  assertEmptyCriterionMaxScore(auditResult, "no-copy fixture");
  const items = textInventoryItems(auditResult);
  const multiRoleItem = items.find((item) => item.selector === "#multi-role-copy");
  assert(multiRoleItem?.role === explicitRoleEvidence, `no-copy evidence role was ${multiRoleItem?.role}`);
  assert(items.every((item) => item.copySurface === undefined), "no-copy audit materialized a copy surface");
}

function assertNoticeAndSurfaceContract(auditResult) {
  const noticeCodes = auditResult.notices?.map((notice) => notice.code).sort() ?? [];
  assert(
    JSON.stringify(noticeCodes) === JSON.stringify([
      "copy-surface-invalid-query",
      "copy-surface-unsupported-adapter"
    ]),
    `notice codes were ${noticeCodes.join(", ")}`
  );
  assert(auditResult.notices?.every((notice) => notice.viewport === undefined), "configuration notices retained viewport");

  const items = textInventoryItems(auditResult);
  const bodyItem = items.find((item) => item.copySurface?.surface === "body");
  assert(bodyItem?.copySurface?.surface === "body", "body copy surface was not materialized");
  assert(bodyItem.copySurface.ruleIndex === 3, `body copy surface rule index was ${bodyItem.copySurface.ruleIndex}`);
  assert(bodyItem.copySurface.matcher?.value === "main p", "first matching web-dom matcher provenance was not retained");

  const buttonItem = items.find((item) => item.tag === "button" && item.role === "button");
  assert(buttonItem?.copySurface?.surface === "button", "native button role was not materialized");
  assert(buttonItem.copySurface.ruleIndex === 0, `button copy surface rule index was ${buttonItem.copySurface.ruleIndex}`);
  assert(buttonItem.copySurface.matcher?.kind === "role", "role matcher did not win before the matching adapter binding");
  assert(buttonItem.copySurface.matcher?.value === "button", "native button did not use the button role matcher");

  const multiRoleItem = items.find((item) => item.selector === "#multi-role-copy");
  assert(multiRoleItem?.role === explicitRoleEvidence, `serialized explicit role was ${multiRoleItem?.role}`);
  assert(multiRoleItem.copySurface?.surface === "button", "multi-token explicit role did not resolve a copy surface");
  assert(multiRoleItem.copySurface.ruleIndex === 0, `multi-token role rule index was ${multiRoleItem.copySurface.ruleIndex}`);
  assert(multiRoleItem.copySurface.matcher?.kind === "role", "multi-token role did not use a role matcher");
  assert(multiRoleItem.copySurface.matcher?.value === "switch", "multi-token role did not resolve to the first concrete role");

  const unmatchedItem = items.find((item) => item.text === "매핑되지 않은 참고 문구");
  assert(unmatchedItem !== undefined, "unmatched reference copy was not captured");
  assert(unmatchedItem.copySurface === undefined, "unmatched reference copy received an implicit surface");
  assert(
    items.every((item) => item.copySurface?.matcher?.value !== nonMatchingWebDomSelector),
    "valid non-matching web-dom selector assigned a copy surface"
  );
}

function assertNestedSurfaceInheritance(auditResult) {
  const items = textInventoryItems(auditResult);
  const nestedButtonItem = items.find((item) => item.selector === "#nested-button-copy");
  assert(nestedButtonItem !== undefined, "nested button copy was not captured");
  assert(nestedButtonItem.copySurface?.surface === "button", "nested button copy did not inherit the button surface");
  assert(nestedButtonItem.copySurface.ruleIndex === 0, `nested button surface rule index was ${nestedButtonItem.copySurface.ruleIndex}`);
  assert(nestedButtonItem.copySurface.matcher?.kind === "role", "nested button copy did not inherit a role matcher");
  assert(nestedButtonItem.copySurface.matcher?.value === "button", "nested button copy did not inherit the native button role");
}

function assertSurfacePrecedence(auditResult) {
  const items = textInventoryItems(auditResult);
  const directNodeItem = items.find((item) => item.selector === directNodeSelector);
  assert(directNodeItem?.copySurface?.surface === "marketing", "direct node surface did not outrank its button ancestor");
  assert(directNodeItem.copySurface.ruleIndex === 7, `direct node surface rule index was ${directNodeItem.copySurface.ruleIndex}`);
  assert(directNodeItem.copySurface.matcher?.value === directNodeSelector, "direct node matcher provenance was not retained");

  const nearestAncestorItem = items.find((item) => item.selector === "#nearest-surface-copy");
  assert(nearestAncestorItem?.copySurface?.surface === "body", "nearest ancestor surface did not outrank the farther button ancestor");
  assert(nearestAncestorItem.copySurface.ruleIndex === 8, `nearest ancestor surface rule index was ${nearestAncestorItem.copySurface.ruleIndex}`);
  assert(nearestAncestorItem.copySurface.matcher?.value === nearestAncestorSelector, "nearest ancestor matcher provenance was not retained");
}

function textInventoryItems(auditResult) {
  const textEvidence = auditResult.evidenceAssets.find((asset) => asset.id === "text-inventory-desktop");
  const items = textEvidence?.data?.items;
  assert(Array.isArray(items), "desktop text inventory items were not recorded");
  return items;
}

function assertCriterionMaxScore(auditResult, expectedViewports) {
  const score = auditResult.advisoryScore;
  assert(score.formulaVersion === "epistemic-criterion-max-v2", `score formula was ${score.formulaVersion}`);
  assert(score.value === 63.2, `criterion-max score was ${score.value}`);
  assert(score.band === "needs-work", `criterion-max band was ${score.band}`);
  assert(score.totalDeduction === 36.8, `criterion-max total deduction was ${score.totalDeduction}`);
  assert(score.saturated === false, "criterion-max score was unexpectedly saturated");
  assert(score.deductions.length === 5, `criterion-max emitted ${score.deductions.length} deductions`);
  assert(sum(score.deductions.map((deduction) => deduction.points)) === 36.8, "group deductions did not add to 36.8");

  const criterionIds = new Set(auditResult.findings.map((finding) => finding.criterionId));
  assert(criterionIds.size === 5, `copy fixture covered ${criterionIds.size} distinct criteria`);
  for (const deduction of score.deductions) {
    const representative = auditResult.findings.find((finding) => finding.id === deduction.findingId);
    assert(representative !== undefined, `deduction referenced missing representative ${deduction.findingId}`);
    const findingIds = auditResult.findings
      .filter((finding) => finding.criterionId === representative.criterionId)
      .map((finding) => finding.id)
      .sort();
    const viewports = [...new Set(auditResult.findings
      .filter((finding) => finding.criterionId === representative.criterionId)
      .map((finding) => finding.viewport))]
      .sort();
    assert(JSON.stringify(deduction.findingIds) === JSON.stringify(findingIds), `group members drifted for ${representative.criterionId}`);
    assert(deduction.findingId === findingIds[0], `group representative drifted for ${representative.criterionId}`);
    assert(JSON.stringify(deduction.viewports) === JSON.stringify(viewports), `group viewports drifted for ${representative.criterionId}`);
    assert(JSON.stringify(viewports) === JSON.stringify([...expectedViewports].sort()), `unexpected viewports for ${representative.criterionId}`);
  }
}

function assertEmptyCriterionMaxScore(auditResult, label) {
  const score = auditResult.advisoryScore;
  assert(score.formulaVersion === "epistemic-criterion-max-v2", `${label} score formula was ${score.formulaVersion}`);
  assert(score.value === 100, `${label} score was ${score.value}`);
  assert(score.band === "strong", `${label} band was ${score.band}`);
  assert(score.totalDeduction === 0, `${label} total deduction was ${score.totalDeduction}`);
  assert(score.saturated === false, `${label} score was unexpectedly saturated`);
  assert(score.deductions.length === 0, `${label} emitted score deductions`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sum(values) {
  return Math.round(values.reduce((total, value) => total + value, 0) * 10) / 10;
}

function run(command, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => resolveRun(code ?? 1));
  });
}

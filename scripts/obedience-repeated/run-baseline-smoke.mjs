#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_VIEWPORT_PRESETS,
  renderMarkdownReport
} from "../../packages/core/dist/index.js";
import { auditUrl } from "../../packages/visual-audit/dist/index.js";
import { startLocalFixtureServer } from "../local-fixture-server.mjs";
import {
  CASES,
  readCaseInputs
} from "./contract.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../..");
const outRoot = join(repoRoot, "runs", "obedience-repeated-baselines");
const copyStyle = {
  schemaVersion: "0.2",
  locale: "en",
  josaHedgePolicy: "allow"
};

await rm(outRoot, { recursive: true, force: true });
await mkdir(outRoot, { recursive: true });

const profiles = new Map();
const selectors = new Map();
for (const benchmarkCase of CASES) {
  const caseInputs = await readCaseInputs(benchmarkCase.id);
  const server = await startLocalFixtureServer(
    dirname(benchmarkCase.fixturePath)
  );
  try {
    const outDir = join(outRoot, benchmarkCase.id);
    const result = await auditUrl({
      url: `${server.baseUrl}/${benchmarkCase.fixturePath.split("/").at(-1)}`,
      outDir,
      viewportPresets: DEFAULT_VIEWPORT_PRESETS,
      copyStyle
    });
    await mkdir(outDir, { recursive: true });
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

    assert.equal(
      result.auditResult.status,
      "success",
      `${benchmarkCase.id}: baseline audit was not successful`
    );
    assert.deepStrictEqual(
      result.auditResult.failedChecks,
      [],
      `${benchmarkCase.id}: baseline audit contained failed checks`
    );
    const failures = deterministicFailures(result.auditResult);
    assert.equal(
      failures.length,
      4,
      `${benchmarkCase.id}: expected exactly four controlled deterministic failures`
    );
    const profile = failures
      .map((finding) =>
        [
          finding.criterionId,
          finding.checkName,
          finding.viewport
        ].join("|")
      )
      .sort();
    profiles.set(benchmarkCase.id, profile);
    selectors.set(
      benchmarkCase.id,
      failures
        .filter((finding) => finding.checkName === "placeholder-leak")
        .map((finding) => finding.selector)
        .sort()
    );

    const repaired = caseInputs.fixture
      .toString("utf8")
      .replace("<html>", '<html lang="en">')
      .replace("{{pendingCount}}", "8");
    assert.notEqual(
      repaired,
      caseInputs.fixture.toString("utf8"),
      `${benchmarkCase.id}: controlled repair was not applicable`
    );
  } finally {
    await server.close();
  }
}

assert.deepStrictEqual(
  profiles.get("operations-queue"),
  profiles.get("support-triage"),
  "The two cases did not expose equal deterministic failure families"
);
assert.notDeepStrictEqual(
  selectors.get("operations-queue"),
  selectors.get("support-triage"),
  "The two cases unexpectedly shared placeholder selectors"
);

console.log(
  "Repeated obedience baseline smoke passed: two distinct cases exposed the same four deterministic failure families with case-specific selectors."
);

function deterministicFailures(auditResult) {
  return auditResult.findings.filter(
    (finding) =>
      finding.determinism === "deterministic" &&
      finding.resultKind === "failure"
  );
}

#!/usr/bin/env node
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderMarkdownReport } from "../packages/core/dist/index.js";
import { auditUrl } from "../packages/visual-audit/dist/index.js";
import { calibrationFixturePaths } from "./calibration-paths.mjs";
import { buildCalibrationSummary } from "./calibration-summary.mjs";
import { copyStyleForCalibration, desktopViewport } from "./copy-calibration-config.mjs";
import { startLocalFixtureServer } from "./local-fixture-server.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const fixtureRoot = resolve(repoRoot, "examples/ui-quality-fixtures");
const manifestPath = resolve(repoRoot, "examples/calibration-datasets/korean-copy/manifest.jsonl");
const outRoot = resolve(repoRoot, "runs/calibration");
const records = readManifest(manifestPath);

rmSync(outRoot, { recursive: true, force: true });

const fixtureServer = await startLocalFixtureServer(fixtureRoot);

try {
  const { baseUrl } = fixtureServer;
  const runs = [];
  for (const record of records) {
    const { relativePath: fixtureRelativePath, outDir: fixtureOutDir } = calibrationFixturePaths(
      outRoot,
      record.fixturePath
    );
    try {
      const result = await auditUrl({
        url: `${baseUrl}/${encodeURI(fixtureRelativePath)}`,
        outDir: fixtureOutDir,
        viewportPresets: [desktopViewport],
        copyStyle: copyStyleForCalibration(record.josaHedgePolicy)
      });
      writeFileSync(join(fixtureOutDir, "audit.json"), `${JSON.stringify(result.auditResult, null, 2)}\n`);
      writeFileSync(join(fixtureOutDir, "metadata.json"), `${JSON.stringify(result.metadata, null, 2)}\n`);
      writeFileSync(join(fixtureOutDir, "report.md"), renderMarkdownReport({ auditResult: result.auditResult }));
      runs.push({ record, auditResult: result.auditResult });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Calibration audit failed for ${record.fixturePath}: ${message}`);
      runs.push({
        record,
        auditResult: { status: "error", failedChecks: [], findings: [] },
        error: message
      });
    }
  }

  const summary = buildCalibrationSummary(runs);
  const summaryPath = join(outRoot, "calibration-summary.json");
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(
    `Calibration ${summary.status}: ${summary.fixtures.length} fixtures, ` +
    `${summary.totals.tp} TP, ${summary.totals.fp} FP, ${summary.totals.fn} FN ` +
    `and ${summary.auditFailures} audit failures (${relative(repoRoot, summaryPath)}).`
  );
  if (summary.status === "drift") {
    process.exitCode = 1;
  }
} finally {
  await fixtureServer.close();
}

function readManifest(path) {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(
          `Invalid calibration manifest JSON on line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    });
}

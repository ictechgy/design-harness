#!/usr/bin/env node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../../..");
const validatorPath = resolve(scriptDir, "validate-manifest.mjs");
const manifestPath = resolve(scriptDir, "manifest.jsonl");
const records = readFileSync(manifestPath, "utf8").trim().split(/\r?\n/).map((line) => JSON.parse(line));
const tempRoot = mkdtempSync(join(tmpdir(), "design-harness-korean-copy-"));

try {
  expectFailure("missing-fixture", records.slice(1), "manifest is missing committed Korean fixture");

  const missingSource = records.map((record) => ({ ...record }));
  delete missingSource[0].source;
  expectFailure("missing-source", missingSource, "missing required field source");

  const restricted = records.map((record) => ({ ...record }));
  restricted[0].redistributionStatus = "internal-only";
  expectFailure("restricted", restricted, "committed fixture redistributionStatus must be allowed");

  expectFailure("duplicate", [...records, { ...records[0] }], "duplicate fixturePath");
  console.log("Korean copy fixture provenance regression checks passed.");
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

function expectFailure(name, candidateRecords, expectedMessage) {
  const candidatePath = join(tempRoot, `${name}.jsonl`);
  writeFileSync(candidatePath, `${candidateRecords.map((record) => JSON.stringify(record)).join("\n")}\n`);
  const result = spawnSync(process.execPath, [validatorPath, candidatePath], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status === 0 || !output.includes(expectedMessage)) {
    throw new Error(`${name} did not fail with ${JSON.stringify(expectedMessage)}:\n${output}`);
  }
}

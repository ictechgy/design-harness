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

  const missingExpectations = structuredClone(records);
  delete missingExpectations[0].expectedFindings;
  expectFailure("missing-expectations", missingExpectations, "missing required field expectedFindings");

  const unknownExpected = structuredClone(records);
  unknownExpected[0].expectedFindings.push({ checkName: "unknown-copy-check", count: 1 });
  expectFailure("unknown-expected", unknownExpected, "is not registered: unknown-copy-check");

  const unknownNegative = structuredClone(records);
  unknownNegative[0].shouldNotFlag.registeredCheckNames[0] = "unknown-copy-check";
  expectFailure("unknown-negative", unknownNegative, "is not registered: unknown-copy-check");

  const registeredFuture = structuredClone(records);
  registeredFuture[0].shouldNotFlag.futureCriteria.push({
    criterionId: "placeholder-leak",
    rationale: "Regression fixture for registry collision."
  });
  expectFailure("registered-future", registeredFuture, "is already registered: placeholder-leak");

  const duplicateExpected = structuredClone(records);
  duplicateExpected[5].expectedFindings.push({ ...duplicateExpected[5].expectedFindings[0] });
  expectFailure("duplicate-expected", duplicateExpected, ".checkName duplicates placeholder-leak");

  const duplicateNegative = structuredClone(records);
  duplicateNegative[0].shouldNotFlag.registeredCheckNames.push("placeholder-leak");
  expectFailure("duplicate-negative", duplicateNegative, "duplicates placeholder-leak");

  const overlap = structuredClone(records);
  overlap[5].shouldNotFlag.registeredCheckNames.push("placeholder-leak");
  expectFailure("overlap", overlap, "placeholder-leak cannot be both expected and registered under shouldNotFlag");

  const zeroCount = structuredClone(records);
  zeroCount[5].expectedFindings[0].count = 0;
  expectFailure("zero-count", zeroCount, ".count must be a positive integer");

  const incompletePartition = structuredClone(records);
  incompletePartition[0].shouldNotFlag.registeredCheckNames.pop();
  expectFailure("incomplete-partition", incompletePartition, "banned-phrase must be expected or registered under shouldNotFlag");

  const declaredFuture = structuredClone(records);
  declaredFuture[0].shouldNotFlag.futureCriteria.push({
    criterionId: "content.future-copy-control",
    rationale: "Explicit future criterion declaration for regression coverage."
  });
  expectSuccess("declared-future", declaredFuture);

  console.log("Korean copy fixture manifest regression checks passed.");
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

function expectSuccess(name, candidateRecords) {
  const candidatePath = join(tempRoot, `${name}.jsonl`);
  writeFileSync(candidatePath, `${candidateRecords.map((record) => JSON.stringify(record)).join("\n")}\n`);
  const result = spawnSync(process.execPath, [validatorPath, candidatePath], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status !== 0) {
    throw new Error(`${name} unexpectedly failed:\n${output}`);
  }
}

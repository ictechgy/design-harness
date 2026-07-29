#!/usr/bin/env node

import { lstat, readFile, readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { validatePreservation } from "../obedience-benchmark/preservation.mjs";
import {
  BENCHMARK_ID,
  BENCHMARK_ROOT,
  CASES,
  EXPECTED_EXECUTION_COUNT,
  MATRIX,
  REPEAT_COUNT,
  V1_ROOT,
  readAllInputs,
  sha256
} from "./contract.mjs";
import { validateCompleteSnapshot } from "./results.mjs";

export async function validateRepeatedBenchmark({
  benchmarkRoot = BENCHMARK_ROOT
} = {}) {
  const root = resolve(benchmarkRoot);
  const status = JSON.parse(
    await readFile(join(root, "status.json"), "utf8")
  );
  if (status.status === "ready-for-operator") {
    return validatePreparationSnapshot({ benchmarkRoot: root });
  }
  if (status.status === "complete") {
    return validateCompleteSnapshot({ benchmarkRoot: root });
  }
  throw new Error(
    `Unknown obedience-repeated-v1 status: ${String(status.status)}`
  );
}

const READY_ENTRIES = Object.freeze({
  "cases": "directory",
  "common-task.md": "file",
  "copy-style.yaml": "file",
  "protocol.md": "file",
  "status.json": "file",
  "v1-preservation.json": "file"
});
const STATUS_KEYS = Object.freeze([
  "benchmarkId",
  "caseCount",
  "claimBoundary",
  "coordinateCount",
  "executionCount",
  "providerExecution",
  "publicResults",
  "repeatCount",
  "schemaVersion",
  "status"
]);

export async function validatePreparationSnapshot({
  benchmarkRoot = BENCHMARK_ROOT
} = {}) {
  const root = resolve(benchmarkRoot);
  const issues = [];
  const inputs = await readAllInputs({ benchmarkRoot: root });
  const status = await readJson(join(root, "status.json"), issues, "status");
  await validateReadyTree(root, issues);
  validateStatus(status, issues);
  validateMatrix(issues);
  await validateInputs(inputs, issues);
  await validateV1Preservation(root, issues);
  validatePublicCopy(await readFile(join(root, "protocol.md"), "utf8"), issues);
  if (issues.length > 0) {
    throw new Error(
      `obedience-repeated-v1 validation failed with ${issues.length} issue${issues.length === 1 ? "" : "s"}:\n` +
        issues.map((issue) => `- ${issue}`).join("\n")
    );
  }
  return {
    status: status.status,
    caseCount: CASES.length,
    repeatCount: REPEAT_COUNT,
    coordinateCount: MATRIX.length / (CASES.length * REPEAT_COUNT),
    executionCount: MATRIX.length
  };
}

async function validateReadyTree(root, issues) {
  let rootEntries;
  try {
    const rootInfo = await lstat(root);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
      issues.push("benchmark root must be a real directory");
      return;
    }
    rootEntries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    issues.push(`cannot inspect benchmark root: ${error.message}`);
    return;
  }
  const names = new Set(rootEntries.map((entry) => entry.name));
  for (const entry of rootEntries) {
    if (!Object.hasOwn(READY_ENTRIES, entry.name)) {
      issues.push(
        `ready-for-operator tree contains unexpected entry ${entry.name}`
      );
    }
  }
  for (const [name, type] of Object.entries(READY_ENTRIES)) {
    if (!names.has(name)) {
      issues.push(`ready-for-operator tree is missing ${name}`);
      continue;
    }
    const info = await lstat(join(root, name));
    const matches =
      !info.isSymbolicLink() &&
      (type === "file" ? info.isFile() : info.isDirectory());
    if (!matches) {
      issues.push(`${name} must be a regular ${type}`);
    }
  }

  const casesRoot = join(root, "cases");
  try {
    const caseEntries = await readdir(casesRoot, { withFileTypes: true });
    if (
      caseEntries.length !== 1 ||
      caseEntries[0].name !== "support-triage" ||
      !caseEntries[0].isDirectory() ||
      caseEntries[0].isSymbolicLink()
    ) {
      issues.push(
        "cases must contain only the real support-triage directory; operations-queue is pinned from obedience-v1"
      );
      return;
    }
    const supportEntries = await readdir(
      join(casesRoot, "support-triage"),
      { withFileTypes: true }
    );
    const expected = new Set(["fixture.html", "preservation-oracle.json"]);
    if (
      supportEntries.length !== expected.size ||
      supportEntries.some(
        (entry) =>
          !expected.has(entry.name) ||
          !entry.isFile() ||
          entry.isSymbolicLink()
      )
    ) {
      issues.push(
        "support-triage must contain only regular fixture.html and preservation-oracle.json files"
      );
    }
  } catch (error) {
    issues.push(`cannot inspect case tree: ${error.message}`);
  }
}

function validateStatus(status, issues) {
  if (!isPlainObject(status)) {
    issues.push("status.json must be an object");
    return;
  }
  exactKeys(status, STATUS_KEYS, "status.json", issues);
  const expected = {
    schemaVersion: "obedience-repeated-v1/status/v1",
    benchmarkId: BENCHMARK_ID,
    status: "ready-for-operator",
    caseCount: CASES.length,
    repeatCount: REPEAT_COUNT,
    coordinateCount: 12,
    executionCount: EXPECTED_EXECUTION_COUNT,
    providerExecution: "not-performed",
    publicResults: "absent",
    claimBoundary: "preparation-contract-only"
  };
  for (const [key, value] of Object.entries(expected)) {
    if (status[key] !== value) {
      issues.push(
        `status.json ${key} must be ${JSON.stringify(value)}`
      );
    }
  }
}

function validateMatrix(issues) {
  if (MATRIX.length !== EXPECTED_EXECUTION_COUNT) {
    issues.push(
      `matrix must contain ${EXPECTED_EXECUTION_COUNT} executions, found ${MATRIX.length}`
    );
  }
  const ids = new Set(MATRIX.map((entry) => entry.id));
  if (ids.size !== MATRIX.length) {
    issues.push("matrix execution IDs must be unique");
  }
  for (const benchmarkCase of CASES) {
    for (let repeat = 1; repeat <= REPEAT_COUNT; repeat += 1) {
      const entries = MATRIX.filter(
        (entry) =>
          entry.caseId === benchmarkCase.id && entry.repeat === repeat
      );
      if (entries.length !== 12) {
        issues.push(
          `${benchmarkCase.id} repeat ${repeat} must contain 12 coordinates`
        );
      }
      if (new Set(entries.map((entry) => entry.coordinateId)).size !== 12) {
        issues.push(
          `${benchmarkCase.id} repeat ${repeat} coordinates must be unique`
        );
      }
    }
  }
}

async function validateInputs(inputs, issues) {
  const caseHashes = [];
  for (const benchmarkCase of CASES) {
    const caseInputs = inputs.cases.get(benchmarkCase.id);
    const source = caseInputs.fixture.toString("utf8");
    const repaired = source
      .replace("<html>", '<html lang="en">')
      .replace("{{pendingCount}}", "8");
    if (repaired === source) {
      issues.push(
        `${benchmarkCase.id} fixture must expose the controlled lang and placeholder defects`
      );
      continue;
    }
    const preservation = validatePreservation({
      source: repaired,
      baselineSource: source,
      oracle: caseInputs.preservationOracle,
      label: `${benchmarkCase.id} synthetic repaired source`
    });
    if (!preservation.ok) {
      issues.push(
        `${benchmarkCase.id} case-specific preservation oracle rejected the exact controlled repair: ${preservation.violations.map((entry) => entry.code).join(", ")}`
      );
    }
    caseHashes.push(caseInputs.hashes.fixtureSha256);
  }
  if (new Set(caseHashes).size !== CASES.length) {
    issues.push("case fixtures must have distinct source hashes");
  }
  if (
    inputs.shared.commonTask.length === 0 ||
    inputs.shared.copyStyle.length === 0 ||
    inputs.shared.protocol.length === 0
  ) {
    issues.push("shared benchmark inputs must be non-empty");
  }
}

async function validateV1Preservation(root, issues) {
  const oracle = await readJson(
    join(root, "v1-preservation.json"),
    issues,
    "v1 preservation oracle"
  );
  if (!isPlainObject(oracle) || !isPlainObject(oracle.files)) {
    issues.push("v1-preservation.json must contain a files object");
    return;
  }
  exactKeys(
    oracle,
    ["fileCount", "files", "root", "schemaVersion"],
    "v1-preservation.json",
    issues
  );
  if (
    oracle.schemaVersion !==
      "obedience-repeated-v1/v1-preservation/v1" ||
    oracle.root !== "../obedience-v1"
  ) {
    issues.push("v1-preservation.json identity is invalid");
  }
  const actualFiles = await regularFilesRecursively(V1_ROOT);
  const relativeFiles = actualFiles.map((path) =>
    relative(V1_ROOT, path).split(sep).join("/")
  );
  if (
    oracle.fileCount !== relativeFiles.length ||
    Object.keys(oracle.files).length !== relativeFiles.length
  ) {
    issues.push("obedience-v1 file count drifted");
  }
  for (const relativePath of relativeFiles) {
    const expectedHash = oracle.files[relativePath];
    const actualHash = sha256(
      await readFile(join(V1_ROOT, relativePath))
    );
    if (expectedHash !== actualHash) {
      issues.push(`obedience-v1 byte drift: ${relativePath}`);
    }
  }
  for (const relativePath of Object.keys(oracle.files)) {
    if (!relativeFiles.includes(relativePath)) {
      issues.push(
        `v1-preservation.json contains stale path ${relativePath}`
      );
    }
  }
}

async function regularFilesRecursively(root) {
  const output = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      output.push(...await regularFilesRecursively(path));
    } else if (entry.isFile()) {
      output.push(path);
    } else {
      throw new Error(`obedience-v1 contains unsupported entry: ${path}`);
    }
  }
  return output.sort();
}

function validatePublicCopy(source, issues) {
  for (const [pattern, label] of [
    [/\bproves?\s+(?:that\s+)?agents?\s+obey\b/i, "general obedience proof"],
    [/\b(?:best|superior)\s+(?:model|provider|executor|mechanism)\b/i, "ranking"],
    [/\bstatistically\s+significant\b/i, "statistical significance"],
    [/\b(?:causes?|caused)\s+(?:better|improved|higher)\b/i, "causal effect"],
    [/\bWCAG compliant\b/i, "WCAG compliance"],
    [/\b(?:is|are|was|were)\s+accessible\b/i, "unqualified accessibility"],
    [/\bobjectively\s+better\b/i, "objective superiority"],
    [/\bgood design\b/i, "unqualified design quality"]
  ]) {
    if (pattern.test(source)) {
      issues.push(`protocol contains forbidden ${label} claim`);
    }
  }
}

async function readJson(path, issues, label) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    issues.push(`cannot read ${label}: ${error.message}`);
    return null;
  }
}

function exactKeys(value, expected, label, issues) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    issues.push(`${label} keys must be exactly ${wanted.join(", ")}`);
  }
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isDirectExecution) {
  try {
    const summary = await validateRepeatedBenchmark();
    console.log(
      "Validated obedience-repeated-v1 public snapshot: " +
      JSON.stringify(summary)
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

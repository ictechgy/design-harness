#!/usr/bin/env node

import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  BENCHMARK_ROOT,
  MATRIX,
  REPO_ROOT,
  canonicalJson,
  deliveryStanzaFor,
  expectedExecutableFor,
  readCommonInputs,
  resolvedModelMatches,
  sha256
} from "./contract.mjs";
import { validatePreservation } from "./preservation.mjs";
import {
  BLOCKED_CLAIMS_STATEMENT,
  COMPLETION_PHRASE,
  LIMITATIONS,
  renderReport
} from "./render.mjs";

export const RESULTS_SCHEMA_VERSION = "obedience-v1/results/v1";
export const TERMINAL_STATUSES = Object.freeze([
  "completed",
  "error",
  "timeout",
  "unavailable"
]);
export const SCORE_MEASUREMENT_LABEL =
  "secondary/advisory, formula-bound";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ISO_INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SAFE_SLUG_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;
const ABSOLUTE_PRIVATE_PATH_PATTERN =
  /(?:^|[\s"'=(])(?:\/Users\/[^/\s]+|\/home\/[^/\s]+|\/private\/(?:tmp|var)\/\S+|\/tmp\/\S+|[A-Za-z]:\\Users\\[^\\\s]+)/;
const SECRET_VALUE_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/i,
  /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{12,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{12,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/
];
const FORBIDDEN_PUBLIC_KEYS = [
  /^(?:argv|args|rawCommand|commandLine|shellCommand)$/i,
  /^(?:env|environment|environmentVariables|rawEnvironment)$/i,
  /^(?:credential|credentials|authorization|apiKey|accessToken|refreshToken|secret)$/i,
  /^(?:rawTranscript|transcript|transcriptPath|homePath|tempPath|workspacePath)$/i
];
const SAFE_COMMAND_DESCRIPTOR_KEYS = Object.freeze([
  "deliveryMechanism",
  "effort",
  "executable",
  "invocationMode",
  "promptInputMode",
  "requestedModel"
]);
const SAFE_USAGE_KEYS = new Set([
  "cachedInputTokens",
  "costUsd",
  "inputTokens",
  "outputTokens",
  "totalTokens"
]);
const OPERATIONAL_FAILURE_KINDS = new Set([
  "authentication",
  "transient-tool"
]);
const FAILURE_FIELDS = Object.freeze([
  "checkName",
  "count",
  "criterionId",
  "selector",
  "viewport"
]);

export class BenchmarkValidationError extends Error {
  constructor(issues, label = "obedience-v1 validation") {
    super(
      `${label} failed with ${issues.length} issue${issues.length === 1 ? "" : "s"}:\n` +
        issues.map((issue) => `- ${issue}`).join("\n")
    );
    this.name = "BenchmarkValidationError";
    this.issues = issues;
  }
}

/**
 * Validate a public obedience-v1 snapshot. The options make the pure checks
 * reusable by mutation regressions without weakening the normal CLI path.
 */
export async function validatePublicSnapshot({
  results,
  benchmarkRoot = BENCHMARK_ROOT,
  reportSource,
  roadmapSource,
  commonInputs,
  requireCompletion = true
}) {
  const issues = [];
  const root = resolve(benchmarkRoot);
  const resolvedCommonInputs = commonInputs ?? await readCommonInputs();
  const report =
    reportSource ?? await readFile(join(root, "report.md"), "utf8");
  const roadmap =
    roadmapSource ??
    await readFile(join(REPO_ROOT, "docs", "ROADMAP.md"), "utf8");

  validateNoPrivateMaterial(results, "$", issues);
  validateTopLevel(results, issues);

  const cells = Array.isArray(results?.cells) ? results.cells : [];
  validateMatrix(cells, issues);
  validateComparability(results?.comparability, resolvedCommonInputs, issues);

  const expectedById = new Map(MATRIX.map((cell) => [cell.id, cell]));
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index];
    const path = `$.cells[${index}]`;
    await validateCell({
      cell,
      expected: expectedById.get(cell?.id),
      path,
      root,
      comparability: results?.comparability,
      preservationOracle: resolvedCommonInputs.preservationOracle,
      issues
    });
  }
  validateControlledBaselines(cells, issues);

  validateAggregate(results?.aggregate, cells, issues);
  validateLimitations(results?.limitations, issues);
  for (let index = 0; index < cells.length; index += 1) {
    if (
      typeof results?.recordedAt === "string" &&
      typeof cells[index]?.audit?.finalFinishedAt === "string" &&
      Date.parse(results.recordedAt) <
        Date.parse(cells[index].audit.finalFinishedAt)
    ) {
      issues.push(
        `$.recordedAt must not precede $.cells[${index}].audit.finalFinishedAt`
      );
    }
  }
  validateCompletion(results, cells, report, roadmap, requireCompletion, issues);

  let expectedReport;
  try {
    expectedReport = renderReport(results);
  } catch (error) {
    issues.push(`report rendering failed: ${error.message}`);
  }
  if (expectedReport !== undefined && report !== expectedReport) {
    issues.push(
      "docs/benchmarks/obedience-v1/report.md is stale or does not exactly match deterministic rendering"
    );
  }
  validatePublicCopy(report, "$report", issues);
  validatePublicCopy(roadmap, "$roadmap", issues);

  const expectedFinalNames = new Set(MATRIX.map((cell) => `${cell.id}.html`));
  try {
    const actualFinalNames = new Set(
      (await readdir(join(root, "final-sources")))
        .filter((name) => !name.startsWith("."))
    );
    for (const name of actualFinalNames) {
      if (!expectedFinalNames.has(name)) {
        issues.push(`unexpected public final source: final-sources/${name}`);
      }
    }
    for (const name of expectedFinalNames) {
      if (!actualFinalNames.has(name)) {
        issues.push(`missing public final source: final-sources/${name}`);
      }
    }
  } catch (error) {
    issues.push(`cannot inspect public final sources: ${error.message}`);
  }

  if (issues.length > 0) {
    throw new BenchmarkValidationError(issues);
  }

  return {
    cellCount: cells.length,
    completedCellCount: cells.filter(
      (cell) => cell.terminalStatus === "completed"
    ).length,
    passedBothCount: cells.filter((cell) => cell.primary?.passedBoth).length
  };
}

export function recomputeAggregate(cells) {
  const statusCounts = Object.fromEntries(
    TERMINAL_STATUSES.map((status) => [status, 0])
  );
  let initialDeterministicFailureCount = 0;
  let finalDeterministicFailureCount = 0;
  let closedDeterministicFailureCount = 0;
  let newlyIntroducedDeterministicFailureCount = 0;
  let deterministicClosureCellCount = 0;
  let preservationPassCellCount = 0;
  let passedBothCellCount = 0;
  let operationalRetryCellCount = 0;
  let cellsWithNewFailures = 0;

  for (const cell of cells) {
    if (Object.hasOwn(statusCounts, cell.terminalStatus)) {
      statusCounts[cell.terminalStatus] += 1;
    }
    const primary = cell.primary ?? {};
    initialDeterministicFailureCount +=
      primary.initialDeterministicFailureCount ?? 0;
    finalDeterministicFailureCount +=
      primary.finalDeterministicFailureCount ?? 0;
    closedDeterministicFailureCount +=
      primary.closedDeterministicFailureCount ?? 0;
    newlyIntroducedDeterministicFailureCount +=
      primary.newlyIntroducedDeterministicFailureCount ?? 0;
    deterministicClosureCellCount += primary.deterministicClosure ? 1 : 0;
    preservationPassCellCount += primary.preservation?.passed ? 1 : 0;
    passedBothCellCount += primary.passedBoth ? 1 : 0;
    operationalRetryCellCount += cell.attempts?.length === 2 ? 1 : 0;
    cellsWithNewFailures +=
      (primary.newlyIntroducedDeterministicFailureCount ?? 0) > 0 ? 1 : 0;
  }

  return {
    totalCellCount: cells.length,
    terminalStatusCounts: statusCounts,
    completedCellCount: statusCounts.completed,
    deterministicClosureCellCount,
    preservationPassCellCount,
    passedBothCellCount,
    operationalRetryCellCount,
    cellsWithNewFailures,
    initialDeterministicFailureCount,
    finalDeterministicFailureCount,
    closedDeterministicFailureCount,
    newlyIntroducedDeterministicFailureCount,
    closureRate: closureRate(
      initialDeterministicFailureCount,
      closedDeterministicFailureCount
    )
  };
}

export function failureIdentityCounts(findings) {
  const counts = new Map();
  for (const finding of findings ?? []) {
    if (
      finding?.determinism !== "deterministic" ||
      finding?.resultKind !== "failure"
    ) {
      continue;
    }
    const identity = {
      criterionId: requiredFailureIdentity(finding.criterionId, "criterionId"),
      checkName: requiredFailureIdentity(finding.checkName, "checkName"),
      viewport: requiredFailureIdentity(finding.viewport, "viewport"),
      selector: requiredFailureIdentity(finding.selector, "selector")
    };
    const key = canonicalJson(identity);
    const existing = counts.get(key);
    counts.set(key, {
      ...identity,
      count: (existing?.count ?? 0) + 1
    });
  }
  return [...counts.values()].sort(compareFailures);
}

export function subtractFailureMultisets(left, right) {
  const leftFailures = Array.isArray(left) ? left : [];
  const rightFailures = Array.isArray(right) ? right : [];
  const rightCounts = new Map(
    rightFailures.map((failure) => [failureKey(failure), failure.count])
  );
  const result = [];
  for (const failure of leftFailures) {
    const count = Math.max(
      0,
      failure.count - (rightCounts.get(failureKey(failure)) ?? 0)
    );
    if (count > 0) {
      result.push({ ...failure, count });
    }
  }
  return result.sort(compareFailures);
}

export function countFailures(failures) {
  return (Array.isArray(failures) ? failures : []).reduce(
    (sum, failure) => sum + (Number.isInteger(failure.count) ? failure.count : 0),
    0
  );
}

export function closureRate(initialCount, closedCount) {
  if (initialCount === 0) {
    return 1;
  }
  return Number((closedCount / initialCount).toFixed(6));
}

export function auditSecondaryMetrics(audit) {
  const findings = Array.isArray(audit?.findings) ? audit.findings : [];
  const score = audit?.advisoryScore ?? {};
  return {
    advisoryScore: {
      formulaVersion: score.formulaVersion,
      value: score.value,
      max: score.max,
      band: score.band
    },
    deterministicRiskCount: findings.filter(
      (finding) =>
        finding?.determinism === "deterministic" &&
        finding?.resultKind === "risk"
    ).length,
    heuristicFindingCount: findings.filter(
      (finding) => finding?.determinism === "heuristic"
    ).length,
    needsReviewCount: findings.filter(
      (finding) => finding?.resultKind === "needs-review"
    ).length
  };
}

function validateTopLevel(results, issues) {
  if (!isPlainObject(results)) {
    issues.push("$ must be an object");
    return;
  }
  exactKeys(
    results,
    [
      "aggregate",
      "cells",
      "comparability",
      "limitations",
      "protocolVersion",
      "recordedAt",
      "schemaVersion",
      "snapshotDate"
    ],
    "$",
    issues
  );
  expectEqual(
    results.schemaVersion,
    RESULTS_SCHEMA_VERSION,
    "$.schemaVersion",
    issues
  );
  expectEqual(results.protocolVersion, "obedience-v1", "$.protocolVersion", issues);
  expectIsoInstant(results.recordedAt, "$.recordedAt", issues);
  expectUtcDate(results.snapshotDate, "$.snapshotDate", issues);
  if (
    typeof results.recordedAt === "string" &&
    typeof results.snapshotDate === "string" &&
    results.recordedAt.slice(0, 10) !== results.snapshotDate
  ) {
    issues.push("$.snapshotDate must equal the UTC date in $.recordedAt");
  }
}

function validateMatrix(cells, issues) {
  if (!Array.isArray(cells)) {
    issues.push("$.cells must be an array");
    return;
  }
  if (cells.length !== MATRIX.length) {
    issues.push(`$.cells must contain exactly ${MATRIX.length} cells`);
  }
  const expectedCoordinates = new Set(
    MATRIX.map((cell) => matrixCoordinate(cell))
  );
  const ids = new Set();
  const coordinates = new Set();
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index];
    const path = `$.cells[${index}]`;
    if (!isPlainObject(cell)) {
      issues.push(`${path} must be an object`);
      continue;
    }
    if (ids.has(cell.id)) {
      issues.push(`${path}.id duplicates cell ${String(cell.id)}`);
    }
    ids.add(cell.id);
    const coordinate = matrixCoordinate(cell);
    if (coordinates.has(coordinate)) {
      issues.push(`${path} duplicates matrix coordinate ${coordinate}`);
    }
    coordinates.add(coordinate);
    if (!expectedCoordinates.has(coordinate)) {
      issues.push(`${path} has unexpected matrix coordinate ${coordinate}`);
    }
  }
  for (const expected of MATRIX) {
    if (!ids.has(expected.id)) {
      issues.push(`$.cells omits required cell ${expected.id}`);
    }
  }
}

function validateComparability(comparability, commonInputs, issues) {
  const path = "$.comparability";
  if (!isPlainObject(comparability)) {
    issues.push(`${path} must be an object`);
    return;
  }
  exactKeys(
    comparability,
    [
      "agentPassCount",
      "auditSchemaVersion",
      "commonTaskSha256",
      "copyStyleSha256",
      "finalReauditCount",
      "fixtureSha256",
      "harnessBuildSha256",
      "harnessConfigSha256",
      "harnessVersion",
      "preservationOracleSha256",
      "protocolSha256",
      "scoreFormulaVersion"
    ],
    path,
    issues
  );
  for (const key of [
    "commonTaskSha256",
    "copyStyleSha256",
    "fixtureSha256",
    "harnessBuildSha256",
    "harnessConfigSha256",
    "preservationOracleSha256",
    "protocolSha256"
  ]) {
    expectPattern(comparability[key], SHA256_PATTERN, `${path}.${key}`, issues);
  }
  expectEqual(comparability.agentPassCount, 1, `${path}.agentPassCount`, issues);
  expectEqual(
    comparability.finalReauditCount,
    1,
    `${path}.finalReauditCount`,
    issues
  );
  for (const key of [
    "auditSchemaVersion",
    "harnessVersion",
    "scoreFormulaVersion"
  ]) {
    expectNonEmptyString(comparability[key], `${path}.${key}`, issues);
  }

  const expectedHashes = commonInputHashes(commonInputs);
  for (const [key, expected] of Object.entries(expectedHashes)) {
    if (expected !== undefined) {
      expectEqual(comparability[key], expected, `${path}.${key}`, issues);
    }
  }
}

async function validateCell({
  cell,
  expected,
  path,
  root,
  comparability,
  preservationOracle,
  issues
}) {
  if (!isPlainObject(cell)) {
    return;
  }
  exactKeys(
    cell,
    [
      "acceptedAttemptIndex",
      "attempts",
      "audit",
      "commandDescriptor",
      "editBoundary",
      "executor",
      "executorFamily",
      "executorLabel",
      "finalSourcePath",
      "id",
      "mechanism",
      "primary",
      "provenance",
      "secondary",
      "terminalStatus"
    ],
    path,
    issues
  );
  if (!expected) {
    return;
  }
  expectEqual(cell.id, expected.id, `${path}.id`, issues);
  expectEqual(
    cell.executorFamily,
    expected.executorFamily,
    `${path}.executorFamily`,
    issues
  );
  expectEqual(
    cell.executorLabel,
    expected.executorLabel,
    `${path}.executorLabel`,
    issues
  );
  expectEqual(
    cell.mechanism,
    expected.mechanism,
    `${path}.mechanism`,
    issues
  );
  expectOneOf(
    cell.terminalStatus,
    TERMINAL_STATUSES,
    `${path}.terminalStatus`,
    issues
  );

  validateExecutor(
    cell.executor,
    expected,
    cell.terminalStatus,
    `${path}.executor`,
    issues
  );
  validateCommandDescriptor(
    cell.commandDescriptor,
    expected,
    `${path}.commandDescriptor`,
    issues
  );
  expectEqual(
    cell.commandDescriptor?.executable,
    cell.executor?.binaryName,
    `${path}.commandDescriptor.executable`,
    issues
  );
  validateAttempts(cell, path, issues);
  validateEditBoundary(cell.editBoundary, `${path}.editBoundary`, issues);
  validateProvenance(cell, comparability, path, issues);
  validateAuditRecord(
    cell.audit,
    cell,
    comparability,
    `${path}.audit`,
    issues
  );
  validatePrimary(cell.primary, `${path}.primary`, issues);
  validateSecondary(cell.secondary, comparability, `${path}.secondary`, issues);

  const expectedSourcePath = `final-sources/${cell.id}.html`;
  expectEqual(
    cell.finalSourcePath,
    expectedSourcePath,
    `${path}.finalSourcePath`,
    issues
  );
  if (cell.finalSourcePath !== expectedSourcePath) {
    return;
  }

  try {
    const sourcePath = resolve(root, cell.finalSourcePath);
    const rel = relative(root, sourcePath);
    if (rel.startsWith("..") || rel === "") {
      issues.push(`${path}.finalSourcePath escapes the benchmark root`);
      return;
    }
    const source = await readFile(sourcePath, "utf8");
    validateNoPrivateMaterial(source, `${path}.finalSource`, issues);
    expectEqual(
      sha256(source),
      cell.provenance?.finalSourceSha256,
      `${path}.provenance.finalSourceSha256`,
      issues
    );
    const preservation = validatePreservation({
      source,
      oracle: preservationOracle,
      label: cell.id
    });
    const expectedPreservation = {
      passed: preservation.ok,
      violations: preservation.violations,
      metrics: preservation.metrics
    };
    expectDeepEqual(
      cell.primary?.preservation,
      expectedPreservation,
      `${path}.primary.preservation`,
      issues
    );
  } catch (error) {
    issues.push(`${path}.finalSourcePath cannot be validated: ${error.message}`);
  }
}

function validateExecutor(executor, expected, terminalStatus, path, issues) {
  if (!isPlainObject(executor)) {
    issues.push(`${path} must be an object`);
    return;
  }
  exactKeys(
    executor,
    [
      "binaryName",
      "cliVersion",
      "effort",
      "requestedModel",
      "resolvedModel",
      "versionSource"
    ],
    path,
    issues
  );
  expectPattern(executor.binaryName, SAFE_SLUG_PATTERN, `${path}.binaryName`, issues);
  expectEqual(
    executor.binaryName,
    expectedExecutableFor(expected),
    `${path}.binaryName`,
    issues
  );
  expectNonEmptyString(executor.cliVersion, `${path}.cliVersion`, issues);
  expectPattern(
    executor.versionSource,
    SAFE_SLUG_PATTERN,
    `${path}.versionSource`,
    issues
  );
  expectEqual(
    executor.requestedModel,
    expected.requestedModel,
    `${path}.requestedModel`,
    issues
  );
  if (terminalStatus === "completed") {
    expectNonEmptyString(executor.resolvedModel, `${path}.resolvedModel`, issues);
  } else if (
    executor.resolvedModel !== null &&
    (typeof executor.resolvedModel !== "string" ||
      executor.resolvedModel.trim() === "")
  ) {
    issues.push(
      `${path}.resolvedModel must be null or a non-empty explicit resolution`
    );
  }
  expectEqual(
    executor.effort,
    expected.effort ?? "provider-default",
    `${path}.effort`,
    issues
  );
  if (
    typeof executor.resolvedModel === "string" &&
    !resolvedModelMatches(expected, executor.resolvedModel)
  ) {
    issues.push(
      `${path}.resolvedModel (${executor.resolvedModel}) does not match requested model ${expected.requestedModel}`
    );
  }
}

function validateCommandDescriptor(descriptor, expected, path, issues) {
  if (!isPlainObject(descriptor)) {
    issues.push(`${path} must be an object`);
    return;
  }
  exactKeys(descriptor, SAFE_COMMAND_DESCRIPTOR_KEYS, path, issues);
  expectPattern(descriptor.executable, SAFE_SLUG_PATTERN, `${path}.executable`, issues);
  expectEqual(
    descriptor.executable,
    expectedExecutableFor(expected),
    `${path}.executable`,
    issues
  );
  expectPattern(
    descriptor.invocationMode,
    SAFE_SLUG_PATTERN,
    `${path}.invocationMode`,
    issues
  );
  expectPattern(
    descriptor.promptInputMode,
    SAFE_SLUG_PATTERN,
    `${path}.promptInputMode`,
    issues
  );
  expectEqual(
    descriptor.promptInputMode,
    "common-task-then-delivery-stanza",
    `${path}.promptInputMode`,
    issues
  );
  expectEqual(
    descriptor.requestedModel,
    expected.requestedModel,
    `${path}.requestedModel`,
    issues
  );
  expectEqual(
    descriptor.effort,
    expected.effort ?? "provider-default",
    `${path}.effort`,
    issues
  );
  expectEqual(
    descriptor.deliveryMechanism,
    expected.mechanism,
    `${path}.deliveryMechanism`,
    issues
  );
}

function validateEditBoundary(editBoundary, path, issues) {
  if (!isPlainObject(editBoundary)) {
    issues.push(`${path} must be an object`);
    return;
  }
  exactKeys(editBoundary, ["modifiedPaths", "passed"], path, issues);
  if (editBoundary.passed !== true) {
    issues.push(`${path}.passed must be true`);
  }
  if (!Array.isArray(editBoundary.modifiedPaths)) {
    issues.push(`${path}.modifiedPaths must be an array`);
    return;
  }
  const unique = new Set(editBoundary.modifiedPaths);
  if (unique.size !== editBoundary.modifiedPaths.length) {
    issues.push(`${path}.modifiedPaths must not contain duplicates`);
  }
  for (let index = 0; index < editBoundary.modifiedPaths.length; index += 1) {
    if (editBoundary.modifiedPaths[index] !== "fixture.html") {
      issues.push(
        `${path}.modifiedPaths[${index}] must be the only allowed edit path fixture.html`
      );
    }
  }
}

function validateAttempts(cell, path, issues) {
  const attemptsPath = `${path}.attempts`;
  if (!Array.isArray(cell.attempts) || ![1, 2].includes(cell.attempts.length)) {
    issues.push(`${attemptsPath} must contain one attempt or one allowed retry`);
    return;
  }
  if (
    !Number.isInteger(cell.acceptedAttemptIndex) ||
    cell.acceptedAttemptIndex < 1 ||
    cell.acceptedAttemptIndex > cell.attempts.length
  ) {
    issues.push(`${path}.acceptedAttemptIndex must identify a recorded attempt`);
    return;
  }
  if (cell.acceptedAttemptIndex !== cell.attempts.length) {
    issues.push(`${path}.acceptedAttemptIndex must select the final recorded attempt`);
  }
  for (let index = 0; index < cell.attempts.length; index += 1) {
    const attempt = cell.attempts[index];
    const attemptPath = `${attemptsPath}[${index}]`;
    validateAttempt(attempt, index + 1, attemptPath, issues);
    if (
      attempt?.resolvedModel !== null &&
      attempt?.resolvedModel !== cell.executor?.resolvedModel
    ) {
      issues.push(`${attemptPath}.resolvedModel must match the cell executor`);
    }
    if (
      index > 0 &&
      Date.parse(attempt?.startedAt) <
        Date.parse(cell.attempts[index - 1]?.endedAt)
    ) {
      issues.push(`${attemptPath}.startedAt must not precede the prior attempt end`);
    }
  }
  const accepted = cell.attempts[cell.acceptedAttemptIndex - 1];
  if (accepted?.status !== cell.terminalStatus) {
    issues.push(`${path}.terminalStatus must match the accepted attempt`);
  }
  if (
    accepted?.status === "completed" &&
    (typeof cell.executor?.resolvedModel !== "string" ||
      cell.executor.resolvedModel.trim() === "")
  ) {
    issues.push(`${path}.executor.resolvedModel is required for a completed cell`);
  }
  if (
    accepted?.privateTranscriptSha256 !==
    cell.provenance?.privateTranscriptSha256
  ) {
    issues.push(
      `${path}.provenance.privateTranscriptSha256 must identify the accepted attempt`
    );
  }

  if (cell.attempts.length === 1) {
    const only = cell.attempts[0];
    if (only?.operationalFailureKind !== null || only?.retryReason !== null) {
      issues.push(`${attemptsPath}[0] may not claim retry metadata without a retry`);
    }
    return;
  }

  const first = cell.attempts[0];
  const second = cell.attempts[1];
  if (!OPERATIONAL_FAILURE_KINDS.has(first?.operationalFailureKind)) {
    issues.push(
      `${attemptsPath}[0].operationalFailureKind must document authentication or transient-tool failure`
    );
  }
  if (!["error", "timeout", "unavailable"].includes(first?.status)) {
    issues.push(`${attemptsPath}[0].status is not eligible for operational retry`);
  }
  expectNonEmptyString(
    first?.retryReason,
    `${attemptsPath}[0].retryReason`,
    issues
  );
  if (
    second?.operationalFailureKind !== null ||
    second?.retryReason !== null
  ) {
    issues.push(`${attemptsPath}[1] may not declare another retry`);
  }
}

function validateAttempt(attempt, expectedIndex, path, issues) {
  if (!isPlainObject(attempt)) {
    issues.push(`${path} must be an object`);
    return;
  }
  exactKeys(
    attempt,
    [
      "endedAt",
      "exitStatus",
      "index",
      "operationalFailureKind",
      "privateTranscriptSha256",
      "resolvedModel",
      "retryReason",
      "signal",
      "startedAt",
      "status",
      "timedOut",
      "usage",
      "wallTimeMs"
    ],
    path,
    issues
  );
  expectEqual(attempt.index, expectedIndex, `${path}.index`, issues);
  expectOneOf(attempt.status, TERMINAL_STATUSES, `${path}.status`, issues);
  expectIsoInstant(attempt.startedAt, `${path}.startedAt`, issues);
  expectIsoInstant(attempt.endedAt, `${path}.endedAt`, issues);
  expectInteger(attempt.wallTimeMs, 0, Number.MAX_SAFE_INTEGER, `${path}.wallTimeMs`, issues);
  expectNullableInteger(
    attempt.exitStatus,
    -255,
    255,
    `${path}.exitStatus`,
    issues
  );
  if (attempt.signal !== null) {
    expectPattern(attempt.signal, SAFE_SLUG_PATTERN, `${path}.signal`, issues);
  }
  if (typeof attempt.timedOut !== "boolean") {
    issues.push(`${path}.timedOut must be boolean`);
  }
  if ((attempt.status === "timeout") !== attempt.timedOut) {
    issues.push(`${path}.timedOut must agree with timeout status`);
  }
  if (attempt.status === "completed" && attempt.exitStatus !== 0) {
    issues.push(`${path}.completed attempt must have exitStatus 0`);
  }
  if (attempt.status === "unavailable" && attempt.exitStatus !== null) {
    issues.push(`${path}.unavailable attempt must have null exitStatus`);
  }
  if (
    attempt.operationalFailureKind !== null &&
    !OPERATIONAL_FAILURE_KINDS.has(attempt.operationalFailureKind)
  ) {
    issues.push(`${path}.operationalFailureKind is not allowed`);
  }
  if (attempt.retryReason !== null) {
    expectNonEmptyString(attempt.retryReason, `${path}.retryReason`, issues);
  }
  expectPattern(
    attempt.privateTranscriptSha256,
    SHA256_PATTERN,
    `${path}.privateTranscriptSha256`,
    issues
  );
  if (attempt.status === "completed") {
    expectNonEmptyString(attempt.resolvedModel, `${path}.resolvedModel`, issues);
  } else if (
    attempt.resolvedModel !== null &&
    (typeof attempt.resolvedModel !== "string" ||
      attempt.resolvedModel.trim() === "")
  ) {
    issues.push(`${path}.resolvedModel must be null or a non-empty string`);
  }
  validateUsage(attempt.usage, `${path}.usage`, issues);

  if (
    typeof attempt.startedAt === "string" &&
    typeof attempt.endedAt === "string" &&
    Date.parse(attempt.endedAt) < Date.parse(attempt.startedAt)
  ) {
    issues.push(`${path}.endedAt must not precede startedAt`);
  }
}

function validateUsage(usage, path, issues) {
  if (usage === null) {
    return;
  }
  if (!isPlainObject(usage)) {
    issues.push(`${path} must be null or an object`);
    return;
  }
  for (const key of Object.keys(usage)) {
    if (!SAFE_USAGE_KEYS.has(key)) {
      issues.push(`${path}.${key} is not an allowed public usage field`);
      continue;
    }
    if (
      typeof usage[key] !== "number" ||
      !Number.isFinite(usage[key]) ||
      usage[key] < 0
    ) {
      issues.push(`${path}.${key} must be a non-negative finite number`);
    }
  }
}

function validateProvenance(cell, comparability, path, issues) {
  const provenance = cell.provenance;
  const provenancePath = `${path}.provenance`;
  if (!isPlainObject(provenance)) {
    issues.push(`${provenancePath} must be an object`);
    return;
  }
  exactKeys(
    provenance,
    [
      "agentPassCount",
      "auditSchemaVersion",
      "commonTaskSha256",
      "copyStyleSha256",
      "deliveryStanzaSha256",
      "externalCommandSha256",
      "finalReauditCount",
      "finalSourceSha256",
      "fixtureSha256",
      "harnessBuildSha256",
      "harnessConfigSha256",
      "harnessVersion",
      "preservationOracleSha256",
      "privateTranscriptSha256",
      "protocolSha256",
      "scoreFormulaVersion",
      "startingSourceSha256"
    ],
    provenancePath,
    issues
  );
  for (const key of [
    "commonTaskSha256",
    "copyStyleSha256",
    "deliveryStanzaSha256",
    "externalCommandSha256",
    "finalSourceSha256",
    "fixtureSha256",
    "harnessBuildSha256",
    "harnessConfigSha256",
    "preservationOracleSha256",
    "privateTranscriptSha256",
    "protocolSha256",
    "startingSourceSha256"
  ]) {
    expectPattern(provenance[key], SHA256_PATTERN, `${provenancePath}.${key}`, issues);
  }
  expectEqual(
    provenance.startingSourceSha256,
    provenance.fixtureSha256,
    `${provenancePath}.startingSourceSha256`,
    issues
  );
  expectEqual(
    provenance.externalCommandSha256,
    sha256(canonicalJson(cell.commandDescriptor)),
    `${provenancePath}.externalCommandSha256`,
    issues
  );
  expectEqual(
    provenance.deliveryStanzaSha256,
    sha256(deliveryStanzaFor(cell)),
    `${provenancePath}.deliveryStanzaSha256`,
    issues
  );
  for (const key of [
    "agentPassCount",
    "auditSchemaVersion",
    "commonTaskSha256",
    "copyStyleSha256",
    "finalReauditCount",
    "fixtureSha256",
    "harnessBuildSha256",
    "harnessConfigSha256",
    "harnessVersion",
    "preservationOracleSha256",
    "protocolSha256",
    "scoreFormulaVersion"
  ]) {
    expectEqual(
      provenance[key],
      comparability?.[key],
      `${provenancePath}.${key}`,
      issues
    );
  }
  expectEqual(provenance.agentPassCount, 1, `${provenancePath}.agentPassCount`, issues);
  expectEqual(
    provenance.finalReauditCount,
    1,
    `${provenancePath}.finalReauditCount`,
    issues
  );
}

function validateAuditRecord(audit, cell, comparability, path, issues) {
  if (!isPlainObject(audit)) {
    issues.push(`${path} must be an object`);
    return;
  }
  exactKeys(
    audit,
    [
      "baselineFinishedAt",
      "baselineStartedAt",
      "baselineStatus",
      "finalFinishedAt",
      "finalStartedAt",
      "finalStatus"
    ],
    path,
    issues
  );
  expectOneOf(audit.baselineStatus, ["success", "partial"], `${path}.baselineStatus`, issues);
  expectOneOf(audit.finalStatus, ["success", "partial"], `${path}.finalStatus`, issues);
  if (audit.baselineStatus !== "success") {
    issues.push(`${path}.baselineStatus must be success for the pinned controlled fixture`);
  }
  if (audit.finalStatus !== "success") {
    issues.push(`${path}.finalStatus must be success for the pinned controlled fixture`);
  }
  for (const key of [
    "baselineStartedAt",
    "baselineFinishedAt",
    "finalStartedAt",
    "finalFinishedAt"
  ]) {
    expectIsoInstant(audit[key], `${path}.${key}`, issues);
  }
  if (Date.parse(audit.baselineFinishedAt) < Date.parse(audit.baselineStartedAt)) {
    issues.push(`${path}.baselineFinishedAt must not precede baselineStartedAt`);
  }
  if (Date.parse(audit.finalFinishedAt) < Date.parse(audit.finalStartedAt)) {
    issues.push(`${path}.finalFinishedAt must not precede finalStartedAt`);
  }
  const firstAttempt = cell.attempts?.[0];
  const acceptedAttempt = cell.attempts?.[cell.acceptedAttemptIndex - 1];
  if (
    firstAttempt &&
    Date.parse(firstAttempt.startedAt) < Date.parse(audit.baselineFinishedAt)
  ) {
    issues.push(`${path}.baselineFinishedAt must not follow executor start`);
  }
  if (
    acceptedAttempt &&
    Date.parse(audit.finalStartedAt) <= Date.parse(acceptedAttempt.endedAt)
  ) {
    issues.push(`${path}.finalStartedAt must be after the accepted executor ends`);
  }
  if (
    comparability?.auditSchemaVersion === undefined ||
    comparability?.scoreFormulaVersion === undefined
  ) {
    issues.push(`${path} cannot be compared without schema/formula provenance`);
  }
}

function validatePrimary(primary, path, issues) {
  if (!isPlainObject(primary)) {
    issues.push(`${path} must be an object`);
    return;
  }
  exactKeys(
    primary,
    [
      "closedDeterministicFailureCount",
      "closedDeterministicFailures",
      "closureRate",
      "deterministicClosure",
      "finalDeterministicFailureCount",
      "finalDeterministicFailures",
      "initialDeterministicFailureCount",
      "initialDeterministicFailures",
      "newlyIntroducedDeterministicFailureCount",
      "newlyIntroducedDeterministicFailures",
      "passedBoth",
      "preservation"
    ],
    path,
    issues
  );
  for (const key of [
    "initialDeterministicFailures",
    "finalDeterministicFailures",
    "closedDeterministicFailures",
    "newlyIntroducedDeterministicFailures"
  ]) {
    validateFailureList(primary[key], `${path}.${key}`, issues);
  }

  const expectedClosed = subtractFailureMultisets(
    primary.initialDeterministicFailures,
    primary.finalDeterministicFailures
  );
  const expectedNew = subtractFailureMultisets(
    primary.finalDeterministicFailures,
    primary.initialDeterministicFailures
  );
  expectDeepEqual(
    primary.closedDeterministicFailures,
    expectedClosed,
    `${path}.closedDeterministicFailures`,
    issues
  );
  expectDeepEqual(
    primary.newlyIntroducedDeterministicFailures,
    expectedNew,
    `${path}.newlyIntroducedDeterministicFailures`,
    issues
  );

  const counts = {
    initialDeterministicFailureCount: countFailures(
      primary.initialDeterministicFailures
    ),
    finalDeterministicFailureCount: countFailures(
      primary.finalDeterministicFailures
    ),
    closedDeterministicFailureCount: countFailures(expectedClosed),
    newlyIntroducedDeterministicFailureCount: countFailures(expectedNew)
  };
  for (const [key, value] of Object.entries(counts)) {
    expectEqual(primary[key], value, `${path}.${key}`, issues);
  }
  expectEqual(
    primary.closureRate,
    closureRate(
      counts.initialDeterministicFailureCount,
      counts.closedDeterministicFailureCount
    ),
    `${path}.closureRate`,
    issues
  );
  expectEqual(
    primary.deterministicClosure,
    counts.finalDeterministicFailureCount === 0,
    `${path}.deterministicClosure`,
    issues
  );

  if (!isPlainObject(primary.preservation)) {
    issues.push(`${path}.preservation must be an object`);
  } else {
    exactKeys(
      primary.preservation,
      ["metrics", "passed", "violations"],
      `${path}.preservation`,
      issues
    );
    if (typeof primary.preservation.passed !== "boolean") {
      issues.push(`${path}.preservation.passed must be boolean`);
    }
    if (!Array.isArray(primary.preservation.violations)) {
      issues.push(`${path}.preservation.violations must be an array`);
    }
    if (
      primary.preservation.metrics !== null &&
      !isPlainObject(primary.preservation.metrics)
    ) {
      issues.push(`${path}.preservation.metrics must be an object or null`);
    }
    if (
      primary.preservation.passed === true &&
      !isPlainObject(primary.preservation.metrics)
    ) {
      issues.push(`${path}.preservation.metrics is required for a passing verdict`);
    }
  }
  expectEqual(
    primary.passedBoth,
    primary.deterministicClosure === true &&
      primary.preservation?.passed === true,
    `${path}.passedBoth`,
    issues
  );
}

function validateFailureList(failures, path, issues) {
  if (!Array.isArray(failures)) {
    issues.push(`${path} must be an array`);
    return;
  }
  const seen = new Set();
  for (let index = 0; index < failures.length; index += 1) {
    const failure = failures[index];
    const failurePath = `${path}[${index}]`;
    if (!isPlainObject(failure)) {
      issues.push(`${failurePath} must be an object`);
      continue;
    }
    exactKeys(failure, FAILURE_FIELDS, failurePath, issues);
    for (const key of ["criterionId", "checkName", "viewport", "selector"]) {
      expectNonEmptyString(failure[key], `${failurePath}.${key}`, issues);
    }
    expectInteger(failure.count, 1, Number.MAX_SAFE_INTEGER, `${failurePath}.count`, issues);
    const key = failureKey(failure);
    if (seen.has(key)) {
      issues.push(`${failurePath} duplicates a failure identity`);
    }
    seen.add(key);
  }
  const sorted = [...failures].sort(compareFailures);
  if (canonicalJson(sorted) !== canonicalJson(failures)) {
    issues.push(`${path} must use canonical failure-identity order`);
  }
}

function validateSecondary(secondary, comparability, path, issues) {
  if (!isPlainObject(secondary)) {
    issues.push(`${path} must be an object`);
    return;
  }
  exactKeys(
    secondary,
    [
      "final",
      "initial",
      "measurementLabel"
    ],
    path,
    issues
  );
  expectEqual(
    secondary.measurementLabel,
    SCORE_MEASUREMENT_LABEL,
    `${path}.measurementLabel`,
    issues
  );
  validateSecondaryAudit(
    secondary.initial,
    comparability,
    `${path}.initial`,
    issues
  );
  validateSecondaryAudit(
    secondary.final,
    comparability,
    `${path}.final`,
    issues
  );
}

function validateSecondaryAudit(value, comparability, path, issues) {
  if (!isPlainObject(value)) {
    issues.push(`${path} must be an object`);
    return;
  }
  exactKeys(
    value,
    [
      "advisoryScore",
      "deterministicRiskCount",
      "heuristicFindingCount",
      "needsReviewCount"
    ],
    path,
    issues
  );
  for (const key of [
    "deterministicRiskCount",
    "heuristicFindingCount",
    "needsReviewCount"
  ]) {
    expectInteger(value[key], 0, Number.MAX_SAFE_INTEGER, `${path}.${key}`, issues);
  }
  const score = value.advisoryScore;
  if (!isPlainObject(score)) {
    issues.push(`${path}.advisoryScore must be an object`);
    return;
  }
  exactKeys(
    score,
    ["band", "formulaVersion", "max", "value"],
    `${path}.advisoryScore`,
    issues
  );
  expectEqual(
    score.formulaVersion,
    comparability?.scoreFormulaVersion,
    `${path}.advisoryScore.formulaVersion`,
    issues
  );
  if (
    typeof score.value !== "number" ||
    !Number.isFinite(score.value) ||
    score.value < 0
  ) {
    issues.push(`${path}.advisoryScore.value must be a non-negative finite number`);
  }
  if (
    typeof score.max !== "number" ||
    !Number.isFinite(score.max) ||
    score.max <= 0
  ) {
    issues.push(`${path}.advisoryScore.max must be a positive finite number`);
  }
  expectOneOf(
    score.band,
    ["strong", "usable", "needs-work", "blocked"],
    `${path}.advisoryScore.band`,
    issues
  );
}

function validateAggregate(aggregate, cells, issues) {
  const path = "$.aggregate";
  if (!isPlainObject(aggregate)) {
    issues.push(`${path} must be an object`);
    return;
  }
  const expected = recomputeAggregate(cells);
  exactKeys(aggregate, Object.keys(expected), path, issues);
  expectDeepEqual(aggregate, expected, path, issues);
}

function validateControlledBaselines(cells, issues) {
  const expected = [
    {
      criterionId: "a11y.language.page-lang",
      checkName: "page-lang-missing",
      viewport: "desktop",
      selector: "html",
      count: 1
    },
    {
      criterionId: "a11y.language.page-lang",
      checkName: "page-lang-missing",
      viewport: "mobile",
      selector: "html",
      count: 1
    },
    {
      criterionId: "content.placeholder.unrendered",
      checkName: "placeholder-leak",
      viewport: "desktop",
      selector: "main > section > div:nth-of-type(3) > p",
      count: 1
    },
    {
      criterionId: "content.placeholder.unrendered",
      checkName: "placeholder-leak",
      viewport: "mobile",
      selector: "main > section > div:nth-of-type(3) > p",
      count: 1
    }
  ].sort(compareFailures);
  let canonicalBaseline;
  for (let index = 0; index < cells.length; index += 1) {
    const failures = cells[index]?.primary?.initialDeterministicFailures;
    if (!Array.isArray(failures)) {
      continue;
    }
    if (canonicalJson(failures) !== canonicalJson(expected)) {
      issues.push(
        `$.cells[${index}].primary.initialDeterministicFailures must equal the exact four controlled identities`
      );
    }
    if (canonicalBaseline === undefined) {
      canonicalBaseline = canonicalJson(failures);
    } else if (canonicalJson(failures) !== canonicalBaseline) {
      issues.push(
        `$.cells[${index}].primary.initialDeterministicFailures drifts from the cross-cell baseline multiset`
      );
    }
  }
}

function validateLimitations(limitations, issues) {
  if (!Array.isArray(limitations)) {
    issues.push("$.limitations must be an array");
    return;
  }
  expectDeepEqual(limitations, LIMITATIONS, "$.limitations", issues);
}

function validateCompletion(
  results,
  cells,
  report,
  roadmap,
  requireCompletion,
  issues
) {
  const allOperationallyCompleted =
    cells.length === MATRIX.length &&
    cells.every((cell) => cell.terminalStatus === "completed");
  if (requireCompletion && !allOperationallyCompleted) {
    issues.push(
      "snapshot completion requires all twelve cells to be operationally completed; failed/unavailable cells must remain visible"
    );
  }
  for (const [label, source] of [
    ["public report", report],
    ["ROADMAP", roadmap]
  ]) {
    if (requireCompletion && !source.includes(COMPLETION_PHRASE)) {
      issues.push(`${label} omits exact completion phrase: ${COMPLETION_PHRASE}`);
    }
    if (!source.includes(BLOCKED_CLAIMS_STATEMENT)) {
      issues.push(
        `${label} omits exact repeated/two-case blocked-claims statement`
      );
    }
  }
  if (
    !Array.isArray(results?.cells) ||
    results.cells.some((cell) => cell?.terminalStatus === undefined)
  ) {
    issues.push("all cells must make terminal status visible");
  }
}

function validatePublicCopy(source, path, issues) {
  const forbidden = [
    [/\bproves?\s+(?:that\s+)?agents?\s+obey\b/i, "general obedience proof"],
    [/\b(?:best|superior)\s+(?:model|provider|executor|mechanism)\b/i, "ranking"],
    [/\bstatistically\s+significant\b/i, "statistical significance"],
    [/\b(?:causes?|caused)\s+(?:better|improved|higher)\b/i, "causal effect"],
    [/\bWCAG compliant\b/i, "WCAG compliance"],
    [/\b(?:is|are|was|were)\s+accessible\b/i, "unqualified accessibility"],
    [/\bobjectively\s+better\b/i, "objective superiority"],
    [/\bgood design\b/i, "unqualified design quality"]
  ];
  for (const [pattern, label] of forbidden) {
    if (pattern.test(source)) {
      issues.push(`${path} contains forbidden ${label} claim`);
    }
  }
  const reinsOccurrences = source.match(/“reins”/g)?.length ?? 0;
  const blockedOccurrences =
    source.split(BLOCKED_CLAIMS_STATEMENT).length - 1;
  if (reinsOccurrences !== blockedOccurrences) {
    issues.push(
      `${path} may mention “reins” only inside the exact blocked-claims statement`
    );
  }
}

function validateNoPrivateMaterial(value, path, issues) {
  if (typeof value === "string") {
    if (ABSOLUTE_PRIVATE_PATH_PATTERN.test(value)) {
      issues.push(`${path} contains an absolute home/temp path`);
    }
    for (const pattern of SECRET_VALUE_PATTERNS) {
      if (pattern.test(value)) {
        issues.push(`${path} contains credential-shaped material`);
        break;
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      validateNoPrivateMaterial(entry, `${path}[${index}]`, issues)
    );
    return;
  }
  if (!isPlainObject(value)) {
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_PUBLIC_KEYS.some((pattern) => pattern.test(key))) {
      issues.push(`${path}.${key} is forbidden in public output`);
    }
    validateNoPrivateMaterial(entry, `${path}.${key}`, issues);
  }
}

function commonInputHashes(commonInputs) {
  const hashSource = commonInputs.hashes;
  return {
    commonTaskSha256: hashSource.commonTaskSha256,
    copyStyleSha256: hashSource.copyStyleSha256,
    fixtureSha256: hashSource.fixtureSha256,
    preservationOracleSha256: hashSource.preservationOracleSha256,
    protocolSha256: hashSource.protocolSha256
  };
}

function matrixCoordinate(cell) {
  return [
    stringOrEmpty(cell?.executorFamily),
    stringOrEmpty(cell?.requestedModel ?? cell?.executor?.requestedModel),
    stringOrEmpty(cell?.mechanism)
  ].join("|");
}

function failureKey(failure) {
  return canonicalJson({
    criterionId: stringOrEmpty(failure?.criterionId),
    checkName: stringOrEmpty(failure?.checkName),
    viewport: stringOrEmpty(failure?.viewport),
    selector: stringOrEmpty(failure?.selector)
  });
}

function compareFailures(left, right) {
  const leftKey = failureKey(left);
  const rightKey = failureKey(right);
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function exactKeys(value, expectedKeys, path, issues) {
  if (!isPlainObject(value)) {
    return;
  }
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    issues.push(
      `${path} must contain exactly keys [${expected.join(", ")}], found [${actual.join(", ")}]`
    );
  }
}

function expectEqual(actual, expected, path, issues) {
  if (!Object.is(actual, expected)) {
    issues.push(
      `${path} must equal ${JSON.stringify(expected)}, found ${JSON.stringify(actual)}`
    );
  }
}

function expectDeepEqual(actual, expected, path, issues) {
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    issues.push(`${path} does not equal its recomputed value`);
  }
}

function expectNonEmptyString(value, path, issues) {
  if (typeof value !== "string" || value.trim() === "") {
    issues.push(`${path} must be a non-empty string`);
  }
}

function expectPattern(value, pattern, path, issues) {
  if (typeof value !== "string" || !pattern.test(value)) {
    issues.push(`${path} has invalid format`);
  }
}

function expectIsoInstant(value, path, issues) {
  if (typeof value !== "string" || !ISO_INSTANT_PATTERN.test(value)) {
    issues.push(`${path} has invalid UTC instant format`);
    return;
  }
  const parsed = new Date(value);
  const normalized = value.includes(".")
    ? value
    : value.replace(/Z$/, ".000Z");
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== normalized) {
    issues.push(`${path} must be a real UTC instant`);
  }
}

function expectUtcDate(value, path, issues) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) {
    issues.push(`${path} has invalid UTC date format`);
    return;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    issues.push(`${path} must be a real UTC calendar date`);
  }
}

function requiredFailureIdentity(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Deterministic failure ${field} must be a non-empty string`);
  }
  return value;
}

function expectOneOf(value, allowed, path, issues) {
  if (!allowed.includes(value)) {
    issues.push(`${path} must be one of ${allowed.join(", ")}`);
  }
}

function expectInteger(value, min, max, path, issues) {
  if (!Number.isInteger(value) || value < min || value > max) {
    issues.push(`${path} must be an integer from ${min} through ${max}`);
  }
}

function expectNullableInteger(value, min, max, path, issues) {
  if (value !== null) {
    expectInteger(value, min, max, path, issues);
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

function stringOrEmpty(value) {
  return typeof value === "string" ? value : "";
}

async function main() {
  const args = process.argv.slice(2);
  let root = BENCHMARK_ROOT;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--benchmark-root") {
      if (!args[index + 1]) {
        throw new Error("--benchmark-root requires a path");
      }
      root = resolve(args[index + 1]);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${args[index]}`);
  }
  const resultsPath = join(root, "results.json");
  const results = JSON.parse(await readFile(resultsPath, "utf8"));
  const summary = await validatePublicSnapshot({
    results,
    benchmarkRoot: root
  });
  console.log(
    `Validated obedience-v1 public snapshot: ${summary.cellCount} cells, ` +
      `${summary.completedCellCount} completed, ${summary.passedBothCount} closed-and-preserved.`
  );
}

const isMain =
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

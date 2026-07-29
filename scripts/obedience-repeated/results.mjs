import { lstat, readFile, readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

import { validatePreservation } from "../obedience-benchmark/preservation.mjs";
import {
  SCORE_MEASUREMENT_LABEL,
  closureRate,
  countFailures,
  subtractFailureMultisets,
  recomputeAggregate
} from "../obedience-benchmark/validate.mjs";
import {
  BENCHMARK_ID,
  BENCHMARK_ROOT,
  CASES,
  EXPECTED_EXECUTION_COUNT,
  MATRIX,
  REPEAT_COUNT,
  canonicalJson,
  readAllInputs,
  resolvedModelMatchesExecution,
  sha256
} from "./contract.mjs";

export const RESULTS_SCHEMA_VERSION =
  "obedience-repeated-v1/results/v1";
export const COMPLETION_PHRASE =
  "obedience-repeated-v1 descriptive snapshot complete";
export const LIMITATIONS = Object.freeze([
  "Two project-authored synthetic fixtures.",
  "Three process executions per case and coordinate; no inferential estimate.",
  "Snapshot-specific CLI and resolved model versions.",
  "Provider-specific project-instruction and skill discovery.",
  "Only defects detectable by the pinned Harness checks.",
  "Advisory score and band are formula-bound secondary measurements.",
  "No causal comparison or ranking among delivery mechanisms, executors, or models.",
  "No generalization to real applications, general agent obedience, design quality, accessibility, or standards compliance."
]);

const COMPLETE_ENTRIES = Object.freeze({
  cases: "directory",
  "common-task.md": "file",
  "copy-style.yaml": "file",
  "final-sources": "directory",
  "protocol.md": "file",
  "report.md": "file",
  "results.json": "file",
  "status.json": "file",
  "v1-preservation.json": "file"
});
const TERMINAL_STATUSES = new Set([
  "completed",
  "error",
  "timeout",
  "unavailable"
]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const PRIVATE_PATH_PATTERN =
  /(?:^|[\s"'=(])(?:\/Users\/[^/\s]+|\/home\/[^/\s]+|\/private\/(?:tmp|var)\/\S+|\/tmp\/\S+|[A-Za-z]:\\Users\\[^\\\s]+)/;
const SECRET_PATTERN =
  /(?:\bBearer\s+[A-Za-z0-9._~+/=-]{8,}|\b(?:sk|rk|pk)-[A-Za-z0-9_-]{12,}\b|\bgh[pousr]_[A-Za-z0-9]{12,}\b|\bxox[baprs]-[A-Za-z0-9-]{10,}\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/i;

export function recomputeRepeatedAggregate(executions) {
  const aggregate = recomputeAggregate(executions);
  const byCase = Object.fromEntries(
    CASES.map((benchmarkCase) => [
      benchmarkCase.id,
      recomputeAggregate(
        executions.filter(
          (execution) => execution.caseId === benchmarkCase.id
        )
      )
    ])
  );
  const coordinateIds = [
    ...new Set(MATRIX.map((execution) => execution.coordinateId))
  ];
  const variation = coordinateIds.map((coordinateId) => {
    const entries = executions.filter(
      (execution) => execution.coordinateId === coordinateId
    );
    return {
      coordinateId,
      executionCount: entries.length,
      completedCount: entries.filter(
        (entry) => entry.terminalStatus === "completed"
      ).length,
      passedBothCount: entries.filter(
        (entry) => entry.primary?.passedBoth === true
      ).length,
      terminalOutcomes: [
        ...new Set(
          entries.map((entry) => entry.terminalStatus)
        )
      ].sort(),
      passedBothOutcomes: [
        ...new Set(
          entries.map((entry) => entry.primary?.passedBoth === true)
        )
      ].sort(),
      finalFailureCountOutcomes: [
        ...new Set(
          entries.map(
            (entry) =>
              entry.primary?.finalDeterministicFailureCount
          )
        )
      ].sort((left, right) => left - right)
    };
  });
  return {
    ...aggregate,
    byCase,
    variation
  };
}

export function renderRepeatedReport(results) {
  const executions = Array.isArray(results?.executions)
    ? results.executions
    : [];
  const aggregate = results?.aggregate ?? {};
  const complete =
    executions.length === EXPECTED_EXECUTION_COUNT &&
    executions.every((entry) => TERMINAL_STATUSES.has(entry.terminalStatus));
  const lines = [
    "# Repeated two-case obedience descriptive snapshot",
    "",
    `> ${complete ? COMPLETION_PHRASE : "obedience-repeated-v1 descriptive snapshot incomplete"}`,
    "",
    "This is a bounded descriptive record of two project-authored synthetic cases,",
    "three repetitions, and twelve fixed executor/model/delivery coordinates.",
    "It does not establish causation, statistical significance, provider/model",
    "ranking, real-application generalization, general agent obedience, design",
    "quality, accessibility, standards compliance, or a “reins” claim.",
    "",
    "## Scope",
    "",
    `- Recorded at: ${display(results?.recordedAt)}`,
    `- Executions: ${display(aggregate.totalCellCount)} / ${EXPECTED_EXECUTION_COUNT}`,
    `- Operationally completed: ${display(aggregate.completedCellCount)} / ${EXPECTED_EXECUTION_COUNT}`,
    `- Cases: ${CASES.length}`,
    `- Repetitions per case and coordinate: ${REPEAT_COUNT}`,
    "",
    "## Aggregate observations",
    "",
    "| Measurement | Count |",
    "|---|---:|",
    `| Deterministic closure | ${display(aggregate.deterministicClosureCellCount)} |`,
    `| Preservation pass | ${display(aggregate.preservationPassCellCount)} |`,
    `| Closure and preservation | ${display(aggregate.passedBothCellCount)} |`,
    `| Cells with an allowed operational retry | ${display(aggregate.operationalRetryCellCount)} |`,
    `| Cells with new deterministic failures | ${display(aggregate.cellsWithNewFailures)} |`,
    `| Initial deterministic failures | ${display(aggregate.initialDeterministicFailureCount)} |`,
    `| Final deterministic failures | ${display(aggregate.finalDeterministicFailureCount)} |`,
    "",
    "Terminal outcomes stay in the matrix and denominator. An incomplete repair,",
    "new failure, or preservation miss is an observed result and is not rerun.",
    "",
    "## Per-case counts",
    "",
    "| Case | Executions | Completed | Closure + preservation | Final deterministic failures |",
    "|---|---:|---:|---:|---:|"
  ];
  for (const benchmarkCase of CASES) {
    const value = aggregate.byCase?.[benchmarkCase.id] ?? {};
    lines.push(
      `| \`${benchmarkCase.id}\` | ${display(value.totalCellCount)} | ${display(value.completedCellCount)} | ${display(value.passedBothCellCount)} | ${display(value.finalDeterministicFailureCount)} |`
    );
  }

  lines.push(
    "",
    "## Within-coordinate observed variation",
    "",
    "Each row contains six executions: two cases × three repetitions. Distinct",
    "outcomes are descriptive categories, not uncertainty estimates.",
    "",
    "| Coordinate | Completed | Closure + preservation | Terminal outcomes | Final failure-count outcomes |",
    "|---|---:|---:|---|---|"
  );
  for (const entry of aggregate.variation ?? []) {
    lines.push(
      `| \`${escapeTable(entry.coordinateId)}\` | ${display(entry.completedCount)} / ${display(entry.executionCount)} | ${display(entry.passedBothCount)} / ${display(entry.executionCount)} | ${escapeTable(entry.terminalOutcomes?.join(", "))} | ${escapeTable(entry.finalFailureCountOutcomes?.join(", "))} |`
    );
  }

  lines.push(
    "",
    "## Per-execution results",
    "",
    "| Execution | Case | Repeat | Executor and resolved model | Delivery | Terminal | Attempts | Failures | Preservation | Closure + preservation | Advisory score |",
    "|---|---|---:|---|---|---|---:|---:|---|---|---|"
  );
  for (const entry of executions) {
    lines.push(
      `| \`${escapeTable(entry.id)}\` | \`${escapeTable(entry.caseId)}\` | ${display(entry.repeat)} | ${escapeTable(entry.executorLabel)}; \`${escapeTable(entry.executor?.requestedModel)}\` → \`${escapeTable(entry.executor?.resolvedModel)}\` | \`${escapeTable(entry.mechanism)}\` | \`${escapeTable(entry.terminalStatus)}\` | ${display(entry.attempts?.length)} | ${display(entry.primary?.initialDeterministicFailureCount)} → ${display(entry.primary?.finalDeterministicFailureCount)} | ${entry.primary?.preservation?.passed ? "pass" : "fail"} | ${entry.primary?.passedBoth ? "yes" : "no"} | ${formatScore(entry.secondary?.initial?.advisoryScore)} → ${formatScore(entry.secondary?.final?.advisoryScore)} |`
    );
  }

  lines.push(
    "",
    `Advisory scores use the label \`${SCORE_MEASUREMENT_LABEL}\`; they are`,
    "formula-bound secondary measurements, not objective grades.",
    "",
    "## Limitations",
    ""
  );
  for (const limitation of results?.limitations ?? LIMITATIONS) {
    lines.push(`- ${limitation}`);
  }
  lines.push("");
  return lines.join("\n");
}

export async function validateCompleteSnapshot({
  benchmarkRoot = BENCHMARK_ROOT,
  results,
  reportSource
} = {}) {
  const root = resolve(benchmarkRoot);
  const issues = [];
  const inputs = await readAllInputs({ benchmarkRoot: root });
  const resolvedResults =
    results ?? await readJson(join(root, "results.json"), issues, "results");
  const report =
    reportSource ?? await readText(join(root, "report.md"), issues, "report");

  await validateTree(root, issues);
  await validateV1Preservation(root, issues);
  validateNoPrivateMaterial(resolvedResults, "$", issues);
  validateTopLevel(resolvedResults, issues);
  validateComparability(resolvedResults?.comparability, inputs, issues);
  const executions = Array.isArray(resolvedResults?.executions)
    ? resolvedResults.executions
    : [];
  await validateExecutions(
    executions,
    root,
    inputs,
    resolvedResults?.comparability,
    resolvedResults?.recordedAt,
    issues
  );
  validateAggregate(resolvedResults?.aggregate, executions, issues);
  if (canonicalJson(resolvedResults?.limitations) !== canonicalJson(LIMITATIONS)) {
    issues.push("limitations must match the fixed repeated-v1 limitations");
  }
  const expectedReport = renderRepeatedReport(resolvedResults);
  if (report !== expectedReport) {
    issues.push("report.md does not match deterministic rendering");
  }
  validatePublicCopy(report, issues);
  const status = await readJson(join(root, "status.json"), issues, "status");
  validateCompleteStatus(status, issues);
  if (issues.length > 0) {
    throw new Error(
      `obedience-repeated-v1 complete validation failed with ${issues.length} issue${issues.length === 1 ? "" : "s"}:\n${issues.map((issue) => `- ${issue}`).join("\n")}`
    );
  }
  return {
    executionCount: executions.length,
    completedCount: executions.filter(
      (entry) => entry.terminalStatus === "completed"
    ).length,
    passedBothCount: executions.filter(
      (entry) => entry.primary?.passedBoth === true
    ).length
  };
}

async function validateTree(root, issues) {
  let entries;
  try {
    const info = await lstat(root);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      issues.push("complete public root must be a real directory");
      return;
    }
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    issues.push(`cannot inspect complete public root: ${error.message}`);
    return;
  }
  const names = new Set(entries.map((entry) => entry.name));
  for (const entry of entries) {
    if (!Object.hasOwn(COMPLETE_ENTRIES, entry.name)) {
      issues.push(`complete public root contains unexpected ${entry.name}`);
    }
  }
  for (const [name, type] of Object.entries(COMPLETE_ENTRIES)) {
    if (!names.has(name)) {
      issues.push(`complete public root is missing ${name}`);
      continue;
    }
    const info = await lstat(join(root, name));
    const valid =
      !info.isSymbolicLink() &&
      (type === "file" ? info.isFile() : info.isDirectory());
    if (!valid) {
      issues.push(`${name} must be a regular ${type}`);
    }
  }
  try {
    const caseEntries = await readdir(join(root, "cases"), {
      withFileTypes: true
    });
    if (
      caseEntries.length !== 1 ||
      caseEntries[0].name !== "support-triage" ||
      !caseEntries[0].isDirectory() ||
      caseEntries[0].isSymbolicLink()
    ) {
      issues.push(
        "cases must contain only the real support-triage directory"
      );
    } else {
      const supportEntries = await readdir(
        join(root, "cases", "support-triage"),
        { withFileTypes: true }
      );
      const expectedSupport = new Set([
        "fixture.html",
        "preservation-oracle.json"
      ]);
      if (
        supportEntries.length !== expectedSupport.size ||
        supportEntries.some(
          (entry) =>
            !expectedSupport.has(entry.name) ||
            !entry.isFile() ||
            entry.isSymbolicLink()
        )
      ) {
        issues.push(
          "support-triage must contain only regular fixture.html and preservation-oracle.json files"
        );
      }
    }
  } catch (error) {
    issues.push(`cannot inspect complete case tree: ${error.message}`);
  }
  try {
    const finalEntries = await readdir(join(root, "final-sources"), {
      withFileTypes: true
    });
    const expected = new Set(MATRIX.map((entry) => `${entry.id}.html`));
    if (
      finalEntries.length !== expected.size ||
      finalEntries.some(
        (entry) =>
          !expected.has(entry.name) ||
          !entry.isFile() ||
          entry.isSymbolicLink()
      )
    ) {
      issues.push("final-sources must contain exactly 72 regular execution HTML files");
    }
  } catch (error) {
    issues.push(`cannot inspect final-sources: ${error.message}`);
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
  const v1Root = resolve(root, "../obedience-v1");
  let files;
  try {
    files = await regularFilesRecursively(v1Root);
  } catch (error) {
    issues.push(`cannot inspect obedience-v1: ${error.message}`);
    return;
  }
  const relativeFiles = files.map((path) =>
    relative(v1Root, path).split(sep).join("/")
  );
  if (
    oracle.schemaVersion !==
      "obedience-repeated-v1/v1-preservation/v1" ||
    oracle.root !== "../obedience-v1" ||
    oracle.fileCount !== relativeFiles.length ||
    Object.keys(oracle.files).length !== relativeFiles.length
  ) {
    issues.push("v1-preservation.json identity or file count drifted");
  }
  for (const name of relativeFiles) {
    if (
      oracle.files[name] !==
      sha256(await readFile(join(v1Root, name)))
    ) {
      issues.push(`obedience-v1 byte drift: ${name}`);
    }
  }
}

async function regularFilesRecursively(root) {
  const output = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      output.push(...await regularFilesRecursively(path));
    } else if (entry.isFile() && !entry.isSymbolicLink()) {
      output.push(path);
    } else {
      throw new Error(`unsupported entry: ${path}`);
    }
  }
  return output.sort();
}

function validateTopLevel(results, issues) {
  if (!isPlainObject(results)) {
    issues.push("results.json must be an object");
    return;
  }
  exactKeys(
    results,
    [
      "aggregate",
      "benchmarkId",
      "comparability",
      "executions",
      "limitations",
      "recordedAt",
      "schemaVersion",
      "snapshotDate"
    ],
    "results.json",
    issues
  );
  if (
    results.schemaVersion !== RESULTS_SCHEMA_VERSION ||
    results.benchmarkId !== BENCHMARK_ID
  ) {
    issues.push("results.json identity is invalid");
  }
  if (!Number.isFinite(Date.parse(results.recordedAt))) {
    issues.push("results.json recordedAt must be an ISO instant");
  }
  if (
    typeof results.snapshotDate !== "string" ||
    results.snapshotDate !== results.recordedAt?.slice(0, 10)
  ) {
    issues.push("snapshotDate must be the UTC date of recordedAt");
  }
}

async function validateExecutions(
  executions,
  root,
  inputs,
  comparability,
  recordedAt,
  issues
) {
  if (executions.length !== EXPECTED_EXECUTION_COUNT) {
    issues.push(`results must contain exactly ${EXPECTED_EXECUTION_COUNT} executions`);
  }
  const expectedById = new Map(MATRIX.map((entry) => [entry.id, entry]));
  const ids = new Set();
  for (const entry of executions) {
    const expected = expectedById.get(entry?.id);
    if (!expected) {
      issues.push(`unknown execution id ${String(entry?.id)}`);
      continue;
    }
    if (ids.has(entry.id)) {
      issues.push(`duplicate execution id ${entry.id}`);
      continue;
    }
    ids.add(entry.id);
    exactKeys(
      entry,
      [
        "acceptedAttemptIndex",
        "attempts",
        "audit",
        "caseId",
        "caseLabel",
        "commandDescriptor",
        "coordinateId",
        "editBoundary",
        "effort",
        "effortSupport",
        "executor",
        "executorFamily",
        "executorLabel",
        "finalSourcePath",
        "id",
        "mechanism",
        "primary",
        "provenance",
        "repeat",
        "requestedModel",
        "secondary",
        "terminalStatus"
      ],
      `${entry.id} execution`,
      issues
    );
    for (const key of [
      "caseId",
      "caseLabel",
      "repeat",
      "coordinateId",
      "executorFamily",
      "executorLabel",
      "requestedModel",
      "effort",
      "effortSupport",
      "mechanism"
    ]) {
      if (entry[key] !== expected[key]) {
        issues.push(`${entry.id} ${key} drifted from the matrix`);
      }
    }
    if (!TERMINAL_STATUSES.has(entry.terminalStatus)) {
      issues.push(`${entry.id} terminalStatus is invalid`);
    }
    if (
      entry.terminalStatus === "completed" &&
      !resolvedModelMatchesExecution(expected, entry.executor?.resolvedModel)
    ) {
      issues.push(`${entry.id} resolved model does not match the request`);
    }
    validateExecutor(entry, expected, issues);
    validateCommandDescriptor(entry, expected, issues);
    validateEditBoundary(entry, issues);
    validateAttempts(entry, issues);
    validateAuditRecord(entry, recordedAt, issues);
    const caseInputs = inputs.cases.get(entry.caseId);
    const finalPath = join(root, entry.finalSourcePath ?? "");
    let finalSource;
    try {
      if (
        entry.finalSourcePath !== `final-sources/${entry.id}.html`
      ) {
        issues.push(`${entry.id} finalSourcePath is invalid`);
      }
      finalSource = await readFile(finalPath, "utf8");
      if (
        entry.provenance?.finalSourceSha256 !== sha256(finalSource)
      ) {
        issues.push(`${entry.id} final source hash drifted`);
      }
    } catch (error) {
      issues.push(`${entry.id} final source cannot be read: ${error.message}`);
      continue;
    }
    const preservation = validatePreservation({
      source: finalSource,
      baselineSource: caseInputs.fixture.toString("utf8"),
      oracle: caseInputs.preservationOracle,
      label: entry.id
    });
    if (
      canonicalJson(entry.primary?.preservation) !==
      canonicalJson({
        passed: preservation.ok,
        violations: preservation.violations,
        metrics: preservation.metrics
      })
    ) {
      issues.push(`${entry.id} preservation result does not replay`);
    }
    if (
      entry.primary?.passedBoth !==
      (
        entry.primary?.finalDeterministicFailureCount === 0 &&
        preservation.ok
      )
    ) {
      issues.push(`${entry.id} passedBoth does not replay`);
    }
    validatePrimary(entry, issues);
    validateSecondary(entry, issues);
    validateProvenance(
      entry,
      caseInputs,
      inputs,
      comparability,
      issues
    );
    for (const [key, hash] of Object.entries(entry.provenance ?? {})) {
      if (
        key.endsWith("Sha256") &&
        typeof hash === "string" &&
        !SHA256_PATTERN.test(hash)
      ) {
        issues.push(`${entry.id} ${key} is not a valid SHA-256 value`);
      }
    }
  }
  for (const expected of MATRIX) {
    if (!ids.has(expected.id)) {
      issues.push(`missing execution id ${expected.id}`);
    }
  }
}

function validateExecutor(entry, expected, issues) {
  const executor = entry.executor ?? {};
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
    `${entry.id} executor`,
    issues
  );
  const expectedBinary =
    expected.executorFamily === "claude-code" ? "claude" : "codex";
  if (
    executor.binaryName !== expectedBinary ||
    executor.requestedModel !== expected.requestedModel ||
    executor.effort !== (expected.effort ?? "provider-default") ||
    typeof executor.cliVersion !== "string" ||
    executor.cliVersion.trim() === "" ||
    executor.versionSource !== "operator-probed-cli"
  ) {
    issues.push(`${entry.id} executor descriptor drifted`);
  }
}

function validateCommandDescriptor(entry, expected, issues) {
  const command = entry.commandDescriptor ?? {};
  exactKeys(
    command,
    [
      "deliveryMechanism",
      "effort",
      "executable",
      "invocationMode",
      "promptInputMode",
      "requestedModel"
    ],
    `${entry.id} commandDescriptor`,
    issues
  );
  const executable =
    expected.executorFamily === "claude-code" ? "claude" : "codex";
  if (
    command.deliveryMechanism !== expected.mechanism ||
    command.effort !== (expected.effort ?? "provider-default") ||
    command.executable !== executable ||
    command.promptInputMode !==
      "common-task-then-delivery-stanza" ||
    command.requestedModel !== expected.requestedModel ||
    typeof command.invocationMode !== "string" ||
    command.invocationMode.trim() === ""
  ) {
    issues.push(`${entry.id} command descriptor drifted`);
  }
}

function validateEditBoundary(entry, issues) {
  const boundary = entry.editBoundary ?? {};
  exactKeys(
    boundary,
    ["modifiedPaths", "passed"],
    `${entry.id} editBoundary`,
    issues
  );
  if (
    boundary.passed !== true ||
    canonicalJson(boundary.modifiedPaths) !==
      canonicalJson(
        boundary.modifiedPaths?.length === 0
          ? []
          : ["fixture.html"]
      )
  ) {
    issues.push(`${entry.id} edit boundary is invalid`);
  }
}

function validateAttempts(entry, issues) {
  const attempts = Array.isArray(entry.attempts) ? entry.attempts : [];
  if (attempts.length < 1 || attempts.length > 2) {
    issues.push(`${entry.id} must contain one or two attempts`);
    return;
  }
  if (entry.acceptedAttemptIndex !== attempts.length) {
    issues.push(`${entry.id} acceptedAttemptIndex must select the final attempt`);
  }
  if (
    attempts.at(-1)?.status !== entry.terminalStatus
  ) {
    issues.push(`${entry.id} terminal status must match the accepted attempt`);
  }
  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = attempts[index];
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
      `${entry.id} attempt ${index + 1}`,
      issues
    );
    if (
      attempt.index !== index + 1 ||
      !TERMINAL_STATUSES.has(attempt.status) ||
      !Number.isFinite(Date.parse(attempt.startedAt)) ||
      !Number.isFinite(Date.parse(attempt.endedAt)) ||
      Date.parse(attempt.endedAt) < Date.parse(attempt.startedAt) ||
      !Number.isFinite(attempt.wallTimeMs) ||
      attempt.wallTimeMs < 0 ||
      !SHA256_PATTERN.test(attempt.privateTranscriptSha256 ?? "")
    ) {
      issues.push(`${entry.id} attempt ${index + 1} is invalid`);
    }
    validateUsage(
      attempt.usage,
      `${entry.id} attempt ${index + 1} usage`,
      issues
    );
  }
  if (attempts.length === 2) {
    const first = attempts[0];
    if (
      !["error", "unavailable"].includes(first.status) ||
      !["authentication", "transient-tool"].includes(
        first.operationalFailureKind
      ) ||
      !["authentication", "transient-tool"].includes(
        attempts[1].retryReason
      )
    ) {
      issues.push(`${entry.id} retry violates the pre-result operational-only policy`);
    }
  }
}

function validateAuditRecord(entry, recordedAt, issues) {
  const audit = entry.audit ?? {};
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
    `${entry.id} audit`,
    issues
  );
  const firstAttempt = entry.attempts?.[0];
  const accepted =
    entry.attempts?.[entry.acceptedAttemptIndex - 1];
  const instants = [
    audit.baselineStartedAt,
    audit.baselineFinishedAt,
    audit.finalStartedAt,
    audit.finalFinishedAt
  ];
  if (
    audit.baselineStatus !== "success" ||
    audit.finalStatus !== "success" ||
    instants.some((value) => !Number.isFinite(Date.parse(value))) ||
    Date.parse(audit.baselineFinishedAt) <
      Date.parse(audit.baselineStartedAt) ||
    Date.parse(firstAttempt?.startedAt) <
      Date.parse(audit.baselineFinishedAt) ||
    Date.parse(audit.finalStartedAt) <=
      Date.parse(accepted?.endedAt) ||
    Date.parse(audit.finalFinishedAt) <
      Date.parse(audit.finalStartedAt) ||
    Date.parse(recordedAt) <
      Date.parse(audit.finalFinishedAt)
  ) {
    issues.push(`${entry.id} audit/executor ordering is invalid`);
  }
}

function validateUsage(usage, label, issues) {
  if (usage === null) {
    return;
  }
  if (!isPlainObject(usage)) {
    issues.push(`${label} must be null or an object`);
    return;
  }
  const allowed = new Set([
    "cachedInputTokens",
    "costUsd",
    "inputTokens",
    "outputTokens",
    "totalTokens"
  ]);
  for (const [key, value] of Object.entries(usage)) {
    if (
      !allowed.has(key) ||
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < 0
    ) {
      issues.push(`${label}.${key} is invalid`);
    }
  }
}

function validatePrimary(entry, issues) {
  const primary = entry.primary ?? {};
  const initial = primary.initialDeterministicFailures ?? [];
  const final = primary.finalDeterministicFailures ?? [];
  const closed = subtractFailureMultisets(initial, final);
  const introduced = subtractFailureMultisets(final, initial);
  const initialCount = countFailures(initial);
  const finalCount = countFailures(final);
  const closedCount = countFailures(closed);
  const introducedCount = countFailures(introduced);
  const expected = {
    initialDeterministicFailures: initial,
    finalDeterministicFailures: final,
    closedDeterministicFailures: closed,
    newlyIntroducedDeterministicFailures: introduced,
    initialDeterministicFailureCount: initialCount,
    finalDeterministicFailureCount: finalCount,
    closedDeterministicFailureCount: closedCount,
    newlyIntroducedDeterministicFailureCount: introducedCount,
    closureRate: closureRate(initialCount, closedCount),
    deterministicClosure: finalCount === 0,
    preservation: primary.preservation,
    passedBoth:
      finalCount === 0 && primary.preservation?.passed === true
  };
  for (const [label, failures] of [
    ["initial", initial],
    ["final", final],
    ["closed", closed],
    ["introduced", introduced]
  ]) {
    for (const [index, failure] of failures.entries()) {
      exactKeys(
        failure,
        [
          "checkName",
          "count",
          "criterionId",
          "selector",
          "viewport"
        ],
        `${entry.id} ${label} failure ${index + 1}`,
        issues
      );
    }
  }
  if (canonicalJson(primary) !== canonicalJson(expected)) {
    issues.push(`${entry.id} primary measurements do not replay`);
  }
  if (
    entry.secondary?.measurementLabel !== SCORE_MEASUREMENT_LABEL
  ) {
    issues.push(`${entry.id} secondary measurement label drifted`);
  }
}

function validateSecondary(entry, issues) {
  const secondary = entry.secondary ?? {};
  exactKeys(
    secondary,
    ["final", "initial", "measurementLabel"],
    `${entry.id} secondary`,
    issues
  );
  for (const stage of ["initial", "final"]) {
    const value = secondary[stage] ?? {};
    exactKeys(
      value,
      [
        "advisoryScore",
        "deterministicRiskCount",
        "heuristicFindingCount",
        "needsReviewCount"
      ],
      `${entry.id} secondary.${stage}`,
      issues
    );
    exactKeys(
      value.advisoryScore ?? {},
      ["band", "formulaVersion", "max", "value"],
      `${entry.id} secondary.${stage}.advisoryScore`,
      issues
    );
    for (const key of [
      "deterministicRiskCount",
      "heuristicFindingCount",
      "needsReviewCount"
    ]) {
      if (!Number.isInteger(value[key]) || value[key] < 0) {
        issues.push(`${entry.id} secondary.${stage}.${key} is invalid`);
      }
    }
  }
}

function validateProvenance(
  entry,
  caseInputs,
  inputs,
  comparability,
  issues
) {
  const provenance = entry.provenance ?? {};
  exactKeys(
    provenance,
    [
      "agentPassCount",
      "auditRuntimeConfigSha256",
      "auditSchemaVersion",
      "commonTaskSha256",
      "copyStyleSha256",
      "deliveryMaterialSha256",
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
      "sharedRulesSha256",
      "sourceCommit",
      "startingSourceSha256"
    ],
    `${entry.id} provenance`,
    issues
  );
  for (const [key, value] of Object.entries({
    commonTaskSha256: inputs.shared.hashes.commonTaskSha256,
    copyStyleSha256: inputs.shared.hashes.copyStyleSha256,
    protocolSha256: inputs.shared.hashes.protocolSha256,
    fixtureSha256: caseInputs.hashes.fixtureSha256,
    preservationOracleSha256:
      caseInputs.hashes.preservationOracleSha256,
    startingSourceSha256: caseInputs.hashes.fixtureSha256
  })) {
    if (provenance[key] !== value) {
      issues.push(`${entry.id} ${key} drifted from public inputs`);
    }
  }
  for (const key of [
    "sourceCommit",
    "harnessBuildSha256",
    "auditRuntimeConfigSha256",
    "auditSchemaVersion",
    "harnessVersion",
    "scoreFormulaVersion"
  ]) {
    if (provenance[key] !== comparability?.[key]) {
      issues.push(`${entry.id} ${key} drifted from comparability`);
    }
  }
  if (
    provenance.agentPassCount !== 1 ||
    provenance.finalReauditCount !== 1 ||
    provenance.privateTranscriptSha256 !==
      entry.attempts?.[entry.acceptedAttemptIndex - 1]
        ?.privateTranscriptSha256
  ) {
    issues.push(`${entry.id} execution-count provenance is invalid`);
  }
}

function validateComparability(comparability, inputs, issues) {
  if (!isPlainObject(comparability)) {
    issues.push("comparability must be an object");
    return;
  }
  exactKeys(
    comparability,
    [
      "agentPassCount",
      "auditRuntimeConfigSha256",
      "auditSchemaVersion",
      "caseInputHashes",
      "finalReauditCount",
      "harnessBuildSha256",
      "harnessVersion",
      "scoreFormulaVersion",
      "sharedInputHashes",
      "sourceCommit"
    ],
    "comparability",
    issues
  );
  if (
    canonicalJson(comparability.sharedInputHashes) !==
    canonicalJson(inputs.shared.hashes)
  ) {
    issues.push("comparability shared input hashes drifted");
  }
  const caseHashes = Object.fromEntries(
    [...inputs.cases].map(([id, value]) => [id, value.hashes])
  );
  if (
    canonicalJson(comparability.caseInputHashes) !==
    canonicalJson(caseHashes)
  ) {
    issues.push("comparability case input hashes drifted");
  }
  for (const key of [
    "harnessBuildSha256",
    "auditRuntimeConfigSha256"
  ]) {
    if (!SHA256_PATTERN.test(comparability[key] ?? "")) {
      issues.push(`comparability ${key} is invalid`);
    }
  }
  if (
    !/^[a-f0-9]{40}$/.test(comparability.sourceCommit ?? "") ||
    comparability.agentPassCount !== 1 ||
    comparability.finalReauditCount !== 1
  ) {
    issues.push("comparability source/execution provenance is invalid");
  }
}

function validateAggregate(aggregate, executions, issues) {
  const expected = recomputeRepeatedAggregate(executions);
  if (canonicalJson(aggregate) !== canonicalJson(expected)) {
    issues.push("aggregate does not match the recomputed execution records");
  }
}

function validateCompleteStatus(status, issues) {
  const expected = {
    schemaVersion: "obedience-repeated-v1/status/v1",
    benchmarkId: BENCHMARK_ID,
    status: "complete",
    caseCount: CASES.length,
    repeatCount: REPEAT_COUNT,
    coordinateCount: 12,
    executionCount: EXPECTED_EXECUTION_COUNT,
    providerExecution: "recorded",
    publicResults: "present",
    claimBoundary: "bounded-descriptive-snapshot-only"
  };
  if (canonicalJson(status) !== canonicalJson(expected)) {
    issues.push("status.json does not match the complete snapshot contract");
  }
}

function validateNoPrivateMaterial(value, path, issues) {
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    issues.push(`${path} is not JSON serializable`);
    return;
  }
  if (PRIVATE_PATH_PATTERN.test(serialized)) {
    issues.push(`${path} contains an absolute private path`);
  }
  if (SECRET_PATTERN.test(serialized)) {
    issues.push(`${path} contains credential-shaped material`);
  }
  walk(value, path, (key, childPath) => {
    if (
      /^(?:argv|args|rawCommand|commandLine|shellCommand|env|environment|credentials?|authorization|apiKey|accessToken|refreshToken|secret|rawTranscript|transcript|transcriptPath|workspacePath)$/i.test(
        key
      )
    ) {
      issues.push(`${childPath} is a forbidden public field`);
    }
  });
}

function walk(value, path, visit) {
  if (!value || typeof value !== "object") {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    visit(key, childPath);
    walk(child, childPath, visit);
  }
}

export function validatePublicCopy(source, issues) {
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
      issues.push(`public report contains forbidden ${label} claim`);
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

async function readText(path, issues, label) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    issues.push(`cannot read ${label}: ${error.message}`);
    return "";
  }
}

function exactKeys(value, expected, label, issues) {
  const actual = Object.keys(value ?? {}).sort();
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

function display(value) {
  return value === undefined || value === null ? "n/a" : String(value);
}

function escapeTable(value) {
  return display(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function formatScore(score) {
  if (!score || typeof score !== "object") {
    return "n/a";
  }
  return `${display(score.value)}/${display(score.max)} (${escapeTable(score.band)})`;
}

#!/usr/bin/env node

import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  BENCHMARK_ROOT,
  INPUT_PATHS,
  MATRIX,
  REPO_ROOT,
  canonicalJson,
  deliveryStanzaFor,
  expectedDeliveryForCell,
  isPathInside,
  readCommonInputs,
  resolvedModelMatches,
  sha256
} from "./contract.mjs";
import { validatePreservation } from "./preservation.mjs";
import {
  LIMITATIONS,
  renderReport
} from "./render.mjs";
import {
  RESULTS_SCHEMA_VERSION,
  SCORE_MEASUREMENT_LABEL,
  auditSecondaryMetrics,
  closureRate,
  countFailures,
  failureIdentityCounts,
  recomputeAggregate,
  subtractFailureMultisets,
  validatePublicSnapshot
} from "./validate.mjs";

const PREPARATION_SCHEMA_VERSION = "obedience-v1/preparation/v1";
const REQUEST_SCHEMA_VERSION = "obedience-v1/request-metadata/v1";
const EVIDENCE_SCHEMA_VERSION = "obedience-v1/operator-evidence/v1";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ISO_INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const SAFE_SLUG_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;
const SAFE_COMMAND_KEYS = [
  "deliveryMechanism",
  "effort",
  "executable",
  "invocationMode",
  "promptInputMode",
  "requestedModel"
];
const SAFE_EXECUTOR_KEYS = [
  "binaryName",
  "cliVersion",
  "effort",
  "requestedModel",
  "resolvedModel",
  "versionSource"
];
const SAFE_ATTEMPT_KEYS = [
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
];
const TERMINAL_STATUSES = new Set([
  "completed",
  "error",
  "timeout",
  "unavailable"
]);
const OPERATIONAL_FAILURE_KINDS = new Set([
  "authentication",
  "transient-tool"
]);
const SAFE_USAGE_KEYS = new Set([
  "cachedInputTokens",
  "costUsd",
  "inputTokens",
  "outputTokens",
  "totalTokens"
]);
const PRIVATE_PATH_PATTERN =
  /(?:^|[\s"'=(])(?:\/Users\/[^/\s]+|\/home\/[^/\s]+|\/private\/(?:tmp|var)\/\S+|\/tmp\/\S+|[A-Za-z]:\\Users\\[^\\\s]+)/;
const SECRET_PATTERN =
  /(?:\bBearer\s+[A-Za-z0-9._~+/=-]{8,}|\b(?:sk|rk|pk)-[A-Za-z0-9_-]{12,}\b|\bgh[pousr]_[A-Za-z0-9]{12,}\b|\bxox[baprs]-[A-Za-z0-9-]{10,}\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/i;

export async function importBenchmark({
  workspace,
  evidencePath,
  publicRoot = BENCHMARK_ROOT
}) {
  if (!workspace || !evidencePath) {
    throw new Error("workspace and evidencePath are required");
  }

  const workspaceRoot = await realpath(resolve(workspace));
  const repositoryRoot = await realpath(REPO_ROOT);
  if (
    workspaceRoot === repositoryRoot ||
    isPathInside(repositoryRoot, workspaceRoot) ||
    isPathInside(workspaceRoot, repositoryRoot)
  ) {
    throw new Error(
      "Prepared benchmark workspace must be outside and must not contain the source repository"
    );
  }

  const [manifest, evidence, commonInputs] = await Promise.all([
    readJson(join(workspaceRoot, "preparation-manifest.json")),
    readJson(resolve(evidencePath)),
    readCommonInputs()
  ]);
  validatePreparationManifest(manifest, commonInputs);
  validateOperatorEvidence(evidence);
  const harnessBuildSha256 = await computeHarnessBuildSha256();

  const publicCells = [];
  let commonAuditProvenance;
  let commonInitialFailures;
  const stagedSources = new Map();

  for (const expected of MATRIX) {
    const cellRoot = join(workspaceRoot, "cells", expected.id);
    const [request, baselineAudit, finalAudit, finalSource] = await Promise.all([
      readJson(join(cellRoot, "request-metadata.json")),
      readJson(join(cellRoot, "runs", "baseline", "audit.json")),
      readJson(join(cellRoot, "runs", "final", "audit.json")),
      readFile(join(cellRoot, "fixture.html"), "utf8")
    ]);
    await assertAuditArtifacts(cellRoot);
    await validatePreparedDelivery(cellRoot, expected, commonInputs, {
      allowAuditArtifacts: true,
      request
    });
    validateAudit(baselineAudit, `${expected.id} baseline`);
    validateAudit(finalAudit, `${expected.id} final`);
    validateAuditPair(baselineAudit, finalAudit, expected.id);

    const auditProvenance = provenanceFromAudit(
      baselineAudit,
      commonInputs.hashes.copyStyleSha256,
      harnessBuildSha256
    );
    if (commonAuditProvenance === undefined) {
      commonAuditProvenance = auditProvenance;
    } else if (canonicalJson(commonAuditProvenance) !== canonicalJson(auditProvenance)) {
      throw new Error(`${expected.id} audit build/config provenance drifted`);
    }

    const initialFailures = failureIdentityCounts(baselineAudit.findings);
    assertControlledBaseline(initialFailures, expected.id);
    if (commonInitialFailures === undefined) {
      commonInitialFailures = initialFailures;
    } else if (canonicalJson(commonInitialFailures) !== canonicalJson(initialFailures)) {
      throw new Error(`${expected.id} baseline deterministic failures drifted`);
    }

    const finalFailures = failureIdentityCounts(finalAudit.findings);
    const closedFailures = subtractFailureMultisets(
      initialFailures,
      finalFailures
    );
    const newFailures = subtractFailureMultisets(
      finalFailures,
      initialFailures
    );
    const initialCount = countFailures(initialFailures);
    const finalCount = countFailures(finalFailures);
    const closedCount = countFailures(closedFailures);
    const newCount = countFailures(newFailures);
    const preservation = validatePreservation({
      source: finalSource,
      oracle: commonInputs.preservationOracle,
      label: expected.id
    });

    const operatorCell = evidence.cells[expected.id];
    const acceptedAttempt =
      operatorCell.attempts[operatorCell.acceptedAttemptIndex - 1];
    validateExecutionOrder(
      baselineAudit,
      finalAudit,
      operatorCell,
      expected.id
    );
    if (
      Date.parse(evidence.recordedAt) <
      Date.parse(finalAudit.timings.finishedAt)
    ) {
      throw new Error(
        `${expected.id} operator evidence recordedAt precedes final audit completion`
      );
    }
    const commandDescriptor = normalizeCommandDescriptor(
      operatorCell.commandDescriptor
    );
    const executor = normalizeExecutor(operatorCell.executor);
    const provenance = {
      commonTaskSha256: commonInputs.hashes.commonTaskSha256,
      fixtureSha256: commonInputs.hashes.fixtureSha256,
      copyStyleSha256: commonInputs.hashes.copyStyleSha256,
      deliveryStanzaSha256: request.inputHashes.deliveryStanzaSha256,
      preservationOracleSha256:
        commonInputs.hashes.preservationOracleSha256,
      protocolSha256: commonInputs.hashes.protocolSha256,
      harnessBuildSha256: auditProvenance.harnessBuildSha256,
      harnessConfigSha256: auditProvenance.harnessConfigSha256,
      externalCommandSha256: sha256(canonicalJson(commandDescriptor)),
      startingSourceSha256: commonInputs.hashes.fixtureSha256,
      finalSourceSha256: sha256(finalSource),
      privateTranscriptSha256: acceptedAttempt.privateTranscriptSha256,
      auditSchemaVersion: auditProvenance.auditSchemaVersion,
      harnessVersion: auditProvenance.harnessVersion,
      scoreFormulaVersion: auditProvenance.scoreFormulaVersion,
      agentPassCount: 1,
      finalReauditCount: 1
    };
    const publicAttempts = operatorCell.attempts.map(normalizeAttempt);

    publicCells.push({
      id: expected.id,
      executorFamily: expected.executorFamily,
      executorLabel: expected.executorLabel,
      mechanism: expected.mechanism,
      executor,
      commandDescriptor,
      editBoundary: normalizeEditBoundary(operatorCell.editBoundary),
      attempts: publicAttempts,
      acceptedAttemptIndex: operatorCell.acceptedAttemptIndex,
      terminalStatus: acceptedAttempt.status,
      audit: {
        baselineStatus: baselineAudit.status,
        baselineStartedAt: baselineAudit.timings.startedAt,
        baselineFinishedAt: baselineAudit.timings.finishedAt,
        finalStatus: finalAudit.status,
        finalStartedAt: finalAudit.timings.startedAt,
        finalFinishedAt: finalAudit.timings.finishedAt
      },
      provenance,
      primary: {
        initialDeterministicFailures: initialFailures,
        finalDeterministicFailures: finalFailures,
        closedDeterministicFailures: closedFailures,
        newlyIntroducedDeterministicFailures: newFailures,
        initialDeterministicFailureCount: initialCount,
        finalDeterministicFailureCount: finalCount,
        closedDeterministicFailureCount: closedCount,
        newlyIntroducedDeterministicFailureCount: newCount,
        closureRate: closureRate(initialCount, closedCount),
        deterministicClosure: finalCount === 0,
        preservation: {
          passed: preservation.ok,
          violations: preservation.violations,
          metrics: preservation.metrics
        },
        passedBoth: finalCount === 0 && preservation.ok
      },
      secondary: {
        measurementLabel: SCORE_MEASUREMENT_LABEL,
        initial: auditSecondaryMetrics(baselineAudit),
        final: auditSecondaryMetrics(finalAudit)
      },
      finalSourcePath: `final-sources/${expected.id}.html`
    });
    stagedSources.set(expected.id, finalSource);
  }

  const comparability = {
    commonTaskSha256: commonInputs.hashes.commonTaskSha256,
    fixtureSha256: commonInputs.hashes.fixtureSha256,
    copyStyleSha256: commonInputs.hashes.copyStyleSha256,
    preservationOracleSha256:
      commonInputs.hashes.preservationOracleSha256,
    protocolSha256: commonInputs.hashes.protocolSha256,
    harnessBuildSha256: commonAuditProvenance.harnessBuildSha256,
    harnessConfigSha256: commonAuditProvenance.harnessConfigSha256,
    auditSchemaVersion: commonAuditProvenance.auditSchemaVersion,
    harnessVersion: commonAuditProvenance.harnessVersion,
    scoreFormulaVersion: commonAuditProvenance.scoreFormulaVersion,
    agentPassCount: 1,
    finalReauditCount: 1
  };
  const results = {
    schemaVersion: RESULTS_SCHEMA_VERSION,
    protocolVersion: "obedience-v1",
    recordedAt: evidence.recordedAt,
    snapshotDate: evidence.recordedAt.slice(0, 10),
    comparability,
    cells: publicCells,
    aggregate: recomputeAggregate(publicCells),
    limitations: [...LIMITATIONS]
  };

  const report = renderReport(results);
  const root = await canonicalPublicRoot(publicRoot);
  const stagingRoot = await mkdtemp(
    join(dirname(root), `.${basename(root)}-import-`)
  );
  try {
    await Promise.all(
      [
        INPUT_PATHS.commonTask,
        INPUT_PATHS.copyStyle,
        INPUT_PATHS.fixture,
        INPUT_PATHS.preservationOracle,
        INPUT_PATHS.protocol
      ].map((sourcePath) =>
        copyFile(sourcePath, join(stagingRoot, basename(sourcePath)))
      )
    );
    const finalRoot = join(stagingRoot, "final-sources");
    await mkdir(finalRoot, { recursive: true });
    for (const [cellId, source] of stagedSources) {
      await writeFile(join(finalRoot, `${cellId}.html`), source, {
        encoding: "utf8",
        flag: "wx"
      });
    }
    await Promise.all([
      writeFile(join(stagingRoot, "results.json"), canonicalJson(results), {
        encoding: "utf8",
        flag: "wx"
      }),
      writeFile(join(stagingRoot, "report.md"), report, {
        encoding: "utf8",
        flag: "wx"
      })
    ]);

    const roadmap = await readFile(join(REPO_ROOT, "docs", "ROADMAP.md"), "utf8");
    await publishStagedSnapshot({
      stagingRoot,
      publicRoot: root,
      roadmapSource: roadmap,
      commonInputs,
      requireCompletion: false
    });
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }

  return results;
}

export async function publishStagedSnapshot({
  stagingRoot,
  publicRoot,
  roadmapSource,
  commonInputs,
  requireCompletion = false,
  validateSnapshot = validatePublicSnapshot
}) {
  const root = await canonicalPublicRoot(publicRoot);
  const stage = await realpath(resolve(stagingRoot));
  if (dirname(stage) !== dirname(root)) {
    throw new Error(
      "Public snapshot staging directory must share the destination parent"
    );
  }
  const stageInfo = await lstat(stage);
  if (!stageInfo.isDirectory() || stageInfo.isSymbolicLink()) {
    throw new Error("Public snapshot staging root must be a real directory");
  }

  const validateAt = async (candidateRoot) => {
    const [results, report] = await Promise.all([
      readJson(join(candidateRoot, "results.json")),
      readFile(join(candidateRoot, "report.md"), "utf8")
    ]);
    await validateSnapshot({
      results,
      benchmarkRoot: candidateRoot,
      reportSource: report,
      roadmapSource,
      commonInputs,
      requireCompletion
    });
    return results;
  };

  await validateAt(stage);

  let destinationExisted = false;
  try {
    const destinationInfo = await lstat(root);
    if (!destinationInfo.isDirectory() || destinationInfo.isSymbolicLink()) {
      throw new Error("Public snapshot destination must be a real directory");
    }
    destinationExisted = true;
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  let backupRoot = null;
  let destinationMoved = false;
  let stageMoved = false;
  try {
    if (destinationExisted) {
      backupRoot = await reserveSiblingPath(
        dirname(root),
        `.${basename(root)}-backup-`
      );
      await rename(root, backupRoot);
      destinationMoved = true;
    }

    await rename(stage, root);
    stageMoved = true;
    const publishedResults = await validateAt(root);

    if (backupRoot) {
      await rm(backupRoot, { recursive: true });
      backupRoot = null;
    }
    return publishedResults;
  } catch (publishError) {
    const rollbackErrors = [];
    if (stageMoved) {
      try {
        await rename(root, stage);
        stageMoved = false;
      } catch (error) {
        rollbackErrors.push(error);
        try {
          await rm(root, { recursive: true, force: true });
        } catch (cleanupError) {
          rollbackErrors.push(cleanupError);
        }
      }
    }
    if (destinationMoved && backupRoot) {
      try {
        await rename(backupRoot, root);
        backupRoot = null;
      } catch (error) {
        rollbackErrors.push(error);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [publishError, ...rollbackErrors],
        `Public snapshot publication failed and rollback was incomplete; backup: ${backupRoot ?? "<none>"}`
      );
    }
    throw publishError;
  }
}

async function canonicalPublicRoot(candidate) {
  const requested = resolve(candidate);
  const parent = await realpath(dirname(requested));
  const canonical = join(parent, basename(requested));
  const repositoryRoot = await realpath(REPO_ROOT);
  const canonicalBenchmarkRoot = resolve(BENCHMARK_ROOT);
  if (
    canonical !== canonicalBenchmarkRoot &&
    (
      canonical === repositoryRoot ||
      isPathInside(repositoryRoot, canonical) ||
      isPathInside(canonical, repositoryRoot)
    )
  ) {
    throw new Error(
      "Custom public snapshot destination must be outside and must not contain the source repository"
    );
  }
  return canonical;
}

async function reserveSiblingPath(parent, prefix) {
  const placeholder = await mkdtemp(join(parent, prefix));
  await rm(placeholder, { recursive: true });
  return placeholder;
}

function validatePreparationManifest(manifest, commonInputs) {
  exactKeys(
    manifest,
    [
      "benchmarkId",
      "cells",
      "commonInputHashes",
      "destination",
      "matrixSize",
      "providerExecution",
      "schemaVersion"
    ],
    "preparation manifest"
  );
  equal(manifest.schemaVersion, PREPARATION_SCHEMA_VERSION, "preparation schemaVersion");
  equal(manifest.benchmarkId, "obedience-v1", "preparation benchmarkId");
  equal(manifest.matrixSize, MATRIX.length, "preparation matrixSize");
  equal(manifest.providerExecution, "not-performed", "preparation providerExecution");
  equal(
    canonicalJson(manifest.commonInputHashes),
    canonicalJson(commonInputs.hashes),
    "preparation commonInputHashes"
  );
  if (!Array.isArray(manifest.cells) || manifest.cells.length !== MATRIX.length) {
    throw new Error(`preparation manifest must contain exactly ${MATRIX.length} cells`);
  }
  for (let index = 0; index < MATRIX.length; index += 1) {
    equal(
      manifest.cells[index]?.id,
      MATRIX[index].id,
      `preparation cells[${index}].id`
    );
  }
}

export function validatePreparedRequest(request, expected, commonInputs) {
  exactKeys(
    request,
    [
      "benchmarkId",
      "cellRoot",
      "delivery",
      "effort",
      "effortSupport",
      "executionContract",
      "executorFamily",
      "executorLabel",
      "git",
      "id",
      "inputHashes",
      "mechanism",
      "requestedModel",
      "schemaVersion",
      "taskInput"
    ],
    `${expected.id} request`
  );
  equal(request.schemaVersion, REQUEST_SCHEMA_VERSION, `${expected.id} request schemaVersion`);
  equal(request.benchmarkId, "obedience-v1", `${expected.id} request benchmarkId`);
  equal(request.id, expected.id, `${expected.id} request id`);
  equal(request.executorFamily, expected.executorFamily, `${expected.id} executorFamily`);
  equal(request.executorLabel, expected.executorLabel, `${expected.id} executorLabel`);
  equal(request.requestedModel, expected.requestedModel, `${expected.id} requestedModel`);
  equal(request.effort, expected.effort, `${expected.id} effort`);
  equal(request.effortSupport, expected.effortSupport, `${expected.id} effortSupport`);
  equal(request.mechanism, expected.mechanism, `${expected.id} mechanism`);
  equal(request.cellRoot, `cells/${expected.id}`, `${expected.id} cellRoot`);
  equal(
    canonicalJson(request.taskInput),
    canonicalJson({
      commonTaskPath: "common-task.md",
      deliveryStanzaPath: "delivery-stanza.md",
      promptInputMode: "common-task-then-delivery-stanza"
    }),
    `${expected.id} taskInput`
  );
  equal(
    canonicalJson(request.delivery),
    canonicalJson(expectedDeliveryForCell(expected)),
    `${expected.id} delivery`
  );
  exactKeys(request.git, ["initialized", "reason"], `${expected.id} git`);
  if (request.git.initialized === true) {
    equal(request.git.reason, null, `${expected.id} git reason`);
  } else if (request.git.initialized === false) {
    equal(
      request.git.reason,
      "git-unavailable",
      `${expected.id} git reason`
    );
  } else {
    throw new Error(`${expected.id} git initialized must be boolean`);
  }
  equal(
    canonicalJson(request.inputHashes),
    canonicalJson({
      ...commonInputs.hashes,
      deliveryStanzaSha256: sha256(deliveryStanzaFor(expected))
    }),
    `${expected.id} input hashes`
  );
  equal(
    canonicalJson(request.executionContract),
    canonicalJson({
      providerCommand: "operator-supplied-untracked",
      agentPassCount: 1,
      baselineAuditCount: 1,
      finalAuditCount: 1,
      editablePaths: ["fixture.html"]
    }),
    `${expected.id} execution contract`
  );
}

export async function validatePreparedDelivery(
  cellRoot,
  expected,
  commonInputs,
  { allowAuditArtifacts = false, request: suppliedRequest } = {}
) {
  const expectedDelivery = expectedDeliveryForCell(expected);
  const label = `${expected.id} prepared delivery`;
  const [commonTask, copyStyle, preservationOracle, deliveryStanza, request] =
    await Promise.all([
      readFile(join(cellRoot, "common-task.md")),
      readFile(join(cellRoot, "copy-style.yaml")),
      readFile(join(cellRoot, "preservation-oracle.json")),
      readFile(join(cellRoot, "delivery-stanza.md"), "utf8"),
      suppliedRequest ??
        readJson(join(cellRoot, "request-metadata.json"))
    ]);

  validatePreparedRequest(request, expected, commonInputs);
  await validatePreparedGit(cellRoot, request.git, expected.id);
  equal(
    sha256(commonTask),
    commonInputs.hashes.commonTaskSha256,
    `${label} common-task.md`
  );
  equal(
    sha256(copyStyle),
    commonInputs.hashes.copyStyleSha256,
    `${label} copy-style.yaml`
  );
  equal(
    sha256(preservationOracle),
    commonInputs.hashes.preservationOracleSha256,
    `${label} preservation-oracle.json`
  );
  equal(deliveryStanza, deliveryStanzaFor(expected), `${label} delivery-stanza.md`);
  await validatePreparedCellTree(cellRoot, expected, { allowAuditArtifacts });

  const claudeInstruction = join(cellRoot, "CLAUDE.md");
  const codexInstruction = join(cellRoot, "AGENTS.md");
  const claudeSkill = join(cellRoot, ".claude", "skills", "product-ui-designer");
  const codexSkill = join(cellRoot, ".agents", "skills", "product-ui-designer");

  if (expected.mechanism === "inline") {
    const instructionPath =
      expectedDelivery.instructionFile === "CLAUDE.md"
        ? claudeInstruction
        : codexInstruction;
    const otherInstruction =
      expectedDelivery.instructionFile === "CLAUDE.md"
        ? codexInstruction
        : claudeInstruction;
    equal(
      await readFile(instructionPath, "utf8"),
      commonInputs.sharedBlock,
      `${label} instruction content`
    );
    await Promise.all([
      assertPathMissing(otherInstruction, `${label} opposite instruction`),
      assertPathMissing(claudeSkill, `${label} Claude skill`),
      assertPathMissing(codexSkill, `${label} Codex skill`)
    ]);
    return;
  }

  await Promise.all([
    assertPathMissing(claudeInstruction, `${label} Claude instruction`),
    assertPathMissing(codexInstruction, `${label} Codex instruction`)
  ]);

  if (expected.mechanism === "skill") {
    const installedSkill =
      expectedDelivery.skillDirectory === ".claude/skills/product-ui-designer"
        ? claudeSkill
        : codexSkill;
    const otherSkill = installedSkill === claudeSkill ? codexSkill : claudeSkill;
    const sourceSkill =
      expected.executorFamily === "claude-code"
        ? INPUT_PATHS.claudeSkill
        : INPUT_PATHS.codexSkill;
    equal(
      canonicalJson(await directoryManifest(installedSkill)),
      canonicalJson(await directoryManifest(sourceSkill)),
      `${label} skill tree`
    );
    await assertPathMissing(otherSkill, `${label} opposite skill`);
    return;
  }

  await Promise.all([
    assertPathMissing(claudeSkill, `${label} Claude skill`),
    assertPathMissing(codexSkill, `${label} Codex skill`)
  ]);
}

async function validatePreparedCellTree(
  cellRoot,
  expected,
  { allowAuditArtifacts }
) {
  const expectedDelivery = expectedDeliveryForCell(expected);
  const entries = [
    "common-task.md",
    "copy-style.yaml",
    "delivery-stanza.md",
    "fixture.html",
    "preservation-oracle.json",
    "request-metadata.json"
  ].map((path) => ({ path, type: "file" }));

  if (expectedDelivery.instructionFile) {
    entries.push({
      path: expectedDelivery.instructionFile,
      type: "file"
    });
  }

  if (expectedDelivery.skillDirectory) {
    const sourceSkill =
      expected.executorFamily === "claude-code"
        ? INPUT_PATHS.claudeSkill
        : INPUT_PATHS.codexSkill;
    const skillParts = expectedDelivery.skillDirectory.split("/");
    for (let index = 1; index <= skillParts.length; index += 1) {
      entries.push({
        path: `${skillParts.slice(0, index).join("/")}/`,
        type: "directory"
      });
    }
    for (const entry of await listTreeEntries(sourceSkill)) {
      entries.push({
        path: `${expectedDelivery.skillDirectory}/${entry.path}`,
        type: entry.type
      });
    }
  }

  if (allowAuditArtifacts) {
    entries.push({ path: "runs/", type: "directory" });
    for (const phase of ["baseline", "final"]) {
      entries.push(
        { path: `runs/${phase}/`, type: "directory" },
        { path: `runs/${phase}/audit.json`, type: "file" },
        { path: `runs/${phase}/metadata.json`, type: "file" },
        { path: `runs/${phase}/report-manifest.json`, type: "file" },
        { path: `runs/${phase}/report.md`, type: "file" },
        { path: `runs/${phase}/screenshots/`, type: "directory" },
        { path: `runs/${phase}/screenshots/desktop.png`, type: "file" },
        { path: `runs/${phase}/screenshots/mobile.png`, type: "file" }
      );
    }
  }

  const actual = await listTreeEntries(cellRoot, { ignoreRootGit: true });
  const sortEntries = (items) =>
    [...items].sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0
    );
  equal(
    canonicalJson(sortEntries(actual)),
    canonicalJson(sortEntries(entries)),
    `${expected.id} prepared cell tree`
  );
}

async function assertPathMissing(path, label) {
  try {
    await lstat(path);
  } catch (error) {
    if (error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  throw new Error(`${label} must be absent`);
}

async function directoryManifest(root) {
  const files = await listFiles(root);
  return Promise.all(
    files.map(async (path) => ({
      path: relative(root, path).replaceAll("\\", "/"),
      sha256: sha256(await readFile(path))
    }))
  );
}

async function listTreeEntries(
  root,
  { ignoreRootGit = false } = {},
  prefix = ""
) {
  const entries = await readdir(root, { withFileTypes: true });
  const result = [];
  for (const entry of entries.sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0
  )) {
    if (ignoreRootGit && prefix === "" && entry.name === ".git") {
      if (!entry.isDirectory()) {
        throw new Error("Prepared cell .git entry must be a real directory");
      }
      continue;
    }
    const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    const absolutePath = join(root, entry.name);
    if (entry.isDirectory()) {
      result.push({ path: `${path}/`, type: "directory" });
      result.push(
        ...await listTreeEntries(
          absolutePath,
          { ignoreRootGit: false },
          path
        )
      );
    } else if (entry.isFile()) {
      result.push({ path, type: "file" });
    } else {
      throw new Error(`Prepared cell contains unsupported entry: ${path}`);
    }
  }
  return result;
}

async function validatePreparedGit(cellRoot, git, cellId) {
  const gitPath = join(cellRoot, ".git");
  try {
    const info = await lstat(gitPath);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error(`${cellId} prepared .git must be a real directory`);
    }
    if (git.initialized !== true) {
      throw new Error(`${cellId} git metadata contradicts the prepared .git directory`);
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
    if (git.initialized !== false || git.reason !== "git-unavailable") {
      throw new Error(`${cellId} git metadata requires a prepared .git directory`);
    }
  }
}

function validateOperatorEvidence(evidence) {
  exactKeys(
    evidence,
    ["cells", "recordedAt", "schemaVersion"],
    "operator evidence"
  );
  equal(evidence.schemaVersion, EVIDENCE_SCHEMA_VERSION, "operator evidence schemaVersion");
  if (
    typeof evidence.recordedAt !== "string" ||
    !ISO_INSTANT_PATTERN.test(evidence.recordedAt)
  ) {
    throw new Error("operator evidence recordedAt must be an ISO UTC instant");
  }
  if (!isPlainObject(evidence.cells)) {
    throw new Error("operator evidence cells must be keyed by cell ID");
  }
  exactKeys(evidence.cells, MATRIX.map((cell) => cell.id), "operator evidence cells");
  assertPublicSafe(evidence, "operator evidence");

  for (const expected of MATRIX) {
    const cell = evidence.cells[expected.id];
    if (!isPlainObject(cell)) {
      throw new Error(`operator evidence ${expected.id} must be an object`);
    }
    exactKeys(
      cell,
      [
        "acceptedAttemptIndex",
        "attempts",
        "commandDescriptor",
        "editBoundary",
        "executor"
      ],
      `operator evidence ${expected.id}`
    );
    validateEvidenceExecutor(cell.executor, expected);
    validateEvidenceCommand(cell.commandDescriptor, expected);
    validateEvidenceEditBoundary(cell.editBoundary, expected.id);
    validateEvidenceAttempts(cell, expected);
  }
}

function validateEvidenceExecutor(executor, expected) {
  const label = `${expected.id} executor`;
  exactKeys(executor, SAFE_EXECUTOR_KEYS, label);
  safeSlug(executor.binaryName, `${label}.binaryName`);
  nonEmpty(executor.cliVersion, `${label}.cliVersion`);
  safeSlug(executor.versionSource, `${label}.versionSource`);
  equal(executor.requestedModel, expected.requestedModel, `${label}.requestedModel`);
  if (
    executor.resolvedModel !== null &&
    (typeof executor.resolvedModel !== "string" ||
      executor.resolvedModel.trim() === "")
  ) {
    throw new Error(`${label}.resolvedModel must be null or a non-empty string`);
  }
  equal(executor.effort, expected.effort ?? "provider-default", `${label}.effort`);
  const mismatchedResolution =
    executor.resolvedModel !== null &&
    !resolvedModelMatches(expected, executor.resolvedModel);
  if (mismatchedResolution) {
    throw new Error(
      `${label}.resolvedModel does not match requested model ${expected.requestedModel}`
    );
  }
}

function validateEvidenceEditBoundary(editBoundary, cellId) {
  const label = `${cellId} editBoundary`;
  exactKeys(editBoundary, ["modifiedPaths", "passed"], label);
  if (editBoundary.passed !== true) {
    throw new Error(`${label}.passed must be true`);
  }
  if (!Array.isArray(editBoundary.modifiedPaths)) {
    throw new Error(`${label}.modifiedPaths must be an array`);
  }
  const unique = new Set(editBoundary.modifiedPaths);
  if (unique.size !== editBoundary.modifiedPaths.length) {
    throw new Error(`${label}.modifiedPaths must not contain duplicates`);
  }
  for (const path of editBoundary.modifiedPaths) {
    if (path !== "fixture.html") {
      throw new Error(`${label} records out-of-bound edit ${String(path)}`);
    }
  }
}

function validateEvidenceCommand(descriptor, expected) {
  const label = `${expected.id} commandDescriptor`;
  exactKeys(descriptor, SAFE_COMMAND_KEYS, label);
  safeSlug(descriptor.executable, `${label}.executable`);
  safeSlug(descriptor.invocationMode, `${label}.invocationMode`);
  equal(
    descriptor.promptInputMode,
    "common-task-then-delivery-stanza",
    `${label}.promptInputMode`
  );
  equal(descriptor.requestedModel, expected.requestedModel, `${label}.requestedModel`);
  equal(descriptor.effort, expected.effort ?? "provider-default", `${label}.effort`);
  equal(descriptor.deliveryMechanism, expected.mechanism, `${label}.deliveryMechanism`);
}

function validateEvidenceAttempts(cell, expected) {
  if (!Array.isArray(cell.attempts) || ![1, 2].includes(cell.attempts.length)) {
    throw new Error(`${expected.id} must record one attempt or one operational retry`);
  }
  if (
    !Number.isInteger(cell.acceptedAttemptIndex) ||
    cell.acceptedAttemptIndex !== cell.attempts.length
  ) {
    throw new Error(`${expected.id} acceptedAttemptIndex must select the final attempt`);
  }
  for (let index = 0; index < cell.attempts.length; index += 1) {
    const attempt = cell.attempts[index];
    const label = `${expected.id} attempts[${index}]`;
    exactKeys(attempt, SAFE_ATTEMPT_KEYS, label);
    equal(attempt.index, index + 1, `${label}.index`);
    if (!TERMINAL_STATUSES.has(attempt.status)) {
      throw new Error(`${label}.status is invalid`);
    }
    isoInstant(attempt.startedAt, `${label}.startedAt`);
    isoInstant(attempt.endedAt, `${label}.endedAt`);
    if (Date.parse(attempt.endedAt) < Date.parse(attempt.startedAt)) {
      throw new Error(`${label}.endedAt must not precede startedAt`);
    }
    integer(attempt.wallTimeMs, 0, Number.MAX_SAFE_INTEGER, `${label}.wallTimeMs`);
    if (attempt.exitStatus !== null) {
      integer(attempt.exitStatus, -255, 255, `${label}.exitStatus`);
    }
    if (attempt.signal !== null) {
      safeSlug(attempt.signal, `${label}.signal`);
    }
    if (typeof attempt.timedOut !== "boolean") {
      throw new Error(`${label}.timedOut must be boolean`);
    }
    if ((attempt.status === "timeout") !== attempt.timedOut) {
      throw new Error(`${label}.timedOut disagrees with status`);
    }
    if (attempt.status === "completed" && attempt.exitStatus !== 0) {
      throw new Error(`${label}.completed attempt must exit 0`);
    }
    if (attempt.status === "unavailable" && attempt.exitStatus !== null) {
      throw new Error(`${label}.unavailable attempt must have null exitStatus`);
    }
    if (attempt.status === "completed") {
      nonEmpty(attempt.resolvedModel, `${label}.resolvedModel`);
    } else if (
      attempt.resolvedModel !== null &&
      (typeof attempt.resolvedModel !== "string" ||
        attempt.resolvedModel.trim() === "")
    ) {
      throw new Error(`${label}.resolvedModel must be null or a non-empty string`);
    }
    if (
      attempt.resolvedModel !== null &&
      attempt.resolvedModel !== cell.executor.resolvedModel
    ) {
      throw new Error(`${label}.resolvedModel must match the cell executor`);
    }
    if (
      index > 0 &&
      Date.parse(attempt.startedAt) <
        Date.parse(cell.attempts[index - 1].endedAt)
    ) {
      throw new Error(`${label}.startedAt must not precede the prior attempt end`);
    }
    sha(attempt.privateTranscriptSha256, `${label}.privateTranscriptSha256`);
    validateUsage(attempt.usage, `${label}.usage`);
    if (
      attempt.operationalFailureKind !== null &&
      !OPERATIONAL_FAILURE_KINDS.has(attempt.operationalFailureKind)
    ) {
      throw new Error(`${label}.operationalFailureKind is invalid`);
    }
    if (attempt.retryReason !== null) {
      nonEmpty(attempt.retryReason, `${label}.retryReason`);
    }
  }

  const accepted = cell.attempts[cell.acceptedAttemptIndex - 1];
  if (accepted.status === "completed" && cell.executor.resolvedModel === null) {
    throw new Error(`${expected.id} completed attempt must resolve the requested model`);
  }

  if (cell.attempts.length === 1) {
    const only = cell.attempts[0];
    if (only.operationalFailureKind !== null || only.retryReason !== null) {
      throw new Error(`${expected.id} cannot publish retry metadata without a retry`);
    }
    return;
  }
  const [first, second] = cell.attempts;
  if (
    !OPERATIONAL_FAILURE_KINDS.has(first.operationalFailureKind) ||
    !["error", "timeout", "unavailable"].includes(first.status)
  ) {
    throw new Error(`${expected.id} first attempt is not eligible for operational retry`);
  }
  nonEmpty(first.retryReason, `${expected.id} attempts[0].retryReason`);
  if (second.operationalFailureKind !== null || second.retryReason !== null) {
    throw new Error(`${expected.id} second attempt cannot request another retry`);
  }
}

async function assertAuditArtifacts(cellRoot) {
  const runEntries = (await readdir(join(cellRoot, "runs")))
    .filter((entry) => !entry.startsWith("."))
    .sort();
  equal(
    canonicalJson(runEntries),
    canonicalJson(["baseline", "final"]),
    `${cellRoot} audit directories`
  );
  for (const phase of ["baseline", "final"]) {
    await Promise.all([
      readFile(join(cellRoot, "runs", phase, "audit.json")),
      readFile(join(cellRoot, "runs", phase, "report.md"))
    ]);
  }
}

function validateAudit(audit, label) {
  if (!isPlainObject(audit)) {
    throw new Error(`${label} audit must be an object`);
  }
  for (const key of [
    "schemaVersion",
    "harnessVersion",
    "status",
    "target",
    "viewportPresets",
    "findings",
    "advisoryScore"
  ]) {
    if (!(key in audit)) {
      throw new Error(`${label} audit omits ${key}`);
    }
  }
  if (!["success", "partial"].includes(audit.status)) {
    throw new Error(`${label} audit status must be success or partial`);
  }
  if (audit.status !== "success") {
    throw new Error(`${label} controlled audit must complete successfully`);
  }
  if (!Array.isArray(audit.findings)) {
    throw new Error(`${label} audit findings must be an array`);
  }
  nonEmpty(audit.schemaVersion, `${label} schemaVersion`);
  nonEmpty(audit.harnessVersion, `${label} harnessVersion`);
  nonEmpty(audit.advisoryScore?.formulaVersion, `${label} score formulaVersion`);
  if (!isPlainObject(audit.timings)) {
    throw new Error(`${label} audit omits timings`);
  }
  for (const key of ["startedAt", "finishedAt"]) {
    isoInstant(audit.timings[key], `${label} timings.${key}`);
  }
  if (Date.parse(audit.timings.finishedAt) < Date.parse(audit.timings.startedAt)) {
    throw new Error(`${label} audit finishedAt must not precede startedAt`);
  }
  const url = new URL(audit.target?.url);
  if (
    audit.target?.kind !== "url" ||
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(url.hostname)
  ) {
    throw new Error(`${label} audit target must be local loopback HTTP`);
  }
}

function validateAuditPair(baseline, final, cellId) {
  for (const key of ["schemaVersion", "harnessVersion"]) {
    equal(baseline[key], final[key], `${cellId} ${key}`);
  }
  equal(
    baseline.advisoryScore.formulaVersion,
    final.advisoryScore.formulaVersion,
    `${cellId} score formula`
  );
  equal(
    canonicalJson(baseline.viewportPresets),
    canonicalJson(final.viewportPresets),
    `${cellId} viewport presets`
  );
}

function validateExecutionOrder(baseline, final, operatorCell, cellId) {
  const firstAttempt = operatorCell.attempts[0];
  const acceptedAttempt =
    operatorCell.attempts[operatorCell.acceptedAttemptIndex - 1];
  if (
    Date.parse(firstAttempt.startedAt) <
    Date.parse(baseline.timings.finishedAt)
  ) {
    throw new Error(
      `${cellId} executor started before the baseline audit finished`
    );
  }
  if (
    Date.parse(final.timings.startedAt) <=
    Date.parse(acceptedAttempt.endedAt)
  ) {
    throw new Error(
      `${cellId} final audit must start after the accepted executor ends`
    );
  }
}

function provenanceFromAudit(audit, copyStyleSha256, harnessBuildSha256) {
  const buildDescriptor = {
    auditSchemaVersion: audit.schemaVersion,
    harnessVersion: audit.harnessVersion,
    scoreFormulaVersion: audit.advisoryScore.formulaVersion
  };
  const configDescriptor = {
    viewportPresets: audit.viewportPresets,
    copyStyleSha256,
    auditTargetPolicy: "loopback-http",
    baselineAuditCount: 1,
    finalAuditCount: 1
  };
  return {
    ...buildDescriptor,
    harnessBuildSha256,
    harnessConfigSha256: sha256(canonicalJson(configDescriptor))
  };
}

function assertControlledBaseline(failures, cellId) {
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
  ].sort((left, right) =>
    canonicalJson(left) < canonicalJson(right) ? -1 : 1
  );
  const actual = [...failures].sort((left, right) =>
    canonicalJson(left) < canonicalJson(right) ? -1 : 1
  );
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error(
      `${cellId} baseline must contain exactly page-lang-missing and placeholder-leak in desktop/mobile`
    );
  }
}

function normalizeExecutor(executor) {
  return Object.fromEntries(SAFE_EXECUTOR_KEYS.map((key) => [key, executor[key]]));
}

function normalizeCommandDescriptor(descriptor) {
  return Object.fromEntries(
    SAFE_COMMAND_KEYS.map((key) => [key, descriptor[key]])
  );
}

function normalizeEditBoundary(editBoundary) {
  return {
    passed: editBoundary.passed,
    modifiedPaths: [...editBoundary.modifiedPaths]
  };
}

function normalizeAttempt(attempt) {
  return Object.fromEntries(SAFE_ATTEMPT_KEYS.map((key) => [key, attempt[key]]));
}

function validateUsage(usage, label) {
  if (usage === null) {
    return;
  }
  if (!isPlainObject(usage)) {
    throw new Error(`${label} must be null or an object`);
  }
  for (const [key, value] of Object.entries(usage)) {
    if (!SAFE_USAGE_KEYS.has(key)) {
      throw new Error(`${label}.${key} is not an allowed public usage field`);
    }
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new Error(`${label}.${key} must be a non-negative finite number`);
    }
  }
}

function assertPublicSafe(value, label) {
  const serialized = JSON.stringify(value);
  if (PRIVATE_PATH_PATTERN.test(serialized)) {
    throw new Error(`${label} contains an absolute private path`);
  }
  if (SECRET_PATTERN.test(serialized)) {
    throw new Error(`${label} contains credential-shaped material`);
  }
  for (const key of Object.keys(value ?? {})) {
    if (
      /^(?:argv|args|rawCommand|commandLine|shellCommand|env|environment|credentials?|authorization|apiKey|accessToken|refreshToken|secret|rawTranscript|transcript|transcriptPath)$/i.test(
        key
      )
    ) {
      throw new Error(`${label} contains forbidden key ${key}`);
    }
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertPublicSafe(entry, `${label}[${index}]`));
  } else if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      assertPublicSafe(child, `${label}.${key}`);
    }
  }
}

async function computeHarnessBuildSha256() {
  const packageNames = ["core", "copy-audit", "visual-audit", "cli"];
  const files = [];
  for (const packageName of packageNames) {
    const distRoot = join(REPO_ROOT, "packages", packageName, "dist");
    const packageFiles = await listFiles(distRoot);
    if (packageFiles.length === 0) {
      throw new Error(
        `Harness build output is missing for @design-harness/${packageName}; run pnpm build before import`
      );
    }
    for (const absolutePath of packageFiles) {
      const relativePath = absolutePath
        .slice(REPO_ROOT.length + 1)
        .replaceAll("\\", "/");
      files.push({
        path: relativePath,
        sha256: sha256(await readFile(absolutePath))
      });
    }
  }
  files.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0
  );
  return sha256(canonicalJson(files));
}

async function listFiles(root) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const files = [];
  for (const entry of entries.sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0
  )) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(path));
    } else if (entry.isFile()) {
      files.push(path);
    } else {
      throw new Error(`Harness build contains unsupported non-file entry: ${path}`);
    }
  }
  return files;
}

async function readJson(path) {
  let source;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`Cannot read ${path}: ${error.message}`);
  }
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`Invalid JSON at ${path}: ${error.message}`);
  }
}

function exactKeys(value, expectedKeys, label) {
  if (!isPlainObject(value)) {
    throw new Error(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error(
      `${label} must contain exactly [${expected.join(", ")}], found [${actual.join(", ")}]`
    );
  }
}

function equal(actual, expected, label) {
  if (!Object.is(actual, expected)) {
    throw new Error(
      `${label} must equal ${JSON.stringify(expected)}, found ${JSON.stringify(actual)}`
    );
  }
}

function nonEmpty(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function safeSlug(value, label) {
  if (typeof value !== "string" || !SAFE_SLUG_PATTERN.test(value)) {
    throw new Error(`${label} must be a redacted basename/slug`);
  }
}

function isoInstant(value, label) {
  if (typeof value !== "string" || !ISO_INSTANT_PATTERN.test(value)) {
    throw new Error(`${label} must be an ISO UTC instant`);
  }
}

function integer(value, min, max, label) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer from ${min} through ${max}`);
  }
}

function sha(value, label) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256`);
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

function parseArgs(argv) {
  let workspace;
  let evidencePath;
  let publicRoot = BENCHMARK_ROOT;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--workspace") {
      workspace = argv[++index];
    } else if (arg === "--evidence") {
      evidencePath = argv[++index];
    } else if (arg === "--public-root") {
      publicRoot = argv[++index];
    } else if (arg === "--help" || arg === "-h") {
      return { help: true };
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
    if (!argv[index]) {
      throw new Error(`${arg} requires a path`);
    }
  }
  if (!workspace || !evidencePath) {
    throw new Error("--workspace and --evidence are required");
  }
  return { workspace, evidencePath, publicRoot };
}

function usage() {
  return [
    "Usage:",
    "  node scripts/obedience-benchmark/import.mjs --workspace <prepared-root> --evidence <operator-evidence.json>",
    "",
    "Imports sanitized evidence and audited final sources. It never invokes a provider."
  ].join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const results = await importBenchmark(options);
  console.log(
    `Imported obedience-v1 snapshot: ${results.aggregate.totalCellCount} cells, ` +
      `${results.aggregate.completedCellCount} completed, ` +
      `${results.aggregate.passedBothCellCount} closed-and-preserved.`
  );
}

const isMain =
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 1;
  });
}

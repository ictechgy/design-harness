#!/usr/bin/env node

import {
  cp,
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
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertAuditArtifacts,
  normalizeAttempt,
  normalizeCommandDescriptor,
  normalizeEditBoundary,
  normalizeExecutor,
  provenanceFromAudit,
  validateAudit,
  validateAuditPair,
  validateExecutionOrder
} from "../obedience-benchmark/import.mjs";
import { validatePreservation } from "../obedience-benchmark/preservation.mjs";
import {
  SCORE_MEASUREMENT_LABEL,
  auditSecondaryMetrics,
  closureRate,
  countFailures,
  failureIdentityCounts,
  subtractFailureMultisets
} from "../obedience-benchmark/validate.mjs";
import {
  BENCHMARK_ID,
  BENCHMARK_ROOT,
  CASES,
  MATRIX,
  REPO_ROOT,
  canonicalJson,
  currentSourceCommit,
  deliveryStanzaForExecution,
  executionInputHashes,
  expectedDeliveryForExecution,
  hashDeliveryMaterial,
  hashHarnessBuild,
  isPathInside,
  readAllInputs,
  readCanonicalSharedBlock,
  resolvedModelMatchesExecution,
  sha256
} from "./contract.mjs";
import {
  LIMITATIONS,
  RESULTS_SCHEMA_VERSION,
  recomputeRepeatedAggregate,
  renderRepeatedReport,
  validateCompleteSnapshot
} from "./results.mjs";

export async function importRepeatedBenchmark({
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
      "Prepared workspace must be outside and must not contain the repository"
    );
  }

  const [manifest, evidence, inputs, sharedBlock, harnessBuildSha256] =
    await Promise.all([
      readJson(join(workspaceRoot, "preparation-manifest.json")),
      readJson(resolve(evidencePath)),
      readAllInputs(),
      readCanonicalSharedBlock(),
      hashHarnessBuild()
    ]);
  await validateManifest(manifest, inputs, sharedBlock, harnessBuildSha256);
  validateEvidence(evidence);

  const executions = [];
  const stagedSources = new Map();
  let commonAuditProvenance;
  const baselineFamilyProfiles = new Map();
  for (const expected of MATRIX) {
    const cellRoot = join(workspaceRoot, "cells", expected.id);
    const caseInputs = inputs.cases.get(expected.caseId);
    const [request, baselineAudit, finalAudit, finalSource] =
      await Promise.all([
        readJson(join(cellRoot, "request-metadata.json")),
        readJson(join(cellRoot, "runs", "baseline", "audit.json")),
        readJson(join(cellRoot, "runs", "final", "audit.json")),
        readFile(join(cellRoot, "fixture.html"), "utf8")
      ]);
    await assertAuditArtifacts(cellRoot);
    await validatePreparedCell({
      cellRoot,
      request,
      expected,
      inputs,
      sharedBlock,
      harnessBuildSha256
    });
    validateAudit(baselineAudit, `${expected.id} baseline`);
    validateAudit(finalAudit, `${expected.id} final`);
    validateAuditPair(baselineAudit, finalAudit, expected.id);

    const auditProvenance = provenanceFromAudit(
      baselineAudit,
      inputs.shared.hashes.copyStyleSha256,
      harnessBuildSha256
    );
    if (commonAuditProvenance === undefined) {
      commonAuditProvenance = auditProvenance;
    } else if (
      canonicalJson(commonAuditProvenance) !==
      canonicalJson(auditProvenance)
    ) {
      throw new Error(`${expected.id} audit provenance drifted`);
    }

    const initialFailures = failureIdentityCounts(
      baselineAudit.findings
    );
    const familyProfile = controlledFamilyProfile(
      initialFailures,
      expected.id
    );
    const existingProfile = baselineFamilyProfiles.get(expected.caseId);
    if (
      existingProfile !== undefined &&
      existingProfile !== canonicalJson(familyProfile)
    ) {
      throw new Error(
        `${expected.id} controlled baseline drifted within its case`
      );
    }
    baselineFamilyProfiles.set(
      expected.caseId,
      canonicalJson(familyProfile)
    );

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
      baselineSource: caseInputs.fixture.toString("utf8"),
      oracle: caseInputs.preservationOracle,
      label: expected.id
    });
    const operatorCell = evidence.cells[expected.id];
    validateExecutionOrder(
      baselineAudit,
      finalAudit,
      operatorCell,
      expected.id
    );
    if (
      operatorCell.startingSourceSha256 !==
      caseInputs.hashes.fixtureSha256
    ) {
      throw new Error(`${expected.id} starting source hash drifted`);
    }
    if (operatorCell.finalSourceSha256 !== sha256(finalSource)) {
      throw new Error(`${expected.id} final source hash drifted`);
    }
    const acceptedAttempt =
      operatorCell.attempts[operatorCell.acceptedAttemptIndex - 1];
    if (
      acceptedAttempt.status === "completed" &&
      !resolvedModelMatchesExecution(
        expected,
        operatorCell.executor.resolvedModel
      )
    ) {
      throw new Error(`${expected.id} resolved model does not match`);
    }

    const deliveryStanza = deliveryStanzaForExecution(expected);
    const deliveryMaterialSha256 = await hashDeliveryMaterial(
      expected,
      sharedBlock
    );
    executions.push({
      ...publicDescriptor(expected),
      executor: normalizeExecutor(operatorCell.executor),
      commandDescriptor: normalizeCommandDescriptor(
        operatorCell.commandDescriptor
      ),
      editBoundary: normalizeEditBoundary(operatorCell.editBoundary),
      attempts: operatorCell.attempts.map(normalizeAttempt),
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
      provenance: {
        ...executionInputHashes({
          shared: inputs.shared,
          caseInputs,
          deliveryStanza,
          sharedRulesSha256: sha256(sharedBlock),
          deliveryMaterialSha256
        }),
        sourceCommit: manifest.sourceCommit,
        harnessBuildSha256,
        auditRuntimeConfigSha256:
          auditProvenance.harnessConfigSha256,
        auditSchemaVersion: auditProvenance.auditSchemaVersion,
        harnessVersion: auditProvenance.harnessVersion,
        scoreFormulaVersion: auditProvenance.scoreFormulaVersion,
        startingSourceSha256: caseInputs.hashes.fixtureSha256,
        finalSourceSha256: sha256(finalSource),
        externalCommandSha256: sha256(
          canonicalJson(
            normalizeCommandDescriptor(operatorCell.commandDescriptor)
          )
        ),
        privateTranscriptSha256:
          acceptedAttempt.privateTranscriptSha256,
        agentPassCount: 1,
        finalReauditCount: 1
      },
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

  const caseProfiles = [...baselineFamilyProfiles.values()];
  if (
    caseProfiles.length !== CASES.length ||
    new Set(caseProfiles).size !== 1
  ) {
    throw new Error(
      "The two cases did not expose equal controlled failure families"
    );
  }
  const results = {
    schemaVersion: RESULTS_SCHEMA_VERSION,
    benchmarkId: BENCHMARK_ID,
    recordedAt: evidence.recordedAt,
    snapshotDate: evidence.recordedAt.slice(0, 10),
    comparability: {
      sourceCommit: manifest.sourceCommit,
      harnessBuildSha256,
      auditRuntimeConfigSha256:
        commonAuditProvenance.harnessConfigSha256,
      auditSchemaVersion: commonAuditProvenance.auditSchemaVersion,
      harnessVersion: commonAuditProvenance.harnessVersion,
      scoreFormulaVersion: commonAuditProvenance.scoreFormulaVersion,
      sharedInputHashes: inputs.shared.hashes,
      caseInputHashes: Object.fromEntries(
        [...inputs.cases].map(([id, value]) => [id, value.hashes])
      ),
      agentPassCount: 1,
      finalReauditCount: 1
    },
    executions,
    aggregate: recomputeRepeatedAggregate(executions),
    limitations: [...LIMITATIONS]
  };

  await publishSnapshot({
    publicRoot,
    results,
    stagedSources
  });
  return results;
}

async function validateManifest(
  manifest,
  inputs,
  sharedBlock,
  harnessBuildSha256
) {
  if (
    manifest.schemaVersion !==
      "obedience-repeated-v1/preparation/v1" ||
    manifest.benchmarkId !== BENCHMARK_ID ||
    manifest.providerExecution !== "not-performed" ||
    manifest.matrixSize !== MATRIX.length ||
    manifest.expectedExecutionCount !== MATRIX.length
  ) {
    throw new Error("Preparation manifest identity or matrix is invalid");
  }
  if (
    manifest.sourceCommit !== currentSourceCommit() ||
    manifest.harnessBuildSha256 !== harnessBuildSha256
  ) {
    throw new Error("Preparation manifest source/build provenance drifted");
  }
  if (canonicalJson(manifest.sharedInputHashes) !== canonicalJson(inputs.shared.hashes)) {
    throw new Error("Preparation shared input hashes drifted");
  }
  const caseHashes = Object.fromEntries(
    [...inputs.cases].map(([id, value]) => [id, value.hashes])
  );
  if (
    canonicalJson(manifest.caseInputHashes) !==
    canonicalJson(caseHashes)
  ) {
    throw new Error("Preparation case input hashes drifted");
  }
  if (
    !Array.isArray(manifest.executions) ||
    manifest.executions.length !== MATRIX.length
  ) {
    throw new Error("Preparation manifest must contain exactly 72 executions");
  }
  for (let index = 0; index < MATRIX.length; index += 1) {
    if (manifest.executions[index]?.id !== MATRIX[index].id) {
      throw new Error(`Preparation execution ${index} drifted`);
    }
    const expected = MATRIX[index];
    const caseInputs = inputs.cases.get(expected.caseId);
    const expectedHashes = executionInputHashes({
      shared: inputs.shared,
      caseInputs,
      deliveryStanza: deliveryStanzaForExecution(expected),
      sharedRulesSha256: sha256(sharedBlock),
      deliveryMaterialSha256: await hashDeliveryMaterial(
        expected,
        sharedBlock
      )
    });
    if (
      canonicalJson(manifest.executions[index].inputHashes) !==
      canonicalJson(expectedHashes)
    ) {
      throw new Error(`${expected.id} manifest input hashes drifted`);
    }
  }
}

async function validatePreparedCell({
  cellRoot,
  request,
  expected,
  inputs,
  sharedBlock,
  harnessBuildSha256
}) {
  if (
    request.schemaVersion !== "obedience-repeated-v1/request/v1" ||
    request.id !== expected.id ||
    request.caseId !== expected.caseId ||
    request.repeat !== expected.repeat ||
    request.coordinateId !== expected.coordinateId ||
    request.mechanism !== expected.mechanism
  ) {
    throw new Error(`${expected.id} request metadata drifted`);
  }
  const caseInputs = inputs.cases.get(expected.caseId);
  const expectedHashes = executionInputHashes({
    shared: inputs.shared,
    caseInputs,
    deliveryStanza: deliveryStanzaForExecution(expected),
    sharedRulesSha256: sha256(sharedBlock),
    deliveryMaterialSha256: await hashDeliveryMaterial(
      expected,
      sharedBlock
    )
  });
  if (
    canonicalJson(request.inputHashes) !== canonicalJson(expectedHashes) ||
    request.harness.buildSha256 !== harnessBuildSha256
  ) {
    throw new Error(`${expected.id} request hashes drifted`);
  }
  for (const [name, expectedBytes] of [
    ["copy-style.yaml", inputs.shared.copyStyle],
    ["common-task.md", inputs.shared.commonTask],
    ["preservation-oracle.json", caseInputs.preservationOracleBytes],
    ["delivery-stanza.md", Buffer.from(deliveryStanzaForExecution(expected))]
  ]) {
    if (sha256(await readFile(join(cellRoot, name))) !== sha256(expectedBytes)) {
      throw new Error(`${expected.id} fixed input drifted: ${name}`);
    }
  }
  const delivery = expectedDeliveryForExecution(expected);
  if (canonicalJson(request.delivery) !== canonicalJson(delivery)) {
    throw new Error(`${expected.id} delivery descriptor drifted`);
  }
  if (delivery.instructionFile) {
    if (
      sha256(await readFile(join(cellRoot, delivery.instructionFile))) !==
      sha256(sharedBlock)
    ) {
      throw new Error(`${expected.id} inline delivery drifted`);
    }
  }
  if (delivery.skillDirectory) {
    const expectedSkillHash = await hashRegularTree(
      expected.executorFamily === "claude-code"
        ? join(REPO_ROOT, "adapters/claude-code-skill")
        : join(REPO_ROOT, "adapters/codex-skill")
    );
    if (
      await hashRegularTree(join(cellRoot, delivery.skillDirectory)) !==
      expectedSkillHash
    ) {
      throw new Error(`${expected.id} skill delivery drifted`);
    }
  }
}

function validateEvidence(evidence) {
  if (
    evidence.schemaVersion !==
      "obedience-repeated-v1/operator-evidence/v1" ||
    evidence.benchmarkId !== BENCHMARK_ID ||
    !Number.isFinite(Date.parse(evidence.recordedAt)) ||
    !isPlainObject(evidence.cells)
  ) {
    throw new Error("Operator evidence identity is invalid");
  }
  const ids = Object.keys(evidence.cells).sort();
  const expectedIds = MATRIX.map((entry) => entry.id).sort();
  if (canonicalJson(ids) !== canonicalJson(expectedIds)) {
    throw new Error("Operator evidence must contain exactly 72 matrix cells");
  }
  for (const expected of MATRIX) {
    const cell = evidence.cells[expected.id];
    if (
      !isPlainObject(cell.executor) ||
      !isPlainObject(cell.commandDescriptor) ||
      !isPlainObject(cell.editBoundary) ||
      !Array.isArray(cell.attempts) ||
      cell.attempts.length < 1 ||
      cell.attempts.length > 2 ||
      cell.acceptedAttemptIndex !== cell.attempts.length
    ) {
      throw new Error(`${expected.id} operator evidence is malformed`);
    }
    if (
      cell.editBoundary.passed !== true ||
      canonicalJson(cell.editBoundary.modifiedPaths) !==
        canonicalJson(
          cell.editBoundary.modifiedPaths.length === 0
            ? []
            : ["fixture.html"]
        )
    ) {
      throw new Error(`${expected.id} violated the fixture-only edit boundary`);
    }
    if (cell.attempts.length === 2) {
      const first = cell.attempts[0];
      if (
        !["error", "unavailable"].includes(first.status) ||
        !["authentication", "transient-tool"].includes(
          first.operationalFailureKind
        ) ||
        cell.attempts[1].retryReason !==
          first.operationalFailureKind
      ) {
        throw new Error(`${expected.id} retry violates policy`);
      }
    }
    for (let index = 0; index < cell.attempts.length; index += 1) {
      const attempt = cell.attempts[index];
      if (
        attempt.index !== index + 1 ||
        !["completed", "error", "timeout", "unavailable"].includes(
          attempt.status
        ) ||
        !/^[a-f0-9]{64}$/.test(attempt.privateTranscriptSha256)
      ) {
        throw new Error(`${expected.id} attempt ${index + 1} is invalid`);
      }
    }
    if (
      !/^[a-f0-9]{64}$/.test(cell.startingSourceSha256) ||
      !/^[a-f0-9]{64}$/.test(cell.finalSourceSha256)
    ) {
      throw new Error(`${expected.id} source hashes are invalid`);
    }
  }
}

function controlledFamilyProfile(failures, label) {
  const profile = failures
    .map((failure) => ({
      criterionId: failure.criterionId,
      checkName: failure.checkName,
      viewport: failure.viewport,
      count: failure.count
    }))
    .sort((left, right) =>
      canonicalJson(left).localeCompare(canonicalJson(right))
    );
  const expected = [
    {
      criterionId: "a11y.language.page-lang",
      checkName: "page-lang-missing",
      viewport: "desktop",
      count: 1
    },
    {
      criterionId: "a11y.language.page-lang",
      checkName: "page-lang-missing",
      viewport: "mobile",
      count: 1
    },
    {
      criterionId: "content.placeholder.unrendered",
      checkName: "placeholder-leak",
      viewport: "desktop",
      count: 1
    },
    {
      criterionId: "content.placeholder.unrendered",
      checkName: "placeholder-leak",
      viewport: "mobile",
      count: 1
    }
  ].sort((left, right) =>
    canonicalJson(left).localeCompare(canonicalJson(right))
  );
  if (canonicalJson(profile) !== canonicalJson(expected)) {
    throw new Error(`${label} baseline has unexpected failure families`);
  }
  return profile;
}

function publicDescriptor(execution) {
  return {
    id: execution.id,
    caseId: execution.caseId,
    caseLabel: execution.caseLabel,
    repeat: execution.repeat,
    coordinateId: execution.coordinateId,
    executorFamily: execution.executorFamily,
    executorLabel: execution.executorLabel,
    requestedModel: execution.requestedModel,
    effort: execution.effort,
    effortSupport: execution.effortSupport,
    mechanism: execution.mechanism
  };
}

async function publishSnapshot({
  publicRoot,
  results,
  stagedSources
}) {
  const root = await canonicalPublicRoot(publicRoot);
  const stage = await mkdtemp(
    join(dirname(root), `.${basename(root)}-import-`)
  );
  try {
    await Promise.all([
      cp(join(BENCHMARK_ROOT, "cases"), join(stage, "cases"), {
        recursive: true
      }),
      cp(
        join(BENCHMARK_ROOT, "common-task.md"),
        join(stage, "common-task.md")
      ),
      cp(
        join(BENCHMARK_ROOT, "copy-style.yaml"),
        join(stage, "copy-style.yaml")
      ),
      cp(
        join(BENCHMARK_ROOT, "protocol.md"),
        join(stage, "protocol.md")
      ),
      cp(
        join(BENCHMARK_ROOT, "v1-preservation.json"),
        join(stage, "v1-preservation.json")
      )
    ]);
    await mkdir(join(stage, "final-sources"));
    for (const [id, source] of stagedSources) {
      await writeFile(join(stage, "final-sources", `${id}.html`), source, {
        flag: "wx"
      });
    }
    const status = {
      schemaVersion: "obedience-repeated-v1/status/v1",
      benchmarkId: BENCHMARK_ID,
      status: "complete",
      caseCount: CASES.length,
      repeatCount: 3,
      coordinateCount: 12,
      executionCount: MATRIX.length,
      providerExecution: "recorded",
      publicResults: "present",
      claimBoundary: "bounded-descriptive-snapshot-only"
    };
    await Promise.all([
      writeFile(join(stage, "status.json"), canonicalJson(status), {
        flag: "wx"
      }),
      writeFile(join(stage, "results.json"), canonicalJson(results), {
        flag: "wx"
      }),
      writeFile(join(stage, "report.md"), renderRepeatedReport(results), {
        flag: "wx"
      })
    ]);
    await validateCompleteSnapshot({
      benchmarkRoot: stage,
      results,
      reportSource: renderRepeatedReport(results)
    });
    await publishDirectory(stage, root);
    await validateCompleteSnapshot({ benchmarkRoot: root });
  } finally {
    try {
      await rm(stage, { recursive: true, force: true });
    } catch {
      // A successful rename means the temporary staging path no longer exists.
    }
  }
}

async function publishDirectory(stage, root) {
  let backup;
  try {
    const info = await lstat(root);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error("Public destination must be a real directory");
    }
    backup = await reserveSibling(root);
    await rename(root, backup);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
  try {
    await rename(stage, root);
    if (backup) {
      await rm(backup, { recursive: true });
    }
  } catch (error) {
    if (backup) {
      try {
        await rename(backup, root);
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          `Publication and rollback failed; backup remains at ${backup}`
        );
      }
    }
    throw error;
  }
}

async function canonicalPublicRoot(candidate) {
  const requested = resolve(candidate);
  const parent = await realpath(dirname(requested));
  const root = join(parent, basename(requested));
  const repositoryRoot = await realpath(REPO_ROOT);
  if (
    root !== BENCHMARK_ROOT &&
    (
      root === repositoryRoot ||
      isPathInside(repositoryRoot, root) ||
      isPathInside(root, repositoryRoot)
    )
  ) {
    throw new Error(
      "Custom public root must be outside and must not contain the repository"
    );
  }
  return root;
}

async function reserveSibling(root) {
  const placeholder = await mkdtemp(
    join(dirname(root), `.${basename(root)}-backup-`)
  );
  await rm(placeholder, { recursive: true });
  return placeholder;
}

async function hashRegularTree(root) {
  const paths = await regularFiles(root);
  let payload = "";
  for (const path of paths) {
    payload += `${path.slice(resolve(root).length + 1)}\0${sha256(await readFile(path))}\0`;
  }
  return sha256(payload);
}

async function regularFiles(root) {
  const output = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      output.push(...await regularFiles(path));
    } else if (entry.isFile() && !entry.isSymbolicLink()) {
      output.push(path);
    } else {
      throw new Error(`Unsupported delivery entry: ${path}`);
    }
  }
  return output.sort();
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
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
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (["--workspace", "--evidence", "--public-root"].includes(argv[index])) {
      options[
        argv[index] === "--evidence"
          ? "evidencePath"
          : argv[index].slice(2).replace("-root", "Root")
      ] = argv[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argv[index]}`);
  }
  return options;
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isDirectExecution) {
  try {
    const results = await importRepeatedBenchmark(
      parseArgs(process.argv.slice(2))
    );
    console.log(
      `Imported ${results.executions.length} repeated obedience executions.`
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

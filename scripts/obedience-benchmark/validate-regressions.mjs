#!/usr/bin/env node

import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  BENCHMARK_ROOT,
  MATRIX,
  canonicalJson,
  deliveryStanzaFor,
  readCommonInputs,
  sha256
} from "./contract.mjs";
import { validatePreservation } from "./preservation.mjs";
import {
  BLOCKED_CLAIMS_STATEMENT,
  COMPLETION_PHRASE,
  LIMITATIONS,
  renderReport
} from "./render.mjs";
import {
  BenchmarkValidationError,
  RESULTS_SCHEMA_VERSION,
  SCORE_MEASUREMENT_LABEL,
  closureRate,
  countFailures,
  failureIdentityCounts,
  recomputeAggregate,
  subtractFailureMultisets,
  validatePublicSnapshot
} from "./validate.mjs";

const commonInputs = await readCommonInputs();
const baselineSource = commonInputs.fixture.toString("utf8");
const finalSource = baselineSource
  .replace("<html>", '<html lang="en">')
  .replace(
    "Pending orders: {{pendingCount}}",
    "Pending orders: 12"
  );
const preservation = validatePreservation({
  source: finalSource,
  baselineSource,
  oracle: commonInputs.preservationOracle,
  label: "regression fixture"
});
if (!preservation.ok) {
  throw new Error("Canonical benchmark fixture must pass its preservation oracle");
}

const initialFailures = failureIdentityCounts([
  deterministicFailure(
    "a11y.language.page-lang",
    "page-lang-missing",
    "desktop",
    "html"
  ),
  deterministicFailure(
    "a11y.language.page-lang",
    "page-lang-missing",
    "mobile",
    "html"
  ),
  deterministicFailure(
    "content.placeholder.unrendered",
    "placeholder-leak",
    "desktop",
    "main > section > div:nth-of-type(3) > p"
  ),
  deterministicFailure(
    "content.placeholder.unrendered",
    "placeholder-leak",
    "mobile",
    "main > section > div:nth-of-type(3) > p"
  )
]);
const finalFailures = [];
const closedFailures = subtractFailureMultisets(
  initialFailures,
  finalFailures
);
const newFailures = subtractFailureMultisets(finalFailures, initialFailures);
const finalSourceSha256 = sha256(finalSource);
const harnessBuildSha256 = sha256("self-contained-regression-build");
const harnessConfigSha256 = sha256("self-contained-regression-config");

const cells = MATRIX.map((expected, index) => {
  const resolvedModel =
    expected.executorFamily === "codex-cli"
      ? expected.requestedModel
      : `claude-${expected.requestedModel}-regression`;
  const effort = expected.effort ?? "provider-default";
  const commandDescriptor = {
    executable:
      expected.executorFamily === "codex-cli" ? "codex" : "claude",
    invocationMode: "non-interactive",
    requestedModel: expected.requestedModel,
    effort,
    promptInputMode: "common-task-then-delivery-stanza",
    deliveryMechanism: expected.mechanism
  };
  const privateTranscriptSha256 = sha256(`private-transcript-${expected.id}`);
  // Each cell uses a separate minute so lexical/temporal ordering is explicit.
  const minute = String(index).padStart(2, "0");
  const baselineStartedAt = `2026-07-24T00:${minute}:00.000Z`;
  const baselineFinishedAt = `2026-07-24T00:${minute}:01.000Z`;
  const attemptStartedAt = `2026-07-24T00:${minute}:02.000Z`;
  const attemptEndedAt = `2026-07-24T00:${minute}:03.000Z`;
  const finalStartedAt = `2026-07-24T00:${minute}:04.000Z`;
  const finalFinishedAt = `2026-07-24T00:${minute}:05.000Z`;

  return {
    id: expected.id,
    executorFamily: expected.executorFamily,
    executorLabel: expected.executorLabel,
    mechanism: expected.mechanism,
    executor: {
      binaryName:
        expected.executorFamily === "codex-cli" ? "codex" : "claude",
      cliVersion: "regression-1.0.0",
      versionSource: "operator-path",
      requestedModel: expected.requestedModel,
      resolvedModel,
      effort
    },
    commandDescriptor,
    editBoundary: {
      passed: true,
      modifiedPaths: []
    },
    attempts: [
      {
        index: 1,
        status: "completed",
        operationalFailureKind: null,
        retryReason: null,
        startedAt: attemptStartedAt,
        endedAt: attemptEndedAt,
        wallTimeMs: 1000,
        exitStatus: 0,
        signal: null,
        timedOut: false,
        usage: null,
        privateTranscriptSha256,
        resolvedModel
      }
    ],
    acceptedAttemptIndex: 1,
    terminalStatus: "completed",
    audit: {
      baselineStatus: "success",
      baselineStartedAt,
      baselineFinishedAt,
      finalStatus: "success",
      finalStartedAt,
      finalFinishedAt
    },
    provenance: {
      commonTaskSha256: commonInputs.hashes.commonTaskSha256,
      fixtureSha256: commonInputs.hashes.fixtureSha256,
      copyStyleSha256: commonInputs.hashes.copyStyleSha256,
      deliveryStanzaSha256: sha256(deliveryStanzaFor(expected)),
      preservationOracleSha256:
        commonInputs.hashes.preservationOracleSha256,
      protocolSha256: commonInputs.hashes.protocolSha256,
      harnessBuildSha256,
      harnessConfigSha256,
      externalCommandSha256: sha256(canonicalJson(commandDescriptor)),
      startingSourceSha256: commonInputs.hashes.fixtureSha256,
      finalSourceSha256,
      privateTranscriptSha256,
      auditSchemaVersion: "0.2",
      harnessVersion: "0.6.1",
      scoreFormulaVersion: "epistemic-criterion-max-v2",
      agentPassCount: 1,
      finalReauditCount: 1
    },
    primary: {
      initialDeterministicFailures: structuredClone(initialFailures),
      finalDeterministicFailures: structuredClone(finalFailures),
      closedDeterministicFailures: structuredClone(closedFailures),
      newlyIntroducedDeterministicFailures: structuredClone(newFailures),
      initialDeterministicFailureCount: countFailures(initialFailures),
      finalDeterministicFailureCount: countFailures(finalFailures),
      closedDeterministicFailureCount: countFailures(closedFailures),
      newlyIntroducedDeterministicFailureCount: countFailures(newFailures),
      closureRate: closureRate(
        countFailures(initialFailures),
        countFailures(closedFailures)
      ),
      deterministicClosure: true,
      preservation: {
        passed: preservation.ok,
        violations: preservation.violations,
        metrics: preservation.metrics
      },
      passedBoth: true
    },
    secondary: {
      measurementLabel: SCORE_MEASUREMENT_LABEL,
      initial: secondaryAudit(),
      final: secondaryAudit()
    },
    finalSourcePath: `final-sources/${expected.id}.html`
  };
});

const canonical = {
  schemaVersion: RESULTS_SCHEMA_VERSION,
  protocolVersion: "obedience-v1",
  recordedAt: "2026-07-24T00:59:00.000Z",
  snapshotDate: "2026-07-24",
  comparability: {
    commonTaskSha256: commonInputs.hashes.commonTaskSha256,
    fixtureSha256: commonInputs.hashes.fixtureSha256,
    copyStyleSha256: commonInputs.hashes.copyStyleSha256,
    preservationOracleSha256:
      commonInputs.hashes.preservationOracleSha256,
    protocolSha256: commonInputs.hashes.protocolSha256,
    harnessBuildSha256,
    harnessConfigSha256,
    auditSchemaVersion: "0.2",
    harnessVersion: "0.6.1",
    scoreFormulaVersion: "epistemic-criterion-max-v2",
    agentPassCount: 1,
    finalReauditCount: 1
  },
  cells,
  aggregate: recomputeAggregate(cells),
  limitations: [...LIMITATIONS]
};

const temporaryRoot = await mkdtemp(
  join(tmpdir(), "obedience-v1-regressions-")
);
const root = join(temporaryRoot, "snapshot");
try {
  await cp(BENCHMARK_ROOT, root, { recursive: true });
  await Promise.all(
    MATRIX.map((cell) =>
      writeFile(
        join(root, "final-sources", `${cell.id}.html`),
        finalSource,
        "utf8"
      )
    )
  );
  const roadmap = `${COMPLETION_PHRASE}\n${BLOCKED_CLAIMS_STATEMENT}\n`;
  const canonicalReport = renderReport(canonical);
  const validateFixtureSnapshot = async ({
    results,
    reportSource = renderReport(results),
    roadmapSource = roadmap,
    requireCompletion = true
  }) => {
    await Promise.all([
      writeFile(join(root, "results.json"), canonicalJson(results)),
      writeFile(join(root, "report.md"), reportSource)
    ]);
    return validatePublicSnapshot({
      results,
      benchmarkRoot: root,
      reportSource,
      roadmapSource,
      commonInputs,
      requireCompletion
    });
  };
  await validateFixtureSnapshot({
    results: canonical,
    reportSource: canonicalReport
  });

  const positiveOperationalVariants = [
    {
      name: "successful operational retry",
      requireCompletion: true,
      mutate(results) {
        setRetryOutcome(results.cells[0], "completed");
      }
    },
    {
      name: "exhausted operational retry",
      requireCompletion: false,
      mutate(results) {
        setRetryOutcome(results.cells[1], "error");
      }
    },
    {
      name: "unavailable executor with unresolved model",
      requireCompletion: false,
      mutate(results) {
        setUnavailableOutcome(results.cells[2]);
      }
    }
  ];
  for (const variant of positiveOperationalVariants) {
    const results = structuredClone(canonical);
    variant.mutate(results);
    results.aggregate = recomputeAggregate(results.cells);
    await validateFixtureSnapshot({
      results,
      requireCompletion: variant.requireCompletion
    });
  }

  const visibleTerminalError = structuredClone(canonical);
  const failedCell = visibleTerminalError.cells[0];
  failedCell.terminalStatus = "error";
  failedCell.attempts[failedCell.acceptedAttemptIndex - 1].status = "error";
  failedCell.attempts[failedCell.acceptedAttemptIndex - 1].exitStatus = 1;
  visibleTerminalError.aggregate = recomputeAggregate(
    visibleTerminalError.cells
  );
  await validateFixtureSnapshot({
    results: visibleTerminalError,
    requireCompletion: false
  });

  const mutations = [
    {
      name: "matrix omission",
      expectedIssue: "$.cells must contain exactly 12 cells",
      mutate(results) {
        results.cells.pop();
        results.aggregate = recomputeAggregate(results.cells);
      }
    },
    {
      name: "common-input hash drift",
      expectedIssue: "commonTaskSha256",
      mutate(results) {
        results.cells[0].provenance.commonTaskSha256 = "0".repeat(64);
      }
    },
    {
      name: "delivery-stanza hash drift",
      expectedIssue: "deliveryStanzaSha256",
      mutate(results) {
        results.cells[0].provenance.deliveryStanzaSha256 = "1".repeat(64);
      }
    },
    {
      name: "prompt input order drift",
      expectedIssue: "promptInputMode must equal",
      mutate(results) {
        const cell = results.cells[0];
        cell.commandDescriptor.promptInputMode =
          "delivery-stanza-then-common-task";
        cell.provenance.externalCommandSha256 = sha256(
          canonicalJson(cell.commandDescriptor)
        );
      }
    },
    {
      name: "illegal pass-seeking retry",
      expectedIssue: "status is not eligible for operational retry",
      mutate(results) {
        const cell = results.cells[0];
        const accepted = structuredClone(cell.attempts[0]);
        accepted.index = 2;
        accepted.startedAt = "2026-07-24T00:00:05.000Z";
        accepted.endedAt = "2026-07-24T00:00:06.000Z";
        cell.audit.finalStartedAt = "2026-07-24T00:00:07.000Z";
        cell.audit.finalFinishedAt = "2026-07-24T00:00:08.000Z";
        const ineligibleFirst = structuredClone(cell.attempts[0]);
        ineligibleFirst.operationalFailureKind = "authentication";
        ineligibleFirst.retryReason =
          "operator-recorded authentication retry";
        cell.attempts = [ineligibleFirst, accepted];
        cell.acceptedAttemptIndex = 2;
        cell.provenance.privateTranscriptSha256 =
          accepted.privateTranscriptSha256;
        results.aggregate = recomputeAggregate(results.cells);
      }
    },
    {
      name: "aggregate mismatch",
      expectedIssue: "$.aggregate does not equal its recomputed value",
      mutate(results) {
        results.aggregate.passedBothCellCount += 1;
      }
    },
    {
      name: "public source hash mismatch",
      expectedIssue: "provenance.finalSourceSha256",
      mutate(results) {
        results.cells[0].provenance.finalSourceSha256 = "2".repeat(64);
      }
    },
    {
      name: "private path redaction failure",
      expectedIssue: "contains an absolute home/temp path",
      mutate(results) {
        results.cells[0].executor.versionSource =
          "/Users/example/.local/bin/provider";
      }
    },
    {
      name: "model substitution",
      expectedIssue: "does not match requested model",
      mutate(results) {
        const cell = results.cells[0];
        cell.executor.resolvedModel = "not-haiku-model";
        for (const attempt of cell.attempts) {
          attempt.resolvedModel = "not-haiku-model";
        }
      }
    },
    {
      name: "executor-family substitution",
      expectedIssue: "executor.binaryName must equal \"claude\"",
      mutate(results) {
        const cell = results.cells[0];
        cell.executor.binaryName = "codex";
        cell.commandDescriptor.executable = "codex";
        cell.provenance.externalCommandSha256 = sha256(
          canonicalJson(cell.commandDescriptor)
        );
      }
    },
    {
      name: "executor-command mismatch",
      expectedIssue: "commandDescriptor.executable must equal \"claude\"",
      mutate(results) {
        const cell = results.cells[0];
        cell.commandDescriptor.executable = "codex";
        cell.provenance.externalCommandSha256 = sha256(
          canonicalJson(cell.commandDescriptor)
        );
      }
    },
    {
      name: "edit-boundary escape",
      expectedIssue: "must be the only allowed edit path fixture.html",
      mutate(results) {
        results.cells[0].editBoundary = {
          passed: false,
          modifiedPaths: ["fixture.html", "common-task.md"]
        };
      }
    },
    {
      name: "audit ordering drift",
      expectedIssue: "finalStartedAt must be after the accepted executor ends",
      mutate(results) {
        const cell = results.cells[0];
        cell.audit.finalStartedAt =
          cell.attempts[cell.acceptedAttemptIndex - 1].startedAt;
      }
    },
    {
      name: "invalid snapshot calendar date",
      expectedIssue: "$.recordedAt must be a real UTC instant",
      mutate(results) {
        results.recordedAt = "2026-99-99T00:00:00.000Z";
        results.snapshotDate = "2026-99-99";
      }
    },
    {
      name: "invalid attempt calendar instant",
      expectedIssue: "startedAt must be a real UTC instant",
      mutate(results) {
        results.cells[0].attempts[0].startedAt =
          "2026-02-30T00:00:02.000Z";
      }
    },
    {
      name: "invalid audit calendar instant",
      expectedIssue: "baselineStartedAt must be a real UTC instant",
      mutate(results) {
        results.cells[0].audit.baselineStartedAt =
          "2026-02-30T00:00:00.000Z";
      }
    },
    {
      name: "empty deterministic failure identity",
      expectedIssue: "criterionId must be a non-empty string",
      mutate(results) {
        const cell = results.cells[0];
        const emptyIdentity = {
          criterionId: "",
          checkName: "",
          viewport: "",
          selector: "",
          count: 1
        };
        cell.primary.finalDeterministicFailures = [emptyIdentity];
        cell.primary.closedDeterministicFailures =
          structuredClone(cell.primary.initialDeterministicFailures);
        cell.primary.newlyIntroducedDeterministicFailures = [
          structuredClone(emptyIdentity)
        ];
        cell.primary.finalDeterministicFailureCount = 1;
        cell.primary.closedDeterministicFailureCount =
          cell.primary.initialDeterministicFailureCount;
        cell.primary.newlyIntroducedDeterministicFailureCount = 1;
        cell.primary.closureRate = 1;
        cell.primary.deterministicClosure = false;
        cell.primary.passedBoth = false;
        results.aggregate = recomputeAggregate(results.cells);
      }
    },
    {
      name: "hidden deterministic failure",
      expectedIssue: "duplicates a failure identity",
      mutate(results) {
        const primary = results.cells[0].primary;
        primary.finalDeterministicFailures = [
          structuredClone(primary.initialDeterministicFailures[0]),
          structuredClone(primary.initialDeterministicFailures[0])
        ];
      }
    },
    {
      name: "malformed deterministic failure list",
      expectedIssue: "finalDeterministicFailures must be an array",
      mutate(results, context) {
        results.cells[0].primary.finalDeterministicFailures = {};
        context.reportOverride = canonicalReport;
      }
    },
    {
      name: "public overclaim",
      expectedIssue: "contains forbidden general obedience proof claim",
      mutate(_results, context) {
        context.roadmapSuffix = "\nThis proves agents obey.\n";
      }
    }
  ];

  for (const mutation of mutations) {
    const results = structuredClone(canonical);
    const context = {
      reportOverride: null,
      roadmapSuffix: ""
    };
    mutation.mutate(results, context);
    const report = context.reportOverride ?? renderReport(results);
    try {
      await validateFixtureSnapshot({
        results,
        reportSource: report,
        roadmapSource: `${roadmap}${context.roadmapSuffix}`,
      });
    } catch (error) {
      if (!(error instanceof BenchmarkValidationError)) {
        throw error;
      }
      if (
        !error.issues.some((issue) =>
          issue.includes(mutation.expectedIssue)
        )
      ) {
        throw new Error(
          `${mutation.name}: expected issue containing ${JSON.stringify(mutation.expectedIssue)}, got:\n${error.issues.join("\n")}`
        );
      }
      continue;
    }
    throw new Error(
      `obedience-v1 validator regression: accepted ${mutation.name}`
    );
  }

  console.log(
    `Validated ${positiveOperationalVariants.length} operational outcomes, visible terminal-error retention, and ${mutations.length} targeted fail-closed mutations.`
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

function deterministicFailure(criterionId, checkName, viewport, selector) {
  return {
    determinism: "deterministic",
    resultKind: "failure",
    criterionId,
    checkName,
    viewport,
    selector
  };
}

function secondaryAudit() {
  return {
    advisoryScore: {
      formulaVersion: "epistemic-criterion-max-v2",
      value: 40,
      max: 100,
      band: "blocked"
    },
    deterministicRiskCount: 0,
    heuristicFindingCount: 0,
    needsReviewCount: 0
  };
}

function setRetryOutcome(cell, terminalStatus) {
  const original = structuredClone(cell.attempts[0]);
  const first = {
    ...original,
    status: "error",
    operationalFailureKind: "transient-tool",
    retryReason: "operator-recorded transient tool retry",
    endedAt: original.startedAt.replace(".000Z", ".400Z"),
    wallTimeMs: 400,
    exitStatus: 1,
    privateTranscriptSha256: sha256(
      `${cell.id}-private-first-operational-attempt`
    ),
    resolvedModel: null
  };
  const second = {
    ...original,
    index: 2,
    status: terminalStatus,
    startedAt: original.startedAt.replace(".000Z", ".500Z"),
    wallTimeMs: 500,
    exitStatus: terminalStatus === "completed" ? 0 : 1,
    privateTranscriptSha256: sha256(
      `${cell.id}-private-second-operational-attempt`
    )
  };
  cell.attempts = [first, second];
  cell.acceptedAttemptIndex = 2;
  cell.terminalStatus = terminalStatus;
  cell.provenance.privateTranscriptSha256 =
    second.privateTranscriptSha256;
}

function setUnavailableOutcome(cell) {
  const attempt = cell.attempts[0];
  attempt.status = "unavailable";
  attempt.exitStatus = null;
  attempt.resolvedModel = null;
  cell.executor.resolvedModel = null;
  cell.terminalStatus = "unavailable";
}

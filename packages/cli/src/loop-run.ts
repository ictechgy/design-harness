import { randomUUID } from "node:crypto";
import {
  HARNESS_VERSION,
  type CopyStyle,
  type FontFamilyAdherencePolicy
} from "@design-harness/core";
import {
  auditUrl,
  type AuditUrlOptions,
  type AuditUrlResult
} from "@design-harness/visual-audit";
import {
  runAgentCommand,
  type AgentCommandResult,
  type RunAgentCommandInput
} from "./agent-command.js";
import {
  computeDeterministicFailureProgress,
  type FailureProgress
} from "./loop-progress.js";
import {
  claimLoopOutputRoot,
  loopIterationPaths,
  writeLoopSummaryAtomic,
  type ClaimLoopOutputRootInput,
  type LoopIterationPaths,
  type LoopOutputRoot
} from "./loop-output.js";
import {
  LOOP_CONDITION,
  LOOP_SUMMARY_SCHEMA_VERSION,
  hashLoopAgentCommand,
  type LoopAgentSummary,
  type LoopAuditSummary,
  type LoopExitCode,
  type LoopStatus,
  type LoopSummary
} from "./loop-summary.js";
import { writeAuditArtifacts, type WriteAuditArtifactsInput } from "./output.js";

export interface LoopRunInput {
  url: string;
  outDir: string;
  until: typeof LOOP_CONDITION;
  maxIters: number;
  agentCmd: string;
  agentTimeoutMs: number;
  timeoutMs?: number;
  copyStyle?: CopyStyle;
  fontFamilyPolicy?: FontFamilyAdherencePolicy;
  cwd: string;
}

export interface LoopRunDependencies {
  audit?: (options: AuditUrlOptions) => Promise<AuditUrlResult>;
  writeArtifacts?: (input: WriteAuditArtifactsInput) => Promise<void>;
  runAgent?: (input: RunAgentCommandInput) => Promise<AgentCommandResult>;
  computeProgress?: (findings: AuditUrlResult["auditResult"]["findings"]) => FailureProgress;
  claimOutputRoot?: (input: ClaimLoopOutputRootInput) => Promise<LoopOutputRoot>;
  writeSummary?: (root: LoopOutputRoot, summary: LoopSummary) => Promise<void>;
  createLoopRunId?: () => string;
  now?: () => number;
}

export interface LoopRunResult {
  exitCode: LoopExitCode;
  summary: LoopSummary;
}

export async function runLoop(
  input: LoopRunInput,
  dependencies: LoopRunDependencies = {}
): Promise<LoopRunResult> {
  assertLoopRunInput(input);
  const audit = dependencies.audit ?? auditUrl;
  const writeArtifacts = dependencies.writeArtifacts ?? writeAuditArtifacts;
  const runAgent = dependencies.runAgent ?? runAgentCommand;
  const computeProgress = dependencies.computeProgress ?? computeDeterministicFailureProgress;
  const claimOutputRoot = dependencies.claimOutputRoot ?? claimLoopOutputRoot;
  const writeSummary = dependencies.writeSummary ?? writeLoopSummaryAtomic;
  const createLoopRunId = dependencies.createLoopRunId ?? defaultLoopRunId;
  const now = dependencies.now ?? Date.now;
  const loopRunId = createLoopRunId();
  const root = await claimOutputRoot({ outDir: input.outDir, cwd: input.cwd });
  const summary: LoopSummary = {
    schemaVersion: LOOP_SUMMARY_SCHEMA_VERSION,
    harnessVersion: HARNESS_VERSION,
    loopRunId,
    target: { kind: "url", url: input.url },
    condition: input.until,
    budget: {
      maxIters: input.maxIters,
      agentTimeoutMs: input.agentTimeoutMs,
      ...(input.timeoutMs === undefined ? {} : { auditTimeoutMs: input.timeoutMs })
    },
    status: "running",
    exitCode: null,
    commandSha256: hashLoopAgentCommand(input.agentCmd),
    artifacts: { summaryPath: root.summaryRelativePath },
    audits: [],
    agents: []
  };

  const initialCheckpointFailure = await checkpoint(summary, root, writeSummary);
  if (initialCheckpointFailure) {
    return initialCheckpointFailure;
  }

  let previousAuditPaths: LoopIterationPaths;
  let previousProgress: FailureProgress;
  const baseline = await recordAudit(0);
  if (!baseline) {
    return finish("audit-error", 1);
  }
  previousAuditPaths = baseline.paths;
  previousProgress = baseline.progress;
  if (baseline.result.auditResult.status === "partial") {
    return finish("partial", 2);
  }
  if (baseline.progress.count === 0) {
    return finish("already-clean", 0);
  }
  const baselineCheckpointFailure = await checkpoint(summary, root, writeSummary);
  if (baselineCheckpointFailure) {
    return baselineCheckpointFailure;
  }

  for (let iteration = 1; iteration <= input.maxIters; iteration += 1) {
    const agentStartedAt = now();
    let agentResult: AgentCommandResult;
    try {
      agentResult = await runAgent({
        command: input.agentCmd,
        cwd: input.cwd,
        timeoutMs: input.agentTimeoutMs,
        iteration,
        loopRoot: root.absolutePath,
        iterationDir: previousAuditPaths.absoluteDir,
        auditPath: previousAuditPaths.auditPath,
        reportPath: previousAuditPaths.reportPath,
        summaryPath: root.summaryPath
      });
    } catch {
      agentResult = {
        durationMs: Math.max(0, now() - agentStartedAt),
        timeoutMs: input.agentTimeoutMs,
        timedOut: false,
        exitCode: null,
        signal: null
      };
    }
    summary.agents.push(agentSummary(iteration, agentResult));
    if (agentResult.timedOut) {
      return finish("agent-timeout", 1);
    }
    if (agentResult.exitCode !== 0 || agentResult.signal !== null) {
      return finish("agent-error", 1);
    }
    const agentCheckpointFailure = await checkpoint(summary, root, writeSummary);
    if (agentCheckpointFailure) {
      return agentCheckpointFailure;
    }

    const nextAudit = await recordAudit(iteration);
    if (!nextAudit) {
      return finish("audit-error", 1);
    }
    if (nextAudit.result.auditResult.status === "partial") {
      return finish("partial", 2);
    }
    if (nextAudit.progress.count === 0) {
      return finish("converged", 0);
    }
    if (nextAudit.progress.fingerprint === previousProgress.fingerprint) {
      return finish("no-progress", 3);
    }
    previousAuditPaths = nextAudit.paths;
    previousProgress = nextAudit.progress;
    if (iteration === input.maxIters) {
      return finish("max-iters", 3);
    }
    const auditCheckpointFailure = await checkpoint(summary, root, writeSummary);
    if (auditCheckpointFailure) {
      return auditCheckpointFailure;
    }
  }

  // Input bounds and the loop condition make this unreachable, but keep a fail-closed terminal result.
  return finish("max-iters", 3);

  async function recordAudit(iteration: number): Promise<{
    result: AuditUrlResult;
    progress: FailureProgress;
    paths: LoopIterationPaths;
  } | undefined> {
    const paths = loopIterationPaths(root, iteration);
    const runId = auditRunId(loopRunId, iteration);
    const options: AuditUrlOptions = {
      url: input.url,
      outDir: paths.absoluteDir,
      runId,
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
      ...(input.copyStyle === undefined ? {} : { copyStyle: input.copyStyle }),
      ...(input.fontFamilyPolicy === undefined ? {} : { fontFamilyPolicy: input.fontFamilyPolicy })
    };
    try {
      const result = await audit(options);
      if (result.auditResult.runId !== runId || result.metadata.runId !== runId) {
        return undefined;
      }
      await writeArtifacts({
        outDir: paths.absoluteDir,
        auditResult: result.auditResult,
        metadata: result.metadata
      });
      const progress = computeProgress(result.auditResult.findings);
      summary.audits.push(auditSummary(iteration, result, progress, paths));
      return { result, progress, paths };
    } catch {
      return undefined;
    }
  }

  async function finish(status: LoopStatus, exitCode: LoopExitCode): Promise<LoopRunResult> {
    summary.status = status;
    summary.exitCode = exitCode;
    try {
      await writeSummary(root, summary);
      return { exitCode, summary };
    } catch {
      return summaryError(summary, root, writeSummary);
    }
  }
}

async function checkpoint(
  summary: LoopSummary,
  root: LoopOutputRoot,
  writeSummary: (root: LoopOutputRoot, summary: LoopSummary) => Promise<void>
): Promise<LoopRunResult | undefined> {
  try {
    await writeSummary(root, summary);
    return undefined;
  } catch {
    return summaryError(summary, root, writeSummary);
  }
}

async function summaryError(
  summary: LoopSummary,
  root: LoopOutputRoot,
  writeSummary: (root: LoopOutputRoot, summary: LoopSummary) => Promise<void>
): Promise<LoopRunResult> {
  summary.status = "summary-error";
  summary.exitCode = 1;
  try {
    await writeSummary(root, summary);
  } catch {
    // The in-memory result remains authoritative when even the summary-error checkpoint cannot be written.
  }
  return { exitCode: 1, summary };
}

function auditSummary(
  iteration: number,
  result: AuditUrlResult,
  progress: FailureProgress,
  paths: LoopIterationPaths
): LoopAuditSummary {
  return {
    iteration,
    runId: result.auditResult.runId,
    status: result.auditResult.status,
    deterministicFailureCount: progress.count,
    progress: { version: progress.version, fingerprint: progress.fingerprint },
    artifacts: {
      directory: paths.relativeDir,
      metadata: paths.metadataRelativePath,
      audit: paths.auditRelativePath,
      report: paths.reportRelativePath,
      reportManifest: paths.reportManifestRelativePath
    }
  };
}

function agentSummary(iteration: number, result: AgentCommandResult): LoopAgentSummary {
  return {
    iteration,
    durationMs: result.durationMs,
    timeoutMs: result.timeoutMs,
    timedOut: result.timedOut,
    exitCode: result.exitCode,
    signal: result.signal
  };
}

function auditRunId(loopRunId: string, iteration: number): string {
  return iteration === 0
    ? `${loopRunId}-baseline`
    : `${loopRunId}-${String(iteration).padStart(3, "0")}`;
}

function defaultLoopRunId(): string {
  const timestamp = new Date().toISOString().replaceAll(":", "").replaceAll(".", "");
  return `loop-${timestamp}-${randomUUID()}`;
}

function assertLoopRunInput(input: LoopRunInput): void {
  if (input.until !== LOOP_CONDITION) {
    throw new Error(`Loop condition must be ${LOOP_CONDITION}.`);
  }
  if (!Number.isInteger(input.maxIters) || input.maxIters < 1 || input.maxIters > 10) {
    throw new Error("Loop maxIters must be an integer from 1 to 10.");
  }
  if (
    !Number.isInteger(input.agentTimeoutMs)
    || input.agentTimeoutMs < 1_000
    || input.agentTimeoutMs > 3_600_000
  ) {
    throw new Error("Loop agentTimeoutMs must be an integer from 1000 to 3600000.");
  }
  if (
    input.timeoutMs !== undefined
    && (!Number.isInteger(input.timeoutMs) || input.timeoutMs < 100 || input.timeoutMs > 120_000)
  ) {
    throw new Error("Loop timeoutMs must be an integer from 100 to 120000.");
  }
  if (
    input.agentCmd.length === 0
    || input.agentCmd.trim() !== input.agentCmd
    || input.agentCmd.includes("\0")
    || hasUnpairedSurrogate(input.agentCmd)
    || [...input.agentCmd].length > 8_192
  ) {
    throw new Error("Loop agentCmd must be non-empty, trim-stable, NUL-free, and at most 8192 Unicode scalars.");
  }
  if (
    input.outDir.length === 0
    || input.cwd.length === 0
    || input.outDir.includes("\0")
    || input.cwd.includes("\0")
  ) {
    throw new Error("Loop outDir and cwd must be non-empty and NUL-free.");
  }
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return true;
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

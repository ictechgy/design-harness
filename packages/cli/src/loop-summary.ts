import { createHash } from "node:crypto";
import { assertLocalHttpUrl, type RunStatus } from "@design-harness/core";
import { FAILURE_PROGRESS_VERSION, type FailureProgress } from "./loop-progress.js";

export const LOOP_SUMMARY_SCHEMA_VERSION = "design-harness-loop-summary/v1" as const;
export const LOOP_CONDITION = "deterministic-failures==0" as const;

export type LoopStatus =
  | "running"
  | "already-clean"
  | "converged"
  | "partial"
  | "no-progress"
  | "max-iters"
  | "audit-error"
  | "agent-error"
  | "agent-timeout"
  | "summary-error";

export type LoopExitCode = 0 | 1 | 2 | 3;

export interface LoopAuditArtifacts {
  directory: string;
  metadata: string;
  audit: string;
  report: string;
  reportManifest: string;
}

export interface LoopAuditSummary {
  iteration: number;
  runId: string;
  status: RunStatus;
  deterministicFailureCount: number;
  progress: Pick<FailureProgress, "version" | "fingerprint">;
  artifacts: LoopAuditArtifacts;
}

export interface LoopAgentSummary {
  iteration: number;
  durationMs: number;
  timeoutMs: number;
  timedOut: boolean;
  exitCode: number | null;
  signal: string | null;
}

export interface LoopSummary {
  schemaVersion: typeof LOOP_SUMMARY_SCHEMA_VERSION;
  harnessVersion: string;
  loopRunId: string;
  target: {
    kind: "url";
    url: string;
  };
  condition: typeof LOOP_CONDITION;
  budget: {
    maxIters: number;
    agentTimeoutMs: number;
    auditTimeoutMs?: number;
  };
  status: LoopStatus;
  exitCode: LoopExitCode | null;
  commandSha256: string;
  artifacts: {
    summaryPath: "loop-summary.json";
  };
  audits: LoopAuditSummary[];
  agents: LoopAgentSummary[];
}

const STATUS_EXIT_CODES: Readonly<Record<LoopStatus, LoopExitCode | null>> = {
  running: null,
  "already-clean": 0,
  converged: 0,
  partial: 2,
  "no-progress": 3,
  "max-iters": 3,
  "audit-error": 1,
  "agent-error": 1,
  "agent-timeout": 1,
  "summary-error": 1
};

const LOOP_STATUSES = new Set<string>(Object.keys(STATUS_EXIT_CODES));
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const SIGNAL_PATTERN = /^SIG[A-Z0-9]+$/u;
const EMPTY_FAILURE_FINGERPRINT = createHash("sha256").update("[]", "utf8").digest("hex");

export function hashLoopAgentCommand(command: string): string {
  return createHash("sha256").update(command, "utf8").digest("hex");
}

export function assertLoopSummaryIntegrity(value: unknown): asserts value is LoopSummary {
  const summary = expectRecord(value, "$", [
    "schemaVersion",
    "harnessVersion",
    "loopRunId",
    "target",
    "condition",
    "budget",
    "status",
    "exitCode",
    "commandSha256",
    "artifacts",
    "audits",
    "agents"
  ]);
  expectExact(summary.schemaVersion, LOOP_SUMMARY_SCHEMA_VERSION, "$.schemaVersion");
  expectSafeIdentifier(summary.harnessVersion, "$.harnessVersion");
  expectSafeIdentifier(summary.loopRunId, "$.loopRunId");

  const target = expectRecord(summary.target, "$.target", ["kind", "url"]);
  expectExact(target.kind, "url", "$.target.kind");
  const targetUrl = expectString(target.url, "$.target.url");
  let normalizedTarget: string;
  try {
    normalizedTarget = assertLocalHttpUrl(targetUrl);
  } catch {
    invalid("$.target.url", "must be a local HTTP(S) URL");
  }
  if (normalizedTarget !== targetUrl) {
    invalid("$.target.url", "must already be normalized");
  }

  expectExact(summary.condition, LOOP_CONDITION, "$.condition");
  const budget = expectRecord(summary.budget, "$.budget", [
    "maxIters",
    "agentTimeoutMs",
    "auditTimeoutMs"
  ], ["auditTimeoutMs"]);
  const maxIters = expectIntegerRange(budget.maxIters, 1, 10, "$.budget.maxIters");
  const agentTimeoutMs = expectIntegerRange(
    budget.agentTimeoutMs,
    1_000,
    3_600_000,
    "$.budget.agentTimeoutMs"
  );
  if (budget.auditTimeoutMs !== undefined) {
    expectIntegerRange(budget.auditTimeoutMs, 100, 120_000, "$.budget.auditTimeoutMs");
  }

  const status = expectString(summary.status, "$.status");
  if (!LOOP_STATUSES.has(status)) {
    invalid("$.status", "is not a supported loop status");
  }
  const loopStatus = status as LoopStatus;
  const expectedExitCode = STATUS_EXIT_CODES[loopStatus];
  if (summary.exitCode !== expectedExitCode) {
    invalid("$.exitCode", `must be ${String(expectedExitCode)} for status ${loopStatus}`);
  }
  if (typeof summary.commandSha256 !== "string" || !SHA256_PATTERN.test(summary.commandSha256)) {
    invalid("$.commandSha256", "must be a lowercase SHA-256 digest");
  }

  const artifacts = expectRecord(summary.artifacts, "$.artifacts", ["summaryPath"]);
  expectExact(artifacts.summaryPath, "loop-summary.json", "$.artifacts.summaryPath");

  if (!Array.isArray(summary.audits)) {
    invalid("$.audits", "must be an array");
  }
  if (!Array.isArray(summary.agents)) {
    invalid("$.agents", "must be an array");
  }
  if (summary.audits.length > maxIters + 1) {
    invalid("$.audits", "exceeds the audit budget");
  }
  if (summary.agents.length > maxIters) {
    invalid("$.agents", "exceeds the agent budget");
  }

  const audits = summary.audits.map((audit, index) => validateAudit(audit, index, summary.loopRunId));
  const agents = summary.agents.map((agent, index) => validateAgent(agent, index, agentTimeoutMs));
  validateLifecycle(loopStatus, audits, agents, maxIters);
}

function validateAudit(value: unknown, index: number, loopRunId: unknown): LoopAuditSummary {
  const path = `$.audits[${index}]`;
  const audit = expectRecord(value, path, [
    "iteration",
    "runId",
    "status",
    "deterministicFailureCount",
    "progress",
    "artifacts"
  ]);
  const iteration = expectIntegerRange(audit.iteration, 0, 10, `${path}.iteration`);
  if (iteration !== index) {
    invalid(`${path}.iteration`, `must be the sequential iteration ${index}`);
  }
  const runId = expectString(audit.runId, `${path}.runId`);
  const expectedRunId = iteration === 0
    ? `${String(loopRunId)}-baseline`
    : `${String(loopRunId)}-${String(iteration).padStart(3, "0")}`;
  if (runId !== expectedRunId) {
    invalid(`${path}.runId`, `must be derived from loopRunId as ${JSON.stringify(expectedRunId)}`);
  }
  if (audit.status !== "success" && audit.status !== "partial") {
    invalid(`${path}.status`, "must be success or partial");
  }
  const deterministicFailureCount = expectIntegerRange(
    audit.deterministicFailureCount,
    0,
    Number.MAX_SAFE_INTEGER,
    `${path}.deterministicFailureCount`
  );
  const progress = expectRecord(audit.progress, `${path}.progress`, ["version", "fingerprint"]);
  expectExact(progress.version, FAILURE_PROGRESS_VERSION, `${path}.progress.version`);
  if (typeof progress.fingerprint !== "string" || !SHA256_PATTERN.test(progress.fingerprint)) {
    invalid(`${path}.progress.fingerprint`, "must be a lowercase SHA-256 digest");
  }
  if (
    (deterministicFailureCount === 0) !== (progress.fingerprint === EMPTY_FAILURE_FINGERPRINT)
  ) {
    invalid(`${path}.progress.fingerprint`, "is inconsistent with deterministicFailureCount");
  }

  const artifactObject = expectRecord(audit.artifacts, `${path}.artifacts`, [
    "directory",
    "metadata",
    "audit",
    "report",
    "reportManifest"
  ]);
  const directory = iteration === 0
    ? "iterations/000-baseline"
    : `iterations/${String(iteration).padStart(3, "0")}`;
  const expectedArtifacts: LoopAuditArtifacts = {
    directory,
    metadata: `${directory}/metadata.json`,
    audit: `${directory}/audit.json`,
    report: `${directory}/report.md`,
    reportManifest: `${directory}/report-manifest.json`
  };
  for (const [key, expected] of Object.entries(expectedArtifacts)) {
    const artifactPath = expectString(artifactObject[key], `${path}.artifacts.${key}`);
    if (!isNormalizedRelativePath(artifactPath) || artifactPath !== expected) {
      invalid(`${path}.artifacts.${key}`, `must be ${JSON.stringify(expected)}`);
    }
  }
  return {
    iteration,
    runId,
    status: audit.status,
    deterministicFailureCount,
    progress: {
      version: FAILURE_PROGRESS_VERSION,
      fingerprint: progress.fingerprint as string
    },
    artifacts: expectedArtifacts
  };
}

function validateAgent(value: unknown, index: number, agentTimeoutMs: number): LoopAgentSummary {
  const path = `$.agents[${index}]`;
  const agent = expectRecord(value, path, [
    "iteration",
    "durationMs",
    "timeoutMs",
    "timedOut",
    "exitCode",
    "signal"
  ]);
  const iteration = expectIntegerRange(agent.iteration, 1, 10, `${path}.iteration`);
  if (iteration !== index + 1) {
    invalid(`${path}.iteration`, `must be the sequential iteration ${index + 1}`);
  }
  const durationMs = expectIntegerRange(agent.durationMs, 0, Number.MAX_SAFE_INTEGER, `${path}.durationMs`);
  const timeoutMs = expectIntegerRange(agent.timeoutMs, 1_000, 3_600_000, `${path}.timeoutMs`);
  if (timeoutMs !== agentTimeoutMs) {
    invalid(`${path}.timeoutMs`, "must match budget.agentTimeoutMs");
  }
  if (typeof agent.timedOut !== "boolean") {
    invalid(`${path}.timedOut`, "must be a boolean");
  }
  if (agent.exitCode !== null && (!Number.isInteger(agent.exitCode) || (agent.exitCode as number) < 0)) {
    invalid(`${path}.exitCode`, "must be a non-negative integer or null");
  }
  if (agent.signal !== null && (typeof agent.signal !== "string" || !SIGNAL_PATTERN.test(agent.signal))) {
    invalid(`${path}.signal`, "must be a signal name or null");
  }
  return {
    iteration,
    durationMs,
    timeoutMs,
    timedOut: agent.timedOut,
    exitCode: agent.exitCode as number | null,
    signal: agent.signal as string | null
  };
}

function validateLifecycle(
  status: LoopStatus,
  audits: LoopAuditSummary[],
  agents: LoopAgentSummary[],
  maxIters: number
): void {
  const lastAudit = audits.at(-1);
  const lastAgent = agents.at(-1);
  if (agents.length > audits.length || audits.length > agents.length + 1) {
    invalid("$", "audit and agent histories do not form a sequential loop");
  }
  for (const audit of audits.slice(0, -1)) {
    if (audit.status !== "success" || audit.deterministicFailureCount === 0) {
      invalid("$.audits", "the loop continued after a terminal audit result");
    }
  }
  for (const agent of agents.slice(0, -1)) {
    if (!agentSucceeded(agent)) {
      invalid("$.agents", "the loop continued after an unsuccessful agent result");
    }
  }

  switch (status) {
    case "already-clean":
      requireLifecycle(audits.length === 1 && agents.length === 0, status);
      requireSuccessfulZeroAudit(lastAudit, status);
      break;
    case "converged":
      requireLifecycle(audits.length >= 2 && audits.length === agents.length + 1, status);
      requireSuccessfulZeroAudit(lastAudit, status);
      requireLifecycle(agents.every(agentSucceeded), status);
      break;
    case "partial":
      requireLifecycle(Boolean(lastAudit) && lastAudit?.status === "partial", status);
      requireLifecycle(audits.length === agents.length + 1 && agents.every(agentSucceeded), status);
      break;
    case "no-progress":
      requireLifecycle(audits.length >= 2 && audits.length === agents.length + 1, status);
      requireSuccessfulNonzeroAudit(lastAudit, status);
      requireLifecycle(agents.every(agentSucceeded), status);
      requireLifecycle(audits.at(-2)?.progress.fingerprint === lastAudit?.progress.fingerprint, status);
      break;
    case "max-iters":
      requireLifecycle(agents.length === maxIters && audits.length === maxIters + 1, status);
      requireSuccessfulNonzeroAudit(lastAudit, status);
      requireLifecycle(agents.every(agentSucceeded), status);
      requireLifecycle(
        audits.slice(1).every((audit, index) => audit.progress.fingerprint !== audits[index]?.progress.fingerprint),
        status
      );
      break;
    case "agent-timeout":
      requireLifecycle(audits.length >= 1 && agents.length === audits.length, status);
      requireSuccessfulNonzeroAudit(lastAudit, status);
      requireLifecycle(Boolean(lastAgent?.timedOut), status);
      break;
    case "agent-error":
      requireLifecycle(audits.length >= 1 && agents.length === audits.length, status);
      requireSuccessfulNonzeroAudit(lastAudit, status);
      requireLifecycle(Boolean(lastAgent) && !lastAgent?.timedOut && !agentSucceeded(lastAgent), status);
      break;
    case "audit-error":
      requireLifecycle(agents.length === audits.length, status);
      requireLifecycle(agents.every(agentSucceeded), status);
      if (lastAudit) {
        requireSuccessfulNonzeroAudit(lastAudit, status);
      }
      break;
    case "running":
      if (audits.length === 0) {
        requireLifecycle(agents.length === 0, status);
      } else {
        requireSuccessfulNonzeroAudit(lastAudit, status);
        requireLifecycle(agents.every(agentSucceeded), status);
      }
      break;
    case "summary-error":
      break;
  }
}

function requireSuccessfulZeroAudit(audit: LoopAuditSummary | undefined, status: LoopStatus): void {
  requireLifecycle(Boolean(audit) && audit?.status === "success" && audit.deterministicFailureCount === 0, status);
}

function requireSuccessfulNonzeroAudit(audit: LoopAuditSummary | undefined, status: LoopStatus): void {
  requireLifecycle(Boolean(audit) && audit?.status === "success" && audit.deterministicFailureCount > 0, status);
}

function requireLifecycle(condition: boolean, status: LoopStatus): void {
  if (!condition) {
    invalid("$", `history is inconsistent with status ${status}`);
  }
}

function agentSucceeded(agent: LoopAgentSummary | undefined): boolean {
  return Boolean(agent && !agent.timedOut && agent.exitCode === 0 && agent.signal === null);
}

function expectRecord(
  value: unknown,
  path: string,
  allowedKeys: readonly string[],
  optionalKeys: readonly string[] = []
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(path, "must be an object");
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set(allowedKeys);
  const optional = new Set(optionalKeys);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      invalid(`${path}.${key}`, "is not allowed");
    }
  }
  for (const key of allowedKeys) {
    if (!optional.has(key) && !Object.hasOwn(record, key)) {
      invalid(`${path}.${key}`, "is required");
    }
  }
  return record;
}

function expectString(value: unknown, path: string): string {
  if (typeof value !== "string") {
    invalid(path, "must be a string");
  }
  return value;
}

function expectSafeIdentifier(value: unknown, path: string): string {
  const identifier = expectString(value, path);
  if (identifier.length === 0 || identifier.length > 256 || /[\u0000-\u001f\u007f]/u.test(identifier)) {
    invalid(path, "must be a non-blank bounded identifier without control characters");
  }
  return identifier;
}

function expectIntegerRange(value: unknown, minimum: number, maximum: number, path: string): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    invalid(path, `must be an integer from ${minimum} to ${maximum}`);
  }
  return value as number;
}

function expectExact(value: unknown, expected: string, path: string): void {
  if (value !== expected) {
    invalid(path, `must be ${JSON.stringify(expected)}`);
  }
}

function isNormalizedRelativePath(value: string): boolean {
  return value.length > 0
    && !value.startsWith("/")
    && !value.includes("\\")
    && value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function invalid(path: string, message: string): never {
  throw new Error(`Loop summary integrity failed at ${path}: ${message}.`);
}

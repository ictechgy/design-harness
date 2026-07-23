import { describe, expect, it } from "vitest";
import { computeDeterministicFailureProgress } from "./loop-progress.js";
import {
  LOOP_CONDITION,
  LOOP_SUMMARY_SCHEMA_VERSION,
  assertLoopSummaryIntegrity,
  hashLoopAgentCommand,
  type LoopAuditSummary,
  type LoopStatus,
  type LoopSummary
} from "./loop-summary.js";

const EMPTY_FINGERPRINT = computeDeterministicFailureProgress([]).fingerprint;
const FAILURE_FINGERPRINT = "1".repeat(64);
const CHANGED_FAILURE_FINGERPRINT = "2".repeat(64);

describe("loop summary contract", () => {
  it("validates a closed already-clean summary and stores only the command digest", () => {
    const secretCommand = "repair --token SUPER_SECRET_COMMAND";
    const summary = summaryFor("already-clean", {
      audits: [auditFor(0, 0, EMPTY_FINGERPRINT)]
    });
    summary.commandSha256 = hashLoopAgentCommand(secretCommand);

    expect(() => assertLoopSummaryIntegrity(summary)).not.toThrow();
    expect(summary.commandSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(JSON.stringify(summary)).not.toContain(secretCommand);
    expect(JSON.stringify(summary)).not.toContain("SUPER_SECRET_COMMAND");
  });

  it.each([
    ["running", null],
    ["already-clean", 0],
    ["converged", 0],
    ["partial", 2],
    ["no-progress", 3],
    ["max-iters", 3],
    ["audit-error", 1],
    ["agent-error", 1],
    ["agent-timeout", 1],
    ["summary-error", 1]
  ] as const)("locks %s to exit %s", (status, exitCode) => {
    const summary = minimalSummaryForStatus(status);
    summary.exitCode = exitCode;
    expect(() => assertLoopSummaryIntegrity(summary)).not.toThrow();

    summary.exitCode = exitCode === 0 ? 1 : 0;
    expect(() => assertLoopSummaryIntegrity(summary)).toThrow(/exitCode/u);
  });

  it("accepts a sequential converged history", () => {
    const summary = summaryFor("converged", {
      audits: [
        auditFor(0, 1, FAILURE_FINGERPRINT),
        auditFor(1, 0, EMPTY_FINGERPRINT)
      ],
      agents: [successfulAgent(1)]
    });
    expect(() => assertLoopSummaryIntegrity(summary)).not.toThrow();
  });

  it.each([
    ["unknown root field", (summary: Record<string, unknown>) => { summary.agentCmd = "secret"; }],
    ["unnormalized target", (summary: Record<string, unknown>) => {
      (summary.target as { url: string }).url = "http://localhost:3000";
    }],
    ["bad condition", (summary: Record<string, unknown>) => { summary.condition = "score==100"; }],
    ["bad command digest", (summary: Record<string, unknown>) => { summary.commandSha256 = "not-a-hash"; }],
    ["path escape", (summary: Record<string, unknown>) => {
      const audits = summary.audits as LoopAuditSummary[];
      audits[0]!.artifacts.audit = "../audit.json";
    }],
    ["mismatched run id", (summary: Record<string, unknown>) => {
      const audits = summary.audits as LoopAuditSummary[];
      audits[0]!.runId = "unrelated-run";
    }],
    ["fractional failure count", (summary: Record<string, unknown>) => {
      const audits = summary.audits as LoopAuditSummary[];
      audits[0]!.deterministicFailureCount = 0.5;
    }],
    ["bad progress version", (summary: Record<string, unknown>) => {
      const audits = summary.audits as Array<{ progress: { version: string } }>;
      audits[0]!.progress.version = "failure-progress-v2";
    }],
    ["failure count and fingerprint mismatch", (summary: Record<string, unknown>) => {
      const audits = summary.audits as LoopAuditSummary[];
      audits[0]!.progress.fingerprint = FAILURE_FINGERPRINT;
    }]
  ])("rejects %s", (_label, mutate) => {
    const summary = structuredClone(summaryFor("already-clean", {
      audits: [auditFor(0, 0, EMPTY_FINGERPRINT)]
    })) as unknown as Record<string, unknown>;
    mutate(summary);
    expect(() => assertLoopSummaryIntegrity(summary)).toThrow(/Loop summary integrity failed/u);
  });

  it("rejects command, path, environment, stdin, and output fields on agent entries", () => {
    for (const forbidden of ["command", "cwd", "env", "stdin", "stdout", "stderr", "report", "error"]) {
      const summary = summaryFor("agent-error", {
        audits: [auditFor(0, 1, FAILURE_FINGERPRINT)],
        agents: [{ ...failedAgent(1), [forbidden]: "SUPER_SECRET" } as never]
      });
      expect(() => assertLoopSummaryIntegrity(summary)).toThrow(new RegExp(`agents\\[0\\]\\.${forbidden}`, "u"));
    }
  });

  it("rejects histories inconsistent with their terminal status", () => {
    const noProgress = summaryFor("no-progress", {
      audits: [
        auditFor(0, 1, FAILURE_FINGERPRINT),
        auditFor(1, 1, CHANGED_FAILURE_FINGERPRINT)
      ],
      agents: [successfulAgent(1)]
    });
    expect(() => assertLoopSummaryIntegrity(noProgress)).toThrow(/history is inconsistent/u);

    const timeout = summaryFor("agent-timeout", {
      audits: [auditFor(0, 1, FAILURE_FINGERPRINT)],
      agents: [failedAgent(1)]
    });
    expect(() => assertLoopSummaryIntegrity(timeout)).toThrow(/history is inconsistent/u);

    const skippedNoProgress = minimalSummaryForStatus("max-iters");
    skippedNoProgress.audits[1]!.progress.fingerprint = skippedNoProgress.audits[0]!.progress.fingerprint;
    expect(() => assertLoopSummaryIntegrity(skippedNoProgress)).toThrow(/history is inconsistent/u);
  });
});

function minimalSummaryForStatus(status: LoopStatus): LoopSummary {
  switch (status) {
    case "running":
    case "summary-error":
      return summaryFor(status);
    case "already-clean":
      return summaryFor(status, { audits: [auditFor(0, 0, EMPTY_FINGERPRINT)] });
    case "converged":
      return summaryFor(status, {
        audits: [auditFor(0, 1, FAILURE_FINGERPRINT), auditFor(1, 0, EMPTY_FINGERPRINT)],
        agents: [successfulAgent(1)]
      });
    case "partial":
      return summaryFor(status, { audits: [{ ...auditFor(0, 0, EMPTY_FINGERPRINT), status: "partial" }] });
    case "no-progress":
      return summaryFor(status, {
        audits: [auditFor(0, 1, FAILURE_FINGERPRINT), auditFor(1, 1, FAILURE_FINGERPRINT)],
        agents: [successfulAgent(1)]
      });
    case "max-iters":
      return summaryFor(status, {
        budget: { maxIters: 1, agentTimeoutMs: 3_000 },
        audits: [auditFor(0, 1, FAILURE_FINGERPRINT), auditFor(1, 1, CHANGED_FAILURE_FINGERPRINT)],
        agents: [successfulAgent(1)]
      });
    case "audit-error":
      return summaryFor(status);
    case "agent-error":
      return summaryFor(status, {
        audits: [auditFor(0, 1, FAILURE_FINGERPRINT)],
        agents: [failedAgent(1)]
      });
    case "agent-timeout":
      return summaryFor(status, {
        audits: [auditFor(0, 1, FAILURE_FINGERPRINT)],
        agents: [{ ...failedAgent(1), timedOut: true }]
      });
  }
}

function summaryFor(
  status: LoopStatus,
  overrides: Partial<LoopSummary> = {}
): LoopSummary {
  const exitCodes: Record<LoopStatus, 0 | 1 | 2 | 3 | null> = {
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
  return {
    schemaVersion: LOOP_SUMMARY_SCHEMA_VERSION,
    harnessVersion: "0.6.0",
    loopRunId: "loop-test",
    target: { kind: "url", url: "http://localhost:3000/" },
    condition: LOOP_CONDITION,
    budget: { maxIters: 3, agentTimeoutMs: 3_000 },
    status,
    exitCode: exitCodes[status],
    commandSha256: hashLoopAgentCommand("repair"),
    artifacts: { summaryPath: "loop-summary.json" },
    audits: [],
    agents: [],
    ...overrides
  };
}

function auditFor(iteration: number, count: number, fingerprint: string): LoopAuditSummary {
  const directory = iteration === 0
    ? "iterations/000-baseline"
    : `iterations/${String(iteration).padStart(3, "0")}`;
  return {
    iteration,
    runId: iteration === 0 ? "loop-test-baseline" : `loop-test-${String(iteration).padStart(3, "0")}`,
    status: "success",
    deterministicFailureCount: count,
    progress: { version: "failure-progress-v1", fingerprint },
    artifacts: {
      directory,
      metadata: `${directory}/metadata.json`,
      audit: `${directory}/audit.json`,
      report: `${directory}/report.md`,
      reportManifest: `${directory}/report-manifest.json`
    }
  };
}

function successfulAgent(iteration: number) {
  return {
    iteration,
    durationMs: 100,
    timeoutMs: 3_000,
    timedOut: false,
    exitCode: 0,
    signal: null
  };
}

function failedAgent(iteration: number) {
  return {
    iteration,
    durationMs: 100,
    timeoutMs: 3_000,
    timedOut: false,
    exitCode: 7,
    signal: null
  };
}

import { describe, expect, it } from "vitest";
import {
  createExampleAuditResult,
  createExampleMetadata,
  type Finding,
  type RunStatus
} from "@design-harness/core";
import type { AuditUrlOptions, AuditUrlResult } from "@design-harness/visual-audit";
import type { AgentCommandResult, RunAgentCommandInput } from "./agent-command.js";
import type { LoopOutputRoot } from "./loop-output.js";
import { runLoop, type LoopRunDependencies, type LoopRunInput } from "./loop-run.js";
import { assertLoopSummaryIntegrity, type LoopSummary } from "./loop-summary.js";
import type { WriteAuditArtifactsInput } from "./output.js";

const ROOT: LoopOutputRoot = {
  absolutePath: "/loop-output",
  summaryPath: "/loop-output/loop-summary.json",
  summaryRelativePath: "loop-summary.json"
};

describe("runLoop", () => {
  it("stops an already-clean baseline without invoking an agent", async () => {
    const harness = fakeHarness([{ status: "success", selectors: [] }]);
    const result = await runLoop(loopInput(), harness.dependencies);

    expect(result).toMatchObject({ exitCode: 0, summary: { status: "already-clean" } });
    expect(result.summary.audits).toHaveLength(1);
    expect(result.summary.agents).toEqual([]);
    expect(harness.agentInputs).toEqual([]);
    expect(harness.auditOptions[0]).toMatchObject({
      runId: "loop-test-baseline",
      outDir: "/loop-output/iterations/000-baseline"
    });
    expect(harness.auditOptions[0]).not.toHaveProperty("colorPolicy");
    expect(harness.writtenArtifacts).toHaveLength(1);
    expect(harness.summaries.map(({ status }) => status)).toEqual(["running", "already-clean"]);
  });

  it("checks partial before a zero failure count", async () => {
    const harness = fakeHarness([{ status: "partial", selectors: [] }]);
    const result = await runLoop(loopInput(), harness.dependencies);

    expect(result).toMatchObject({ exitCode: 2, summary: { status: "partial" } });
    expect(result.summary.audits[0]).toMatchObject({
      status: "partial",
      deterministicFailureCount: 0
    });
    expect(harness.agentInputs).toEqual([]);
  });

  it("converges after one unchanged command and one re-audit", async () => {
    const secretCommand = "repair --token SUPER_SECRET_COMMAND";
    const harness = fakeHarness([
      { status: "success", selectors: ["html"] },
      { status: "success", selectors: [] }
    ]);
    const result = await runLoop(loopInput({ agentCmd: secretCommand }), harness.dependencies);

    expect(result).toMatchObject({ exitCode: 0, summary: { status: "converged" } });
    expect(result.summary.audits.map(({ runId }) => runId)).toEqual([
      "loop-test-baseline",
      "loop-test-001"
    ]);
    expect(harness.agentInputs).toEqual([{
      command: secretCommand,
      cwd: "/workspace",
      timeoutMs: 3_000,
      iteration: 1,
      loopRoot: "/loop-output",
      iterationDir: "/loop-output/iterations/000-baseline",
      auditPath: "/loop-output/iterations/000-baseline/audit.json",
      reportPath: "/loop-output/iterations/000-baseline/report.md",
      summaryPath: "/loop-output/loop-summary.json"
    }]);
    expect(JSON.stringify(result.summary)).not.toContain(secretCommand);
    expect(JSON.stringify(harness.summaries)).not.toContain("SUPER_SECRET_COMMAND");
    expect(harness.summaries.map(({ status }) => status)).toEqual([
      "running",
      "running",
      "running",
      "converged"
    ]);
  });

  it("stops no-progress when adjacent failure fingerprints match", async () => {
    const harness = fakeHarness([
      { status: "success", selectors: ["html"] },
      { status: "success", selectors: ["html"] }
    ]);
    const result = await runLoop(loopInput(), harness.dependencies);

    expect(result).toMatchObject({ exitCode: 3, summary: { status: "no-progress" } });
    expect(result.summary.audits[0]?.progress.fingerprint)
      .toBe(result.summary.audits[1]?.progress.fingerprint);
    expect(harness.agentInputs).toHaveLength(1);
    expect(harness.auditOptions).toHaveLength(2);
  });

  it("runs at most N agents and N+1 audits before max-iters", async () => {
    const harness = fakeHarness([
      { status: "success", selectors: ["html"] },
      { status: "success", selectors: ["body"] },
      { status: "success", selectors: ["main"] },
      { status: "success", selectors: ["#app"] }
    ], [successfulAgentResult(), successfulAgentResult(), successfulAgentResult()]);
    const result = await runLoop(loopInput({ maxIters: 3 }), harness.dependencies);

    expect(result).toMatchObject({ exitCode: 3, summary: { status: "max-iters" } });
    expect(harness.agentInputs).toHaveLength(3);
    expect(harness.auditOptions).toHaveLength(4);
    expect(result.summary.agents).toHaveLength(3);
    expect(result.summary.audits).toHaveLength(4);
  });

  it("stops after a partial re-audit without a later agent", async () => {
    const harness = fakeHarness([
      { status: "success", selectors: ["html"] },
      { status: "partial", selectors: [] },
      { status: "success", selectors: [] }
    ]);
    const result = await runLoop(loopInput(), harness.dependencies);

    expect(result).toMatchObject({ exitCode: 2, summary: { status: "partial" } });
    expect(harness.agentInputs).toHaveLength(1);
    expect(harness.auditOptions).toHaveLength(2);
  });

  it.each([
    ["agent-error", { durationMs: 10, timeoutMs: 3_000, timedOut: false, exitCode: 7, signal: null }],
    ["agent-error", { durationMs: 10, timeoutMs: 3_000, timedOut: false, exitCode: null, signal: "SIGTERM" }],
    ["agent-timeout", { durationMs: 3_000, timeoutMs: 3_000, timedOut: true, exitCode: null, signal: "SIGKILL" }]
  ] as const)("maps raw agent metadata to %s and stops", async (status, agentResult) => {
    const harness = fakeHarness(
      [{ status: "success", selectors: ["html"] }],
      [agentResult]
    );
    const result = await runLoop(loopInput(), harness.dependencies);

    expect(result).toMatchObject({ exitCode: 1, summary: { status } });
    expect(result.summary.agents[0]).toEqual({ iteration: 1, ...agentResult });
    expect(harness.auditOptions).toHaveLength(1);
  });

  it("sanitizes a thrown agent error into metadata-only agent-error state", async () => {
    const harness = fakeHarness([{ status: "success", selectors: ["html"] }]);
    harness.dependencies.runAgent = async () => {
      throw new Error("SUPER_SECRET_SPAWN_ERROR");
    };
    const result = await runLoop(loopInput(), harness.dependencies);

    expect(result).toMatchObject({ exitCode: 1, summary: { status: "agent-error" } });
    expect(result.summary.agents[0]).toMatchObject({
      timedOut: false,
      exitCode: null,
      signal: null,
      timeoutMs: 3_000
    });
    expect(JSON.stringify(result.summary)).not.toContain("SUPER_SECRET_SPAWN_ERROR");
  });

  it("records audit-error without persisting an exception message or running later work", async () => {
    const harness = fakeHarness([new Error("SUPER_SECRET_AUDIT_ERROR")]);
    const result = await runLoop(loopInput(), harness.dependencies);

    expect(result).toMatchObject({ exitCode: 1, summary: { status: "audit-error" } });
    expect(result.summary.audits).toEqual([]);
    expect(result.summary.agents).toEqual([]);
    expect(JSON.stringify(result.summary)).not.toContain("SUPER_SECRET_AUDIT_ERROR");
  });

  it("treats artifact-write failure as audit-error and does not run an agent", async () => {
    const harness = fakeHarness([{ status: "success", selectors: ["html"] }]);
    harness.dependencies.writeArtifacts = async () => {
      throw new Error("write failed");
    };
    const result = await runLoop(loopInput(), harness.dependencies);

    expect(result).toMatchObject({ exitCode: 1, summary: { status: "audit-error" } });
    expect(result.summary.audits).toEqual([]);
    expect(harness.agentInputs).toEqual([]);
  });

  it("maps a terminal summary failure to summary-error without claiming convergence", async () => {
    const harness = fakeHarness([
      { status: "success", selectors: ["html"] },
      { status: "success", selectors: [] }
    ]);
    let failedTerminalWrite = false;
    harness.dependencies.writeSummary = async (_root, summary) => {
      assertLoopSummaryIntegrity(summary);
      if (summary.status === "converged" && !failedTerminalWrite) {
        failedTerminalWrite = true;
        throw new Error("rename failed");
      }
      harness.summaries.push(structuredClone(summary));
    };
    const result = await runLoop(loopInput(), harness.dependencies);

    expect(result).toMatchObject({ exitCode: 1, summary: { status: "summary-error" } });
    expect(harness.summaries.at(-1)?.status).toBe("summary-error");
    expect(harness.agentInputs).toHaveLength(1);
    expect(harness.auditOptions).toHaveLength(2);
  });

  it("stops before audit or agent work when the initial summary cannot be written", async () => {
    const harness = fakeHarness([{ status: "success", selectors: [] }]);
    harness.dependencies.writeSummary = async () => {
      throw new Error("summary unavailable");
    };
    const result = await runLoop(loopInput(), harness.dependencies);

    expect(result).toMatchObject({ exitCode: 1, summary: { status: "summary-error" } });
    expect(harness.auditOptions).toEqual([]);
    expect(harness.agentInputs).toEqual([]);
  });

  it("passes audit configuration and explicit derived run ids to every audit", async () => {
    const copyStyle = { schemaVersion: "0.2", locale: "ko-KR" } as const;
    const fontFamilyPolicy = {
      policyId: "font-family-adherence-v1" as const,
      allowedFamilies: [{ value: "Inter", kind: "named" as const }],
      ignoreSelectors: []
    };
    const colorPolicy = {
      policyId: "color-adherence-v1" as const,
      allowedColors: [{ red: 31, green: 97, blue: 209, alpha: 255 }],
      ignoreSelectors: [".third-party-widget"]
    };
    const harness = fakeHarness([
      { status: "success", selectors: ["html"] },
      { status: "success", selectors: [] }
    ]);
    await runLoop(
      loopInput({ timeoutMs: 5_000, copyStyle, fontFamilyPolicy, colorPolicy }),
      harness.dependencies
    );

    expect(harness.auditOptions).toEqual([
      expect.objectContaining({
        runId: "loop-test-baseline",
        timeoutMs: 5_000,
        copyStyle,
        fontFamilyPolicy,
        colorPolicy
      }),
      expect.objectContaining({
        runId: "loop-test-001",
        timeoutMs: 5_000,
        copyStyle,
        fontFamilyPolicy,
        colorPolicy
      })
    ]);
  });

  it("rejects non-file preflight before claiming the output root", async () => {
    let claimCalls = 0;
    const harness = fakeHarness([]);
    harness.dependencies.claimOutputRoot = async () => {
      claimCalls += 1;
      return ROOT;
    };

    await expect(runLoop(loopInput({ maxIters: 0 }), harness.dependencies))
      .rejects.toThrow(/maxIters/u);
    expect(claimCalls).toBe(0);
  });

  it.each([
    ["unpaired command surrogate", { agentCmd: "repair\ud800" }],
    ["NUL output path", { outDir: "runs\0/loop" }],
    ["NUL cwd", { cwd: "/workspace\0/escape" }]
  ])("rejects %s before output side effects", async (_label, overrides) => {
    let claimCalls = 0;
    const harness = fakeHarness([]);
    harness.dependencies.claimOutputRoot = async () => {
      claimCalls += 1;
      return ROOT;
    };

    await expect(runLoop(loopInput(overrides), harness.dependencies)).rejects.toThrow();
    expect(claimCalls).toBe(0);
  });

  it("propagates an exclusive-root collision without audit or agent side effects", async () => {
    const harness = fakeHarness([]);
    harness.dependencies.claimOutputRoot = async () => {
      throw Object.assign(new Error("exists"), { code: "EEXIST" });
    };

    await expect(runLoop(loopInput(), harness.dependencies)).rejects.toMatchObject({ code: "EEXIST" });
    expect(harness.auditOptions).toEqual([]);
    expect(harness.agentInputs).toEqual([]);
  });
});

type AuditPlan = { status: RunStatus; selectors: string[] } | Error;

function fakeHarness(
  plans: AuditPlan[],
  agentResults: readonly AgentCommandResult[] = [successfulAgentResult()]
): {
  dependencies: LoopRunDependencies;
  auditOptions: AuditUrlOptions[];
  agentInputs: RunAgentCommandInput[];
  writtenArtifacts: WriteAuditArtifactsInput[];
  summaries: LoopSummary[];
} {
  const auditOptions: AuditUrlOptions[] = [];
  const agentInputs: RunAgentCommandInput[] = [];
  const writtenArtifacts: WriteAuditArtifactsInput[] = [];
  const summaries: LoopSummary[] = [];
  let auditIndex = 0;
  let agentIndex = 0;
  const dependencies: LoopRunDependencies = {
    createLoopRunId: () => "loop-test",
    claimOutputRoot: async () => ROOT,
    audit: async (options) => {
      auditOptions.push(options);
      const plan = plans[auditIndex++];
      if (plan instanceof Error) {
        throw plan;
      }
      if (!plan) {
        throw new Error("Unexpected audit call");
      }
      return auditResultFor(options.runId as string, plan.status, plan.selectors);
    },
    writeArtifacts: async (input) => {
      writtenArtifacts.push(input);
    },
    runAgent: async (input) => {
      agentInputs.push(input);
      const result = agentResults[agentIndex++];
      if (!result) {
        throw new Error("Unexpected agent call");
      }
      return { ...result };
    },
    writeSummary: async (_root, summary) => {
      assertLoopSummaryIntegrity(summary);
      summaries.push(structuredClone(summary));
    },
    now: () => 100
  };
  return { dependencies, auditOptions, agentInputs, writtenArtifacts, summaries };
}

function loopInput(overrides: Partial<LoopRunInput> = {}): LoopRunInput {
  return {
    url: "http://localhost:3000/",
    outDir: "runs/loop",
    until: "deterministic-failures==0",
    maxIters: 3,
    agentCmd: "repair",
    agentTimeoutMs: 3_000,
    cwd: "/workspace",
    ...overrides
  };
}

function auditResultFor(runId: string, status: RunStatus, selectors: string[]): AuditUrlResult {
  const auditResult = createExampleAuditResult();
  auditResult.runId = runId;
  auditResult.status = status;
  auditResult.failedChecks = status === "partial" ? ["desktop:measurement"] : [];
  auditResult.findings = selectors.map((selector, index) => failureFinding(selector, index));
  const metadata = createExampleMetadata();
  metadata.runId = runId;
  metadata.status = status;
  metadata.failedChecks = [...auditResult.failedChecks];
  return { auditResult, metadata };
}

function failureFinding(selector: string, index: number): Finding {
  return {
    id: `failure-${index}`,
    category: "accessibility",
    severity: "high",
    confidence: "high",
    viewport: "desktop",
    selector,
    evidenceRefs: [],
    problem: "missing language",
    recommendation: "declare language",
    checkName: "page-lang-missing",
    criterionId: "a11y.language.page-lang",
    determinism: "deterministic",
    resultKind: "failure"
  };
}

function successfulAgentResult(): AgentCommandResult {
  return {
    durationMs: 25,
    timeoutMs: 3_000,
    timedOut: false,
    exitCode: 0,
    signal: null
  };
}

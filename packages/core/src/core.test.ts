import { describe, expect, it } from "vitest";
import {
  buildIterationPrompt,
  createExampleAuditResult,
  createExampleBrief,
  createExampleFinding,
  renderMarkdownReport,
  scoreFindings,
  validateSchema
} from "./index.js";

describe("core schemas", () => {
  it("accepts a valid design brief", () => {
    expect(validateSchema("brief", createExampleBrief()).valid).toBe(true);
  });

  it("rejects an invalid design brief with readable issues", () => {
    const result = validateSchema("brief", { schemaVersion: "0.1", title: "" });
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.path)).toContain("$.goals");
    expect(result.issues.map((issue) => issue.path)).toContain("$.targetUsers");
  });

  it("requires evidence-backed findings", () => {
    const invalidFinding = { ...createExampleFinding(), evidenceRefs: [] };
    const result = validateSchema("finding", invalidFinding);
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.message).toContain("at least 1");
  });

  it("validates an audit result with schema and harness versions", () => {
    const result = validateSchema("audit-result", createExampleAuditResult());
    expect(result.valid).toBe(true);
  });
});

describe("scoring", () => {
  it("deducts points by severity and confidence", () => {
    const score = scoreFindings([createExampleFinding()]);
    expect(score.value).toBe(90);
    expect(score.band).toBe("strong");
    expect(score.explanation).toContain("not an objective");
  });
});

describe("report rendering", () => {
  it("includes score, deterministic findings, evidence, and prompt scaffold", () => {
    const auditResult = createExampleAuditResult();
    const report = renderMarkdownReport({ auditResult });
    expect(report).toContain("Advisory Score");
    expect(report).toContain("Deterministic Findings");
    expect(report).toContain("Evidence Links");
    expect(report).toContain("Iteration Prompt Scaffold");
  });

  it("builds a model-neutral iteration prompt", () => {
    const prompt = buildIterationPrompt(createExampleAuditResult());
    expect(prompt).toContain("Use the deterministic findings");
    expect(prompt).not.toContain("Codex");
  });
});

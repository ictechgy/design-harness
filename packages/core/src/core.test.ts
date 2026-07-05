import { describe, expect, it } from "vitest";
import {
  buildIterationPrompt,
  assertAuditResultIntegrity,
  createExampleAuditResult,
  createExampleBrief,
  createExampleCriterion,
  createExampleFinding,
  createExampleMetadata,
  createExampleReportManifest,
  CRITERIA,
  findingMetadataForCheck,
  renderMarkdownReport,
  scoreFindings,
  validateReportCopyGuardrails,
  validateAuditResultIntegrity,
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

  it("accepts a valid source-backed criterion", () => {
    expect(validateSchema("criterion", createExampleCriterion()).valid).toBe(true);
  });

  it("validates an audit result with schema and harness versions", () => {
    const result = validateSchema("audit-result", createExampleAuditResult());
    expect(result.valid).toBe(true);
  });

  it("validates metadata and report manifests", () => {
    expect(validateSchema("metadata", createExampleMetadata()).valid).toBe(true);
    expect(validateSchema("report", createExampleReportManifest()).valid).toBe(true);
  });
});

describe("criteria registry", () => {
  it("maps check names to source-backed finding metadata", () => {
    expect(CRITERIA.length).toBeGreaterThan(0);
    expect(findingMetadataForCheck("horizontal-overflow")).toMatchObject({
      criterionId: "responsive.horizontal-overflow.none",
      determinism: "deterministic",
      resultKind: "risk"
    });
    expect(findingMetadataForCheck("saturated-color-noise-risk")).toMatchObject({
      criterionId: "color.hierarchy.saturation-discipline",
      determinism: "heuristic",
      resultKind: "needs-review",
      humanReviewRecommended: true
    });
    expect(findingMetadataForCheck("checklist-state-visibility-risk")).toMatchObject({
      criterionId: "state.checklist.activation-visibility",
      determinism: "heuristic",
      resultKind: "needs-review",
      humanReviewRecommended: true
    });
  });
});

describe("artifact integrity", () => {
  it("accepts a schema-valid audit result with linked evidence", () => {
    expect(() => assertAuditResultIntegrity(createExampleAuditResult())).not.toThrow();
  });

  it("rejects finding evidence refs that do not exist", () => {
    const auditResult = createExampleAuditResult();
    auditResult.findings[0].evidenceRefs = ["missing-evidence"];
    const result = validateAuditResultIntegrity(auditResult);
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.path).toContain("evidenceRefs");
  });

  it("rejects score deductions that do not reference findings", () => {
    const auditResult = createExampleAuditResult();
    auditResult.advisoryScore.deductions[0].findingId = "missing-finding";
    const result = validateAuditResultIntegrity(auditResult);
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.path).toContain("deductions");
  });

  it("rejects findings that reference unknown criteria or invalid determinism combinations", () => {
    const auditResult = createExampleAuditResult();
    auditResult.findings[0] = {
      ...auditResult.findings[0],
      criterionId: "missing.criterion",
      determinism: "heuristic",
      resultKind: "failure"
    };
    const result = validateAuditResultIntegrity(auditResult);
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.path)).toContain("$.findings[0].criterionId");
    expect(result.issues.map((issue) => issue.path)).toContain("$.findings[0].resultKind");
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
    expect(report).toContain("Findings");
    expect(report).toContain("Deterministic Findings: Risks");
    expect(report).toContain("Source-Backed Criteria");
    expect(report).toContain("[Web Content Accessibility Guidelines 2.2](https://www.w3.org/TR/WCAG22/)");
    expect(report).toContain("Criterion: `responsive.horizontal-overflow.none`");
    expect(report).toContain("Evidence: `screenshot-desktop`, `measurement-desktop`");
    expect(report).toContain("Evidence Links");
    expect(report).toContain("Iteration Prompt Scaffold");
    expect(validateReportCopyGuardrails(report)).toEqual([]);
  });

  it("builds a model-neutral iteration prompt", () => {
    const prompt = buildIterationPrompt(createExampleAuditResult());
    expect(prompt).toContain("Use the deterministic findings");
    expect(prompt).not.toContain("Codex");
  });

  it("flags overclaiming report language", () => {
    expect(validateReportCopyGuardrails("This UI is WCAG compliant and objectively better.")).toContain("WCAG compliant");
    expect(validateReportCopyGuardrails("This captured DOM may lack an accessible name.")).toEqual([]);
  });
});

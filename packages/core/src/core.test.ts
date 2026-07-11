import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildIterationPrompt,
  assertAuditResultIntegrity,
  assertLocalHttpUrl,
  createExampleAuditResult,
  createExampleBrief,
  createExampleCopyStyle,
  createExampleCriterion,
  createExampleFinding,
  createExampleMetadata,
  createExampleReportManifest,
  createMinimalCopyStyle,
  COPY_REGISTERS,
  COPY_SURFACES,
  CRITERIA,
  DEFAULT_JOSA_HEDGE_POLICY,
  findingMetadataForCheck,
  GLOSSARY_MATCH_MODES,
  GLOSSARY_TIERS,
  JOSA_HEDGE_POLICIES,
  loadSchema,
  renderMarkdownReport,
  resolveWorkspacePath,
  scoreFindings,
  tailText,
  validateReportCopyGuardrails,
  validateAuditResultIntegrity,
  validateSchema
} from "./index.js";

function createContentFinding(overrides: Partial<ReturnType<typeof createExampleFinding>> = {}) {
  const finding = {
    ...createExampleFinding(),
    category: "content" as const,
    checkName: "placeholder-leak",
    ...overrides
  };
  delete finding.criterionId;
  delete finding.sourceRefs;
  delete finding.determinism;
  delete finding.resultKind;
  delete finding.runtime;
  return finding;
}

describe("core schemas", () => {
  it("accepts a valid design brief", () => {
    expect(validateSchema("brief", createExampleBrief()).valid).toBe(true);
  });

  it("rejects an invalid design brief with readable issues", () => {
    const result = validateSchema("brief", { schemaVersion: "0.2", title: "" });
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.path)).toContain("$.goals");
    expect(result.issues.map((issue) => issue.path)).toContain("$.targetUsers");
  });

  it("accepts valid minimal and full copy style contracts", () => {
    expect(validateSchema("copy-style", createMinimalCopyStyle()).valid).toBe(true);
    expect(validateSchema("copy-style", createExampleCopyStyle()).valid).toBe(true);
  });

  it("rejects invalid copy style contract values", () => {
    const invalidCopyStyle = {
      ...createExampleCopyStyle(),
      surfaceRegisters: {
        button: "casual"
      },
      glossary: [
        {
          term: "잔액",
          tier: "preferred",
          surfaces: []
        }
      ],
      bannedPhrases: [
        {
          phrase: ""
        }
      ],
      josaHedgePolicy: "warn",
      surfaceMapping: [
        {
          surface: "dialog",
          matchers: [{ kind: "adapter", adapter: "web-dom", value: ".modal" }]
        },
        {
          surface: "button",
          matchers: [{ kind: "role", value: 42 }]
        }
      ]
    };

    const result = validateSchema("copy-style", invalidCopyStyle);
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.path)).toEqual(expect.arrayContaining([
      "$.josaHedgePolicy",
      "$.surfaceRegisters.button",
      "$.surfaceMapping[0].surface",
      "$.surfaceMapping[1].matchers[0]",
      "$.glossary[0].tier",
      "$.glossary[0].surfaces",
      "$.bannedPhrases[0].phrase"
    ]));
  });

  it("rejects blank copy match values and empty surface rules", () => {
    const result = validateSchema("copy-style", {
      ...createMinimalCopyStyle(),
      surfaceMapping: [
        {
          surface: "button",
          matchers: [{ kind: "adapter", adapter: " ", value: " " }]
        },
        {
          surface: "body",
          matchers: []
        },
        {
          surface: "error",
          matchers: [{ kind: "role", value: "Alert" }]
        },
        {
          surface: "marketing",
          matchers: [{ kind: "adapter", adapter: "web dom", value: " .hero" }]
        }
      ],
      glossary: [{ term: " ", tier: "approved", note: " " }],
      bannedPhrases: [{ phrase: " ", reason: " " }]
    });

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.path)).toEqual(expect.arrayContaining([
      "$.surfaceMapping[0].matchers[0]",
      "$.surfaceMapping[1].matchers",
      "$.surfaceMapping[2].matchers[0]",
      "$.surfaceMapping[3].matchers[0]",
      "$.glossary[0].term",
      "$.glossary[0].note",
      "$.bannedPhrases[0].phrase",
      "$.bannedPhrases[0].reason"
    ]));
  });

  it("keeps copy style runtime enums in schema lockstep", () => {
    const schema = loadSchema("copy-style") as {
      $defs: Record<string, {
        enum?: unknown[];
        default?: unknown;
        properties?: Record<string, unknown>;
      }>;
    };

    expect(schema.$defs.copySurface?.enum).toEqual([...COPY_SURFACES]);
    expect(Object.keys(schema.$defs.surfaceRegisters?.properties ?? {})).toEqual([...COPY_SURFACES]);
    expect(schema.$defs.copyRegister?.enum).toEqual([...COPY_REGISTERS]);
    expect(schema.$defs.glossaryTier?.enum).toEqual([...GLOSSARY_TIERS]);
    expect(schema.$defs.glossaryMatchMode?.enum).toEqual([...GLOSSARY_MATCH_MODES]);
    expect(schema.$defs.josaHedgePolicy?.enum).toEqual([...JOSA_HEDGE_POLICIES]);
    expect(schema.$defs.josaHedgePolicy?.default).toBe(DEFAULT_JOSA_HEDGE_POLICY);
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

  it("validates the committed example report audit artifact", () => {
    const auditPath = new URL("../../../examples/reports/semantic-a11y-bad/audit.json", import.meta.url);
    const auditResult = JSON.parse(readFileSync(auditPath, "utf8"));
    expect(validateSchema("audit-result", auditResult).valid).toBe(true);
  });

  it("accepts text inventory and aria snapshot evidence assets", () => {
    const auditResult = createExampleAuditResult();
    auditResult.evidenceAssets.push(
      {
        id: "text-inventory-desktop",
        type: "text-inventory",
        viewport: "desktop",
        data: {
          viewport: "desktop",
          count: 1,
          truncatedCount: 0,
          items: [{
            selector: "main > p",
            text: "Rendered copy",
            region: { x: 0, y: 0, width: 120, height: 24 },
            fontSize: 16,
            fontWeight: "400",
            nearestLang: "en",
            tag: "p",
            role: "",
            accessibleName: "Rendered copy"
          }]
        },
        createdAt: "2026-01-01T00:00:00.000Z"
      },
      {
        id: "aria-snapshot-desktop",
        type: "aria-snapshot",
        viewport: "desktop",
        data: {
          viewport: "desktop",
          format: "playwright-aria-yaml",
          snapshot: "- paragraph: Rendered copy"
        },
        createdAt: "2026-01-01T00:00:00.000Z"
      }
    );

    expect(validateSchema("audit-result", auditResult).valid).toBe(true);
    expect(() => assertAuditResultIntegrity(auditResult)).not.toThrow();
  });

  it("accepts content category schema plumbing without a new criterion", () => {
    const contentFinding = createContentFinding();
    expect(validateSchema("finding", contentFinding).valid).toBe(true);

    const contentCriterion = {
      ...createExampleCriterion(),
      id: "content.placeholder.rendered",
      category: "content" as const,
      title: "Rendered copy does not expose placeholders",
      description: "Rendered UI copy should not expose interpolation placeholders to users.",
      checkNames: ["placeholder-leak"]
    };
    expect(validateSchema("criterion", contentCriterion).valid).toBe(true);

    const auditResult = createExampleAuditResult();
    auditResult.findings = [contentFinding];
    auditResult.advisoryScore = scoreFindings([contentFinding]);
    expect(validateSchema("audit-result", auditResult).valid).toBe(true);
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
  it("deducts deterministic risk points by severity, confidence, and epistemic weight", () => {
    const score = scoreFindings([createExampleFinding()]);
    expect(score.formulaVersion).toBe("epistemic-weight-v1");
    expect(score.value).toBe(94);
    expect(score.band).toBe("strong");
    expect(score.deductions[0]).toMatchObject({
      findingId: "finding-desktop-overflow",
      points: 6
    });
    expect(score.deductions[0]?.reason).toContain("deterministic risk score weight 0.6");
    expect(score.explanation).toContain("not an objective");
    expect(score.explanation).toContain("Needs-review findings are score-exempt");
  });

  it("applies ADR-001 scoring weights by epistemic tier", () => {
    const deterministicFailure = {
      ...createExampleFinding(),
      id: "deterministic-failure",
      resultKind: "failure" as const
    };
    const deterministicRisk = {
      ...createExampleFinding(),
      id: "deterministic-risk"
    };
    const heuristicRisk = {
      ...createExampleFinding(),
      id: "heuristic-risk",
      determinism: "heuristic" as const,
      resultKind: "risk" as const
    };
    const needsReview = {
      ...createExampleFinding(),
      id: "needs-review",
      determinism: "heuristic" as const,
      resultKind: "needs-review" as const
    };
    const legacy = createContentFinding({ id: "legacy-unclassified" });

    const score = scoreFindings([deterministicFailure, deterministicRisk, heuristicRisk, needsReview, legacy]);

    expect(score.deductions).toEqual([
      expect.objectContaining({ findingId: "deterministic-failure", points: 10 }),
      expect.objectContaining({ findingId: "deterministic-risk", points: 6 }),
      expect.objectContaining({ findingId: "heuristic-risk", points: 2.5 }),
      expect.objectContaining({ findingId: "needs-review", points: 0 }),
      expect.objectContaining({ findingId: "legacy-unclassified", points: 2.5 })
    ]);
    expect(score.deductions.find((deduction) => deduction.findingId === "needs-review")?.reason).toContain("score-exempt");
    expect(score.deductions.find((deduction) => deduction.findingId === "legacy-unclassified")?.reason).toContain("legacy/unclassified");
    expect(score.value).toBe(79);
  });

  it("requires the advisory score formula version in the audit-result schema", () => {
    const auditResult = createExampleAuditResult();
    expect(auditResult.advisoryScore.formulaVersion).toBe("epistemic-weight-v1");

    const missingFormulaVersion = {
      ...auditResult,
      advisoryScore: {
        ...auditResult.advisoryScore
      } as Record<string, unknown>
    };
    delete missingFormulaVersion.advisoryScore.formulaVersion;
    expect(validateSchema("audit-result", missingFormulaVersion).valid).toBe(false);

    const wrongFormulaVersion = {
      ...auditResult,
      advisoryScore: {
        ...auditResult.advisoryScore,
        formulaVersion: "legacy-severity-confidence"
      }
    };
    const result = validateSchema("audit-result", wrongFormulaVersion);
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.path === "$.advisoryScore.formulaVersion")).toBe(true);
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

  it("routes content category findings to the content implementation area", () => {
    const contentFinding = createContentFinding({
      problem: "Rendered copy exposes an interpolation placeholder.",
      recommendation: "Render the localized value before showing the copy."
    });
    const auditResult = createExampleAuditResult();
    auditResult.findings = [contentFinding];
    const prompt = buildIterationPrompt(auditResult);

    expect(prompt).toContain("- content: finding-desktop-overflow: Rendered copy exposes an interpolation placeholder.");
    expect(prompt).toContain("Recommendation: Render the localized value before showing the copy.");
  });

  it("flags overclaiming report language", () => {
    expect(validateReportCopyGuardrails("This UI is WCAG compliant and objectively better.")).toContain("WCAG compliant");
    expect(validateReportCopyGuardrails("This captured DOM may lack an accessible name.")).toEqual([]);
  });
});

describe("input policy", () => {
  it("accepts local URL forms consistently", () => {
    expect(assertLocalHttpUrl("http://localhost:3000")).toBe("http://localhost:3000/");
    expect(assertLocalHttpUrl("http://preview.localhost:3000")).toBe("http://preview.localhost:3000/");
    expect(assertLocalHttpUrl("http://127.0.0.1:3000")).toBe("http://127.0.0.1:3000/");
    expect(assertLocalHttpUrl("http://[::1]:3000")).toBe("http://[::1]:3000/");
  });

  it("rejects remote URLs and embedded credentials", () => {
    expect(() => assertLocalHttpUrl("https://example.com")).toThrow("Only local http(s)");
    expect(() => assertLocalHttpUrl("http://user:pass@localhost:3000")).toThrow("must not include credentials");
  });

  it("resolves workspace-relative paths and rejects traversal or absolute paths by default", () => {
    expect(resolveWorkspacePath("runs/demo", { rootDir: "/workspace", fieldName: "outDir" })).toMatchObject({
      absolutePath: "/workspace/runs/demo",
      relativePath: "runs/demo"
    });
    expect(() => resolveWorkspacePath("../secret", { rootDir: "/workspace", fieldName: "runDir" })).toThrow("workspace root");
    expect(() => resolveWorkspacePath("/tmp/secret", { rootDir: "/workspace", fieldName: "runDir" })).toThrow("relative");
  });

  it("keeps compact output tails", () => {
    expect(tailText("short", 10)).toBe("short");
    expect(tailText("0123456789abcdef", 6)).toBe("[output truncated to last 6 characters]\nabcdef");
  });
});

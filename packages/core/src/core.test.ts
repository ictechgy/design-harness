import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildMarkdownReport,
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
  getCriterion,
  getCriterionForCheck,
  GLOSSARY_MATCH_MODES,
  GLOSSARY_TIERS,
  JOSA_HEDGE_POLICIES,
  loadSchema,
  renderMarkdownReport,
  resolveWorkspacePath,
  scoreFindings,
  tailText,
  validateReportCopyGuardrails,
  validateAgainstSchema,
  validateAuditResultIntegrity,
  validateSchema,
  verdictForScore
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

function createCopyFinding(
  checkName: string,
  sourceRefs: string[],
  overrides: Partial<ReturnType<typeof createExampleFinding>> = {}
) {
  const metadata = findingMetadataForCheck(checkName);
  if (!metadata) {
    throw new Error(`Missing criterion metadata for ${checkName}`);
  }

  return {
    ...createExampleFinding(),
    id: `finding-${checkName}`,
    category: "content" as const,
    checkName,
    ...metadata,
    sourceRefs,
    ...overrides
  };
}

function createPromptFinding(
  id: string,
  overrides: Partial<ReturnType<typeof createExampleFinding>> = {}
) {
  return {
    ...createExampleFinding(),
    id,
    problem: `Problem ${id}.`,
    recommendation: `Recommendation ${id}.`,
    ...overrides
  };
}

function createRegisteredPromptFinding(
  id: string,
  checkName: string,
  overrides: Partial<ReturnType<typeof createExampleFinding>> = {}
) {
  const metadata = findingMetadataForCheck(checkName);
  const criterion = getCriterionForCheck(checkName);
  if (!metadata || !criterion) {
    throw new Error(`Missing criterion metadata for ${checkName}`);
  }

  return createPromptFinding(id, {
    category: criterion.category,
    checkName,
    ...metadata,
    ...overrides
  });
}

function createLegacyV1AuditResult(): ReturnType<typeof createExampleAuditResult> {
  const auditResult = createExampleAuditResult();
  const finding = auditResult.findings[0];
  if (!finding) {
    throw new Error("Example audit must contain one finding.");
  }

  return {
    ...auditResult,
    advisoryScore: {
      formulaVersion: "epistemic-weight-v1",
      value: 94,
      max: 100,
      band: "strong",
      deductions: [{
        findingId: finding.id,
        points: 6,
        reason: "Legacy per-finding deduction."
      }],
      explanation: "Legacy v1 advisory score fixture."
    }
  };
}

function requireV2Score(auditResult: ReturnType<typeof createExampleAuditResult>) {
  const score = auditResult.advisoryScore;
  if (score.formulaVersion !== "epistemic-criterion-max-v2") {
    throw new Error(`Expected v2 score, received ${score.formulaVersion}.`);
  }
  return score;
}

function createMultiGroupV2AuditResult(): ReturnType<typeof createExampleAuditResult> {
  const auditResult = createExampleAuditResult();
  const weaker = {
    ...createExampleFinding(),
    id: "finding-z",
    severity: "low" as const,
    viewport: "desktop"
  };
  const stronger = {
    ...createExampleFinding(),
    id: "finding-a",
    severity: "high" as const,
    viewport: "mobile"
  };
  const legacy = createContentFinding({
    id: "legacy-finding",
    checkName: "legacy-check",
    severity: "medium"
  });

  auditResult.findings = [weaker, stronger, legacy];
  auditResult.advisoryScore = scoreFindings(auditResult.findings);
  return auditResult;
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

  it("rejects prototype-named own properties in closed schemas", () => {
    for (const key of ["constructor", "toString", "__proto__"] as const) {
      const copyStyle = createMinimalCopyStyle() as unknown as Record<string, unknown>;
      Object.defineProperty(copyStyle, key, {
        value: "unexpected",
        enumerable: true,
        configurable: true,
        writable: true
      });

      const result = validateSchema("copy-style", copyStyle);
      expect(result.valid).toBe(false);
      expect(result.issues).toContainEqual({ path: `$.${key}`, message: "is not allowed" });
    }
  });

  it("requires own properties and ignores inherited declared properties", () => {
    const requiredSchema = {
      type: "object",
      additionalProperties: false,
      required: ["value"],
      properties: {
        value: { type: "string" }
      }
    };
    const inheritedRequired = Object.create({ value: "inherited" }) as Record<string, unknown>;
    expect(validateAgainstSchema(requiredSchema, inheritedRequired).issues).toContainEqual({
      path: "$.value",
      message: "is required"
    });

    const optionalSchema = {
      type: "object",
      additionalProperties: false,
      properties: {
        value: { type: "string" }
      }
    };
    const inheritedInvalid = Object.create({ value: 42 }) as Record<string, unknown>;
    expect(validateAgainstSchema(optionalSchema, inheritedInvalid)).toEqual({ valid: true, issues: [] });
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

  it("accepts optional structured notices while keeping legacy artifacts valid", () => {
    const legacyAudit = createExampleAuditResult();
    expect("notices" in legacyAudit).toBe(false);
    expect(validateSchema("audit-result", legacyAudit).valid).toBe(true);

    const auditWithNotices = {
      ...legacyAudit,
      notices: [
        {
          code: "copy-analysis-capability-unavailable",
          message: "Lemma matching was skipped for one configured term.",
          viewport: "desktop",
          details: { capability: "lemma", term: "example", glossaryIndex: 0 }
        }
      ]
    };
    expect(validateSchema("audit-result", auditWithNotices).valid).toBe(true);
    expect(auditWithNotices.advisoryScore).toEqual(legacyAudit.advisoryScore);
    expect(auditWithNotices.failedChecks).toEqual(legacyAudit.failedChecks);
  });

  it("rejects malformed audit notices", () => {
    const auditResult = createExampleAuditResult();
    const malformed = {
      ...auditResult,
      notices: [
        { code: "", message: "Missing code." },
        { code: "copy-test", message: " " },
        { code: "copy-test" },
        { code: "copy-test", message: "Invalid details.", details: [] }
      ]
    };

    const result = validateSchema("audit-result", malformed);
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.path)).toEqual(expect.arrayContaining([
      "$.notices[0].code",
      "$.notices[1].message",
      "$.notices[2].message",
      "$.notices[3].details"
    ]));
  });

  it("validates the committed example report audit artifact", () => {
    const auditPath = new URL("../../../examples/reports/semantic-a11y-bad/audit.json", import.meta.url);
    const auditResult = JSON.parse(readFileSync(auditPath, "utf8"));
    expect(validateSchema("audit-result", auditResult).valid).toBe(true);
  });

  it("does not claim deterministic findings in the verdict when none are present", () => {
    // A heuristic-only audit can still score into a low band, because heuristic risks deduct too. The
    // verdict must not then assert "deterministic" findings the audit does not have.
    const heuristicFindings = Array.from({ length: 12 }, (_unused, index) => ({
      ...createContentFinding({ id: `heuristic-${index}`, checkName: `heuristic-check-${index}` }),
      determinism: "heuristic" as const,
      resultKind: "risk" as const,
      severity: "high" as const
    }));
    const score = scoreFindings(heuristicFindings);
    const verdict = verdictForScore(score, heuristicFindings);

    expect(score.band).toBe("blocked");
    expect(verdict).not.toMatch(/deterministic/);
    expect(verdict).toContain("heuristic");
  });

  it("names deterministic failures in the verdict only when they are present", () => {
    const failure = {
      ...createExampleFinding(),
      id: "det-failure",
      determinism: "deterministic" as const,
      resultKind: "failure" as const
    };
    const verdict = verdictForScore(scoreFindings([failure]), [failure]);
    expect(verdict).toMatch(/deterministic failure/);
  });

  it("does not claim 'only deterministic findings' when a heuristic finding is present", () => {
    const auditResult = createExampleAuditResult();
    auditResult.findings = [
      { ...createExampleFinding(), id: "det", determinism: "deterministic", resultKind: "risk" },
      { ...createExampleFinding(), id: "heur", determinism: "heuristic", resultKind: "risk" }
    ];
    auditResult.advisoryScore = scoreFindings(auditResult.findings);
    const report = renderMarkdownReport({ auditResult });
    expect(report).not.toContain("only contains deterministic");
    expect(report).toContain("shown with their recorded classifications");
  });

  it("does not name a determinism class the note's findings lack (legacy-only)", () => {
    const auditResult = createExampleAuditResult();
    const legacyFinding = { ...createExampleFinding(), id: "legacy" };
    delete (legacyFinding as { determinism?: unknown }).determinism;
    auditResult.findings = [legacyFinding];
    auditResult.advisoryScore = scoreFindings(auditResult.findings);
    const report = renderMarkdownReport({ auditResult });
    // A legacy finding carries neither a deterministic nor a heuristic classification; the note must not
    // assert either one, only that findings are shown with whatever classification they carry.
    expect(report).not.toContain("only contains deterministic");
    expect(report).not.toMatch(/retain their recorded deterministic/);
    expect(report).toContain("shown with their recorded classifications");
  });

  it("still says 'only deterministic findings' when that is actually true", () => {
    const auditResult = createExampleAuditResult();
    auditResult.findings = [
      { ...createExampleFinding(), id: "det", determinism: "deterministic", resultKind: "risk" }
    ];
    auditResult.advisoryScore = scoreFindings(auditResult.findings);
    const report = renderMarkdownReport({ auditResult });
    expect(report).toContain("only contains deterministic audit findings");
  });

  it("treats layoutMetrics as optional and closes its distribution subobject", () => {
    const withoutBlock = createExampleAuditResult();
    expect(validateSchema("audit-result", withoutBlock).valid).toBe(true);

    const withBlock = {
      ...createExampleAuditResult(),
      layoutMetrics: [
        {
          viewport: "desktop",
          properties: [
            {
              property: "border-radius",
              sampledElementCount: 12,
              distinctValueCount: 2,
              values: [
                { value: "8px", count: 9 },
                { value: "0px", count: 3 }
              ],
              truncatedValueCount: 0
            }
          ]
        }
      ]
    };
    expect(validateSchema("audit-result", withBlock).valid).toBe(true);

    const withUnknownKey = JSON.parse(JSON.stringify(withBlock));
    withUnknownKey.layoutMetrics[0].properties[0].bogus = 1;
    expect(validateSchema("audit-result", withUnknownKey).valid).toBe(false);
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
    expect(findingMetadataForCheck("unapproved-font-family")).toMatchObject({
      criterionId: "visual.font-family.project-contract",
      determinism: "deterministic",
      resultKind: "risk",
      runtime: "computed-style",
      confidence: "high",
      humanReviewRecommended: false
    });
    expect(findingMetadataForCheck("off-palette-color")).toMatchObject({
      criterionId: "visual.color.project-contract",
      determinism: "deterministic",
      resultKind: "risk",
      runtime: "computed-style",
      confidence: "high",
      humanReviewRecommended: false
    });
  });

  it("locks the parser-free copy criteria metadata", () => {
    const expected = [
      ["placeholder-leak", "content.placeholder.unrendered", "official-testable", "failure"],
      ["josa-hedge", "content.josa-hedge.policy", "project-contract", "risk"],
      ["glossary-banned-term", "content.glossary.banned-term", "project-contract", "risk"],
      ["glossary-use-carefully-term", "content.glossary.use-carefully-term", "project-contract", "risk"],
      ["banned-phrase", "content.banned-phrase.policy", "project-contract", "risk"]
    ] as const;

    for (const [checkName, criterionId, sourceStrength, resultKind] of expected) {
      expect(findingMetadataForCheck(checkName)).toMatchObject({
        criterionId,
        determinism: "deterministic",
        resultKind,
        runtime: "static-dom",
        confidence: "high",
        humanReviewRecommended: false
      });
      expect(getCriterion(criterionId)).toMatchObject({ sourceStrength });
    }

    expect(getCriterion("content.placeholder.unrendered")?.sourceRefs).toEqual([
      "unicode-icu-messageformat",
      "mustache-spec",
      "design-harness-output-contract"
    ]);
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

  it("keeps legacy v1 integrity reference-based and rejects unknown finding references", () => {
    const auditResult = createLegacyV1AuditResult();
    auditResult.advisoryScore.value = 12;
    auditResult.advisoryScore.band = "blocked";
    auditResult.advisoryScore.deductions[0]!.points = 99;
    expect(validateAuditResultIntegrity(auditResult)).toEqual({ valid: true, issues: [] });

    auditResult.advisoryScore.deductions[0].findingId = "missing-finding";
    const result = validateAuditResultIntegrity(auditResult);
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.path).toContain("deductions");
  });

  it("recomputes every derived v2 score field and canonical ordering", () => {
    const auditResult = createMultiGroupV2AuditResult();
    expect(validateAuditResultIntegrity(auditResult)).toEqual({ valid: true, issues: [] });

    const mutations: Array<{
      name: string;
      path: string;
      mutate: (score: ReturnType<typeof requireV2Score>) => void;
    }> = [
      {
        name: "duplicate member",
        path: "findingIds",
        mutate: (score) => score.deductions[0]!.findingIds.push(score.deductions[0]!.findingIds[0]!)
      },
      {
        name: "unknown member",
        path: "findingIds",
        mutate: (score) => { score.deductions[0]!.findingIds[0] = "unknown-finding"; }
      },
      {
        name: "member assigned to two groups",
        path: "findingIds",
        mutate: (score) => score.deductions[1]!.findingIds.push(score.deductions[0]!.findingIds[0]!)
      },
      {
        name: "wrong representative",
        path: "findingId",
        mutate: (score) => { score.deductions[1]!.findingId = "finding-z"; }
      },
      {
        name: "wrong group maximum",
        path: "points",
        mutate: (score) => { score.deductions[1]!.points += 1; }
      },
      {
        name: "wrong member order",
        path: "findingIds",
        mutate: (score) => score.deductions[1]!.findingIds.reverse()
      },
      {
        name: "wrong viewport list",
        path: "viewports",
        mutate: (score) => score.deductions[1]!.viewports.reverse()
      },
      {
        name: "wrong group order",
        path: "deductions",
        mutate: (score) => score.deductions.reverse()
      },
      {
        name: "wrong total",
        path: "totalDeduction",
        mutate: (score) => { score.totalDeduction += 1; }
      },
      {
        name: "wrong saturation",
        path: "saturated",
        mutate: (score) => { score.saturated = !score.saturated; }
      },
      {
        name: "wrong value",
        path: "value",
        mutate: (score) => { score.value += 1; }
      },
      {
        name: "wrong band",
        path: "band",
        mutate: (score) => { score.band = "blocked"; }
      }
    ];

    for (const mutation of mutations) {
      const malformed = createMultiGroupV2AuditResult();
      mutation.mutate(requireV2Score(malformed));
      const result = validateAuditResultIntegrity(malformed);
      expect(result.valid, mutation.name).toBe(false);
      expect(result.issues.some((issue) => issue.path.includes(mutation.path)), mutation.name).toBe(true);
    }
  });

  it("rejects score-exempt needs-review membership in v2 deductions", () => {
    const auditResult = createMultiGroupV2AuditResult();
    const needsReview = createCopyFinding("saturated-color-noise-risk", ["iso-9241-210"], {
      id: "needs-review-finding",
      category: "hierarchy"
    });
    auditResult.findings.push(needsReview);
    requireV2Score(auditResult).deductions[0]!.findingIds.push(needsReview.id);

    const result = validateAuditResultIntegrity(auditResult);
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({
      path: expect.stringContaining("findingIds"),
      message: expect.stringContaining("score-exempt needs-review")
    }));
  });

  it("rejects an unknown advisory score formula at the integrity seam", () => {
    const auditResult = createExampleAuditResult();
    (auditResult.advisoryScore as { formulaVersion: string }).formulaVersion = "unknown-formula";
    const result = validateAuditResultIntegrity(auditResult);
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({
      path: "$.advisoryScore.formulaVersion"
    }));
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

  it("accepts exact placeholder source-family subsets and rejects registry outsiders", () => {
    for (const sourceRef of ["unicode-icu-messageformat", "mustache-spec", "design-harness-output-contract"]) {
      const auditResult = createExampleAuditResult();
      const finding = createCopyFinding("placeholder-leak", [sourceRef]);
      auditResult.findings = [finding];
      auditResult.advisoryScore = scoreFindings([finding]);
      expect(validateAuditResultIntegrity(auditResult)).toEqual({ valid: true, issues: [] });
    }

    const auditResult = createExampleAuditResult();
    const finding = createCopyFinding("placeholder-leak", ["wcag-2-2"]);
    auditResult.findings = [finding];
    auditResult.advisoryScore = scoreFindings([finding]);
    const result = validateAuditResultIntegrity(auditResult);
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({
      path: "$.findings[0].sourceRefs[0]",
      message: "is not declared by criterion content.placeholder.unrendered"
    }));
  });
});

describe("scoring", () => {
  it("deducts deterministic risk points by severity, confidence, and epistemic weight", () => {
    const score = scoreFindings([createExampleFinding()]);
    expect(score.formulaVersion).toBe("epistemic-criterion-max-v2");
    expect(score.value).toBe(94);
    expect(score.band).toBe("strong");
    expect(score.deductions[0]).toMatchObject({
      findingId: "finding-desktop-overflow",
      findingIds: ["finding-desktop-overflow"],
      viewports: ["desktop"],
      points: 6
    });
    expect(score.deductions[0]?.reason).toContain("deterministic risk score weight 0.6");
    expect(score.totalDeduction).toBe(6);
    expect(score.saturated).toBe(false);
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
      expect.objectContaining({
        findingId: "legacy-unclassified",
        findingIds: ["legacy-unclassified"],
        points: 2.5
      }),
      expect.objectContaining({
        findingId: "deterministic-failure",
        findingIds: ["deterministic-failure", "deterministic-risk", "heuristic-risk"],
        points: 10
      })
    ]);
    expect(score.deductions.flatMap((deduction) => deduction.findingIds)).not.toContain("needs-review");
    expect(score.deductions.find((deduction) => deduction.findingId === "legacy-unclassified")?.reason).toContain("legacy/unclassified");
    expect(score.totalDeduction).toBe(12.5);
    expect(score.value).toBe(87.5);
  });

  it("bounds one, five, and 500 equal occurrences to one criterion maximum", () => {
    for (const count of [1, 5, 500]) {
      const findings = Array.from({ length: count }, (_unused, index) => ({
        ...createExampleFinding(),
        id: `criterion-occurrence-${String(index).padStart(3, "0")}`,
        viewport: index % 2 === 0 ? "desktop" : "mobile"
      }));
      const score = scoreFindings(findings);

      expect(score.value, `${count} occurrences`).toBe(94);
      expect(score.totalDeduction, `${count} occurrences`).toBe(6);
      expect(score.deductions, `${count} occurrences`).toHaveLength(1);
      expect(score.deductions[0]?.findingIds, `${count} occurrences`).toHaveLength(count);
      expect(score.deductions[0]?.viewports, `${count} occurrences`).toEqual(
        count === 1 ? ["desktop"] : ["desktop", "mobile"]
      );
    }
  });

  it("selects the strongest occurrence and the lowest UTF-16 finding id on equal points", () => {
    const equalSupplementary = {
      ...createExampleFinding(),
      id: "finding-\u{10000}",
      severity: "medium" as const,
      viewport: "mobile"
    };
    const equalBmp = {
      ...createExampleFinding(),
      id: "finding-\uE000",
      severity: "medium" as const,
      viewport: "desktop"
    };
    const stronger = {
      ...createExampleFinding(),
      id: "finding-stronger",
      severity: "high" as const,
      confidence: "medium" as const
    };

    const tied = scoreFindings([equalBmp, equalSupplementary]);
    expect(tied.deductions[0]).toMatchObject({
      findingId: "finding-\u{10000}",
      findingIds: ["finding-\u{10000}", "finding-\uE000"],
      viewports: ["desktop", "mobile"],
      points: 6
    });

    const withStrongerOccurrence = scoreFindings([equalBmp, stronger, equalSupplementary]);
    expect(withStrongerOccurrence.deductions[0]).toMatchObject({
      findingId: "finding-stronger",
      points: 9
    });
  });

  it("normalizes groups, members, and viewports independently of input order", () => {
    const supplementaryGroup = {
      ...createContentFinding({ id: "member-z", checkName: "group-\u{10000}", viewport: "mobile" }),
      determinism: "deterministic" as const,
      resultKind: "risk" as const
    };
    const supplementaryGroupSecond = {
      ...supplementaryGroup,
      id: "member-a",
      viewport: "desktop"
    };
    const bmpGroup = {
      ...createContentFinding({ id: "member-bmp", checkName: "group-\uE000" }),
      determinism: "deterministic" as const,
      resultKind: "risk" as const
    };
    const findings = [bmpGroup, supplementaryGroup, supplementaryGroupSecond];

    const forward = scoreFindings(findings);
    const reversed = scoreFindings([...findings].reverse());

    expect(JSON.stringify(forward)).toBe(JSON.stringify(reversed));
    expect(forward.deductions.map((deduction) => deduction.findingId)).toEqual(["member-a", "member-bmp"]);
    expect(forward.deductions[0]?.findingIds).toEqual(["member-a", "member-z"]);
    expect(forward.deductions[0]?.viewports).toEqual(["desktop", "mobile"]);
  });

  it("adds distinct criterion/check-name groups and uses checkName for legacy findings", () => {
    const criterionFinding = createExampleFinding();
    const otherCriterion = {
      ...criterionFinding,
      id: "other-criterion",
      criterionId: "another.criterion",
      checkName: "same-check"
    };
    const legacyOne = createContentFinding({ id: "legacy-one", checkName: "legacy-check" });
    const legacyTwo = createContentFinding({ id: "legacy-two", checkName: "legacy-check", severity: "high" });
    const score = scoreFindings([criterionFinding, otherCriterion, legacyOne, legacyTwo]);

    expect(score.deductions).toHaveLength(3);
    expect(score.deductions.find((deduction) => deduction.findingIds.includes("legacy-one"))).toMatchObject({
      findingId: "legacy-two",
      findingIds: ["legacy-one", "legacy-two"],
      points: 5
    });
    expect(score.totalDeduction).toBe(17);
    expect(score.value).toBe(83);
  });

  it("keeps a criterion separate from a legacy check with the same text key", () => {
    const criterionFinding = {
      ...createExampleFinding(),
      id: "criterion-member",
      criterionId: "shared.group.key",
      checkName: "registered-check"
    };
    const legacyFinding = createContentFinding({
      id: "legacy-member",
      checkName: "shared.group.key"
    });

    const score = scoreFindings([legacyFinding, criterionFinding]);

    expect(score.deductions).toHaveLength(2);
    expect(score.deductions.map((deduction) => deduction.findingIds)).toEqual([
      ["criterion-member"],
      ["legacy-member"]
    ]);
    expect(score.totalDeduction).toBe(8.5);
  });

  it("distinguishes exact-zero remainder from a saturated pre-floor total", () => {
    const failure = (id: string, severity: "critical" | "high" | "medium") => ({
      ...createContentFinding({ id, checkName: id, severity }),
      determinism: "deterministic" as const,
      resultKind: "failure" as const
    });
    const exact = scoreFindings([
      failure("critical-a", "critical"),
      failure("critical-b", "critical"),
      failure("high", "high"),
      failure("medium", "medium")
    ]);
    expect(exact).toMatchObject({ totalDeduction: 100, value: 0, saturated: false, band: "blocked" });

    const saturated = scoreFindings([
      failure("critical-a", "critical"),
      failure("critical-b", "critical"),
      failure("critical-c", "critical")
    ]);
    expect(saturated).toMatchObject({ totalDeduction: 105, value: 0, saturated: true, band: "blocked" });
  });

  it("locks deductions for the five parser-free copy checks", () => {
    const findings = [
      createCopyFinding("placeholder-leak", ["unicode-icu-messageformat"], { severity: "high" }),
      createCopyFinding("josa-hedge", ["copy-style-contract"], { severity: "low" }),
      createCopyFinding("glossary-banned-term", ["copy-style-contract"], { severity: "medium" }),
      createCopyFinding("glossary-use-carefully-term", ["copy-style-contract"], { severity: "low" }),
      createCopyFinding("banned-phrase", ["copy-style-contract"], { severity: "medium" })
    ].map((finding, index) => ({ ...finding, id: `${finding.id}-${index}` }));

    const score = scoreFindings(findings);
    expect(score.deductions.map((deduction) => deduction.points)).toEqual([6, 6, 2.4, 2.4, 20]);
    expect(score.value).toBe(63.2);
    expect(score.band).toBe("needs-work");
  });

  it("validates closed formula-discriminated v1 and v2 score shapes under schema 0.2", () => {
    const auditResult = createExampleAuditResult();
    expect(auditResult.schemaVersion).toBe("0.2");
    expect(auditResult.advisoryScore.formulaVersion).toBe("epistemic-criterion-max-v2");
    expect(validateSchema("audit-result", auditResult).valid).toBe(true);

    const legacyAudit = createLegacyV1AuditResult();
    expect(validateSchema("audit-result", legacyAudit).valid).toBe(true);

    const missingFormulaVersion = {
      ...auditResult,
      advisoryScore: {
        ...auditResult.advisoryScore
      } as Record<string, unknown>
    };
    delete missingFormulaVersion.advisoryScore.formulaVersion;
    expect(validateSchema("audit-result", missingFormulaVersion).valid).toBe(false);

    const unknownFormulaVersion = {
      ...auditResult,
      advisoryScore: {
        ...auditResult.advisoryScore,
        formulaVersion: "unknown-formula"
      }
    };
    expect(validateSchema("audit-result", unknownFormulaVersion).valid).toBe(false);

    const v1WithV2Fields = structuredClone(legacyAudit) as unknown as {
      advisoryScore: Record<string, unknown> & { deductions: Array<Record<string, unknown>> };
    };
    v1WithV2Fields.advisoryScore.totalDeduction = 6;
    v1WithV2Fields.advisoryScore.saturated = false;
    v1WithV2Fields.advisoryScore.deductions[0]!.findingIds = ["finding-desktop-overflow"];
    v1WithV2Fields.advisoryScore.deductions[0]!.viewports = ["desktop"];
    expect(validateSchema("audit-result", v1WithV2Fields).valid).toBe(false);

    for (const missingField of ["totalDeduction", "saturated"] as const) {
      const malformed = structuredClone(auditResult) as unknown as {
        advisoryScore: Record<string, unknown>;
      };
      delete malformed.advisoryScore[missingField];
      expect(validateSchema("audit-result", malformed).valid, missingField).toBe(false);
    }

    for (const missingField of ["findingIds", "viewports"] as const) {
      const malformed = structuredClone(auditResult) as unknown as {
        advisoryScore: { deductions: Array<Record<string, unknown>> };
      };
      delete malformed.advisoryScore.deductions[0]![missingField];
      expect(validateSchema("audit-result", malformed).valid, missingField).toBe(false);
    }
  });
});

describe("report rendering", () => {
  it("returns section titles from the same conditional report assembly", () => {
    const auditResult = createExampleAuditResult();
    const baseReport = buildMarkdownReport({ auditResult });

    expect(baseReport.sections).toEqual([
      "Run Summary",
      "Advisory Score",
      "Findings",
      "Source-Backed Criteria",
      "Evidence Links",
      "Recommendations",
      "Iteration Prompt Scaffold",
      "Optional Subjective Critique"
    ]);
    expect(baseReport.markdown).not.toContain("## Failed Checks");
    expect(baseReport.markdown).not.toContain("## Notices");
    expect(baseReport.markdown).toContain("## Optional Subjective Critique");
    expect(baseReport.markdown).toContain("No subjective critique was supplied.");

    const conditionalReport = buildMarkdownReport({
      auditResult: {
        ...auditResult,
        failedChecks: ["desktop:screenshot"],
        notices: [{
          code: "copy-surface-unsupported-adapter",
          message: "A configured surface adapter is unavailable."
        }]
      },
      critique: {
        schemaVersion: auditResult.schemaVersion,
        harnessVersion: auditResult.harnessVersion,
        id: "critique-example",
        auditRunId: auditResult.runId,
        summary: "Review the visual hierarchy.",
        evidenceRefs: [],
        recommendations: ["Clarify the primary action."],
        createdAt: "2026-01-01T00:00:00.000Z"
      }
    });

    expect(conditionalReport.sections).toEqual([
      "Run Summary",
      "Failed Checks",
      "Notices",
      "Advisory Score",
      "Findings",
      "Source-Backed Criteria",
      "Evidence Links",
      "Recommendations",
      "Iteration Prompt Scaffold",
      "Optional Subjective Critique"
    ]);
    for (const title of conditionalReport.sections) {
      expect(conditionalReport.markdown).toContain(`## ${title}`);
    }
  });

  it("includes score, deterministic findings, evidence, and prompt scaffold", () => {
    const auditResult = createExampleAuditResult();
    const report = renderMarkdownReport({ auditResult });
    expect(report).toContain("Advisory Score");
    expect(report).toContain("Findings");
    expect(report).toContain("Deterministic Findings: Risks");
    expect(report).toContain("Source-Backed Criteria");
    expect(report).toContain("Sources used by emitted findings");
    expect(report).toContain("[Web Content Accessibility Guidelines 2.2](https://www.w3.org/TR/WCAG22/)");
    expect(report).toContain("Criterion: `responsive.horizontal-overflow.none`");
    expect(report).toContain("Evidence: `screenshot-desktop`, `measurement-desktop`");
    expect(report).toContain("Evidence Links");
    expect(report).toContain("Iteration Prompt Scaffold");
    expect(validateReportCopyGuardrails(report)).toEqual([]);
  });

  it("renders v2 formula, grouped rationale, total, saturation, occurrences, and viewports", () => {
    const auditResult = createMultiGroupV2AuditResult();
    const report = renderMarkdownReport({ auditResult });

    expect(report).toContain("Formula: `epistemic-criterion-max-v2`");
    expect(report).toContain("one maximum scoreable occurrence per criterion");
    expect(report).toContain("Grouped pre-floor total deduction: 14.5");
    expect(report).toContain("Saturation: no");
    expect(report).toContain("2 occurrences; viewports: `desktop`, `mobile`");
    expect(report).toContain("representative: `finding-a`");
    expect(report).toContain("Maximum scoreable occurrence for criterion responsive.horizontal-overflow.none");
    expect(report).toContain("v1 and v2 values are not directly comparable");
    expect(validateReportCopyGuardrails(report)).toEqual([]);

    const saturatedFindings = Array.from({ length: 3 }, (_unused, index) => ({
      ...createContentFinding({
        id: `critical-${index}`,
        checkName: `critical-${index}`,
        severity: "critical"
      }),
      determinism: "deterministic" as const,
      resultKind: "failure" as const
    }));
    auditResult.findings = saturatedFindings;
    auditResult.advisoryScore = scoreFindings(saturatedFindings);
    const saturatedReport = renderMarkdownReport({ auditResult });
    expect(saturatedReport).toContain("Grouped pre-floor total deduction: 105");
    expect(saturatedReport).toContain("Saturation: yes");
    expect(saturatedReport).toContain("floored at 0");
  });

  it("fails report rendering when a v2 representative is absent", () => {
    const auditResult = createExampleAuditResult();
    const score = requireV2Score(auditResult);
    score.deductions[0] = {
      ...score.deductions[0],
      findingId: "missing-representative"
    };

    expect(() => renderMarkdownReport({ auditResult })).toThrow(
      "Advisory score deduction references unknown representative missing-representative"
    );
  });

  it("renders legacy v1 formula details without reading v2-only fields", () => {
    const report = renderMarkdownReport({ auditResult: createLegacyV1AuditResult() });
    expect(report).toContain("Formula: `epistemic-weight-v1`");
    expect(report).toContain("legacy per-finding deductions");
    expect(report).not.toContain("Grouped pre-floor total deduction");
    expect(report).not.toContain("Saturation:");
    expect(report).toContain("v1 and v2 values are not directly comparable");
  });

  it("renders notices only when they are non-empty", () => {
    const auditResult = createExampleAuditResult();
    expect(renderMarkdownReport({ auditResult })).not.toContain("## Notices");
    expect(renderMarkdownReport({ auditResult: { ...auditResult, notices: [] } })).not.toContain("## Notices");

    const report = renderMarkdownReport({
      auditResult: {
        ...auditResult,
        notices: [
          {
            code: "copy-surface-unsupported-adapter",
            message: "A configured surface adapter is unavailable.",
            viewport: "desktop",
            details: { adapter: "native-ui", value: "button", ruleIndex: 0, matcherIndex: 1 }
          }
        ]
      }
    });

    expect(report).toContain("## Notices");
    expect(report).toContain("`copy-surface-unsupported-adapter`");
    expect(report).toContain("do not affect the audit score or status");
    expect(validateReportCopyGuardrails(report)).toEqual([]);
  });

  it("reports only source families used by emitted placeholder findings", () => {
    const families = [
      ["design-harness-output-contract", "Design Harness output contract", ["Unicode ICU MessageFormat", "Mustache specification"]],
      ["unicode-icu-messageformat", "Unicode ICU MessageFormat", ["Design Harness output contract", "Mustache specification"]],
      ["mustache-spec", "Mustache specification", ["Design Harness output contract", "Unicode ICU MessageFormat"]]
    ] as const;

    for (const [sourceRef, expectedTitle, excludedTitles] of families) {
      const auditResult = createExampleAuditResult();
      const finding = createCopyFinding("placeholder-leak", [sourceRef]);
      auditResult.findings = [finding];
      auditResult.advisoryScore = scoreFindings([finding]);
      const criterionLine = renderMarkdownReport({ auditResult })
        .split("\n")
        .find((line) => line.includes("`content.placeholder.unrendered`") && line.includes("Sources used by emitted findings"));

      expect(criterionLine).toContain(expectedTitle);
      for (const excludedTitle of excludedTitles) {
        expect(criterionLine).not.toContain(excludedTitle);
      }
    }

    const auditResult = createExampleAuditResult();
    const icuFinding = createCopyFinding("placeholder-leak", ["unicode-icu-messageformat"], { id: "placeholder-icu" });
    const mustacheFinding = createCopyFinding("placeholder-leak", ["mustache-spec"], { id: "placeholder-mustache" });
    auditResult.findings = [icuFinding, mustacheFinding];
    auditResult.advisoryScore = scoreFindings(auditResult.findings);
    const criterionLine = renderMarkdownReport({ auditResult })
      .split("\n")
      .find((line) => line.includes("`content.placeholder.unrendered`") && line.includes("Sources used by emitted findings"));
    expect(criterionLine).toContain("Unicode ICU MessageFormat");
    expect(criterionLine).toContain("Mustache specification");
    expect(criterionLine).not.toContain("Design Harness output contract");
  });

  it("builds a model-neutral iteration prompt", () => {
    const prompt = buildIterationPrompt(createExampleAuditResult());
    expect(prompt).toContain("Use the deterministic findings");
    expect(prompt).not.toContain("Codex");
  });

  it("includes only deterministic failures and risks in the iteration prompt", () => {
    const auditResult = createExampleAuditResult();
    auditResult.findings = [
      createPromptFinding("heuristic-risk", { determinism: "heuristic", resultKind: "risk" }),
      createContentFinding({ id: "legacy-unclassified" }),
      createCopyFinding("placeholder-leak", ["unicode-icu-messageformat"], {
        id: "deterministic-failure",
        problem: "Problem deterministic-failure.",
        recommendation: "Recommendation deterministic-failure."
      }),
      createPromptFinding("deterministic-needs-review", { resultKind: "needs-review" }),
      createPromptFinding("low-confidence-deterministic-risk", {
        severity: "low",
        confidence: "low"
      }),
      createPromptFinding("heuristic-needs-review", {
        determinism: "heuristic",
        resultKind: "needs-review"
      }),
      createPromptFinding("subjective-needs-review", {
        determinism: "subjective",
        resultKind: "needs-review"
      })
    ];

    const prompt = buildIterationPrompt(auditResult);

    expect(prompt).toContain("deterministic-failure");
    expect(prompt).toContain("low-confidence-deterministic-risk");
    for (const excludedId of [
      "heuristic-risk",
      "legacy-unclassified",
      "deterministic-needs-review",
      "heuristic-needs-review",
      "subjective-needs-review"
    ]) {
      expect(prompt).not.toContain(excludedId);
    }
  });

  it("prioritizes adapter failures, other failures, and deterministic risks before applying the cap", () => {
    const auditResult = createExampleAuditResult();
    auditResult.findings = [
      createPromptFinding("low-confidence-risk", { severity: "critical", confidence: "low" }),
      createPromptFinding("risk-high-high", { severity: "high", confidence: "high" }),
      createRegisteredPromptFinding("other-failure", "placeholder-leak", { severity: "low" }),
      createRegisteredPromptFinding("blank-render", "blank-render", { severity: "high" }),
      createRegisteredPromptFinding("render-failure", "render-failure", { severity: "critical" }),
      createPromptFinding("risk-critical-medium", { severity: "critical", confidence: "medium" }),
      createPromptFinding("risk-high-medium", { severity: "high", confidence: "medium" }),
      createPromptFinding("risk-medium-high", { severity: "medium", confidence: "high" })
    ];

    const prompt = buildIterationPrompt(auditResult);
    const orderedIds = [
      "render-failure",
      "blank-render",
      "other-failure",
      "risk-critical-medium",
      "risk-high-high"
    ];

    const promptOrder = orderedIds.map((id) => prompt.indexOf(id));
    expect(promptOrder.every((index) => index >= 0)).toBe(true);
    expect(promptOrder).toEqual([...promptOrder].sort((left, right) => left - right));
    expect(prompt.split("\n").filter((line) => line.startsWith("- "))).toHaveLength(5);
    expect(prompt).not.toContain("risk-high-medium");
    expect(prompt).not.toContain("risk-medium-high");
    expect(prompt).not.toContain("low-confidence-risk");
  });

  it("keeps producer order for equal-priority findings without mutating the audit result", () => {
    const auditResult = createExampleAuditResult();
    auditResult.findings = [
      createPromptFinding("tie-b"),
      createPromptFinding("tie-a")
    ];
    const before = structuredClone(auditResult.findings);

    const prompt = buildIterationPrompt(auditResult);

    expect(prompt.indexOf("tie-b")).toBeLessThan(prompt.indexOf("tie-a"));
    expect(auditResult.findings).toEqual(before);
  });

  it("uses the fallback when no deterministic failure or risk is eligible", () => {
    const auditResult = createExampleAuditResult();
    auditResult.findings = [
      createPromptFinding("heuristic-only", { determinism: "heuristic", resultKind: "risk" }),
      createPromptFinding("needs-review-only", { resultKind: "needs-review" }),
      createContentFinding({ id: "legacy-only" })
    ];

    const prompt = buildIterationPrompt(auditResult);

    expect(prompt).toContain("No blocking deterministic findings were detected");
    expect(prompt).not.toContain("heuristic-only");
    expect(prompt).not.toContain("needs-review-only");
    expect(prompt).not.toContain("legacy-only");
  });

  it("routes content category findings to the content implementation area", () => {
    const contentFinding = createCopyFinding("placeholder-leak", ["unicode-icu-messageformat"], {
      id: "finding-desktop-overflow",
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

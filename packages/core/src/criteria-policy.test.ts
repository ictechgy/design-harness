import { describe, expect, it } from "vitest";
import {
  getCriterion,
  validateCriteriaPolicy,
  validateRegistryCriteriaPolicy,
  type Criterion,
  type CriterionSource
} from "./index.js";

const SOURCES: CriterionSource[] = [
  {
    id: "official-testable-source",
    title: "Official testable source",
    url: "https://example.com/official-testable",
    strength: "official-testable"
  },
  {
    id: "industry-source",
    title: "Industry heuristic source",
    url: "https://example.com/industry",
    strength: "industry-heuristic"
  },
  {
    id: "research-source",
    title: "Research emerging source",
    url: "https://example.com/research",
    strength: "research-emerging"
  },
  {
    id: "contract-source",
    title: "Project-declared contract",
    url: "docs/example-contract.md",
    strength: "project-contract"
  }
];

function makeCriterion(overrides: Partial<Criterion>): Criterion {
  return {
    id: "test.criterion.example",
    category: "accessibility",
    title: "Test criterion",
    description: "Synthetic criterion for policy tests.",
    sourceRefs: ["official-testable-source"],
    sourceStrength: "official-testable",
    determinism: "deterministic",
    resultKind: "risk",
    confidenceDefault: "medium",
    runtime: "static-dom",
    checkNames: ["test-check"],
    remediationHint: "Fix the synthetic issue.",
    ...overrides
  };
}

describe("criteria policy matrix", () => {
  it("accepts the shipped registry", () => {
    const result = validateRegistryCriteriaPolicy();
    expect(result.issues).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("allows deterministic failures only for official-testable criteria", () => {
    const official = makeCriterion({ resultKind: "failure" });
    expect(validateCriteriaPolicy([official], SOURCES).valid).toBe(true);

    const industry = makeCriterion({
      sourceRefs: ["industry-source"],
      sourceStrength: "industry-heuristic",
      resultKind: "failure"
    });
    const result = validateCriteriaPolicy([industry], SOURCES);
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.message).toContain('exceeds the "risk" ceiling');
  });

  it("caps project-contract criteria at deterministic risk", () => {
    const allowed = makeCriterion({
      sourceRefs: ["contract-source"],
      sourceStrength: "project-contract",
      resultKind: "risk"
    });
    expect(validateCriteriaPolicy([allowed], SOURCES).valid).toBe(true);

    const failure = makeCriterion({
      sourceRefs: ["contract-source"],
      sourceStrength: "project-contract",
      resultKind: "failure"
    });
    expect(validateCriteriaPolicy([failure], SOURCES).valid).toBe(false);
  });

  it("keeps shipped copy-style criteria at the project-contract risk ceiling", () => {
    for (const criterionId of [
      "content.josa-hedge.policy",
      "content.glossary.banned-term",
      "content.glossary.use-carefully-term",
      "content.banned-phrase.policy"
    ]) {
      expect(getCriterion(criterionId)).toMatchObject({
        sourceRefs: ["copy-style-contract"],
        sourceStrength: "project-contract",
        determinism: "deterministic",
        resultKind: "risk",
        runtime: "static-dom"
      });
    }

    expect(getCriterion("content.placeholder.unrendered")).toMatchObject({
      sourceStrength: "official-testable",
      determinism: "deterministic",
      resultKind: "failure",
      runtime: "static-dom"
    });
  });

  it("rejects heuristic and subjective failures at the criterion level", () => {
    const heuristic = makeCriterion({ determinism: "heuristic", resultKind: "failure" });
    expect(validateCriteriaPolicy([heuristic], SOURCES).valid).toBe(false);

    const subjective = makeCriterion({ determinism: "subjective", resultKind: "risk" });
    expect(validateCriteriaPolicy([subjective], SOURCES).valid).toBe(false);
  });

  it("rejects deterministic determinism for research-emerging and philosophical criteria", () => {
    const research = makeCriterion({
      sourceRefs: ["research-source"],
      sourceStrength: "research-emerging",
      determinism: "deterministic",
      resultKind: "risk"
    });
    const result = validateCriteriaPolicy([research], SOURCES);
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.message).toContain('determinism "deterministic" is not allowed');
  });

  it("requires model-judged runtime criteria to be subjective needs-review", () => {
    const wrong = makeCriterion({ runtime: "model-judged", determinism: "deterministic", resultKind: "risk" });
    const result = validateCriteriaPolicy([wrong], SOURCES);
    expect(result.issues.some((issue) => issue.message.includes('requires determinism "subjective"'))).toBe(true);

    const right = makeCriterion({
      runtime: "model-judged",
      determinism: "subjective",
      resultKind: "needs-review"
    });
    expect(validateCriteriaPolicy([right], SOURCES).valid).toBe(true);
  });

  it("requires the declared sourceStrength to be backed by a referenced source", () => {
    const unbacked = makeCriterion({ sourceRefs: ["industry-source"], resultKind: "failure" });
    const result = validateCriteriaPolicy([unbacked], SOURCES);
    expect(result.issues.some((issue) => issue.message.includes("is not backed by any referenced source"))).toBe(true);
  });

  it("matches project-contract strength exactly instead of via the official ladder", () => {
    const borrowed = makeCriterion({
      sourceRefs: ["official-testable-source"],
      sourceStrength: "project-contract",
      resultKind: "risk"
    });
    expect(validateCriteriaPolicy([borrowed], SOURCES).valid).toBe(false);

    const lent = makeCriterion({
      sourceRefs: ["contract-source"],
      sourceStrength: "industry-heuristic",
      determinism: "heuristic",
      resultKind: "risk"
    });
    expect(validateCriteriaPolicy([lent], SOURCES).valid).toBe(false);
  });

  it("reports unknown sourceRefs", () => {
    const criterion = makeCriterion({ sourceRefs: ["missing-source"] });
    const result = validateCriteriaPolicy([criterion], SOURCES);
    expect(result.issues.some((issue) => issue.message.includes('unknown source "missing-source"'))).toBe(true);
  });
});

describe("criteria policy clause maps", () => {
  const wcagSource: CriterionSource = {
    id: "wcag-2-2",
    title: "WCAG 2.2",
    url: "https://www.w3.org/TR/WCAG22/",
    strength: "official-testable",
    clausesByCriterion: { "test.criterion.example": ["1.4.3"] }
  };

  it("accepts a fully mapped source", () => {
    const criterion = makeCriterion({ sourceRefs: ["wcag-2-2"] });
    expect(validateCriteriaPolicy([criterion], [wcagSource]).valid).toBe(true);
  });

  it("requires every criterion citing a clause-mapped source to be mapped", () => {
    const unmapped = makeCriterion({ id: "test.criterion.other", sourceRefs: ["wcag-2-2"] });
    const mapped = makeCriterion({ sourceRefs: ["wcag-2-2"] });
    const result = validateCriteriaPolicy([mapped, unmapped], [wcagSource]);
    expect(result.issues.some((issue) => issue.path === "criterion.test.criterion.other")).toBe(true);
  });

  it("rejects clause entries for unknown or non-citing criteria", () => {
    const nonCiting = makeCriterion({ sourceRefs: ["official-testable-source"] });
    const result = validateCriteriaPolicy([nonCiting], [...SOURCES, wcagSource]);
    expect(result.issues.some((issue) => issue.message.includes("does not reference this source"))).toBe(true);

    const orphanMap: CriterionSource = { ...wcagSource, clausesByCriterion: { "test.criterion.ghost": ["1.1.1"] } };
    const orphanResult = validateCriteriaPolicy([], [orphanMap]);
    expect(orphanResult.issues.some((issue) => issue.message.includes('unknown criterion "test.criterion.ghost"'))).toBe(
      true
    );
  });

  it("reports an empty clause array exactly once, with the non-empty message", () => {
    const emptyMap: CriterionSource = { ...wcagSource, clausesByCriterion: { "test.criterion.example": [] } };
    const criterion = makeCriterion({ sourceRefs: ["wcag-2-2"] });
    const result = validateCriteriaPolicy([criterion], [emptyMap]);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.message).toContain("must be non-empty");
  });

  it("rejects malformed WCAG success-criterion ids", () => {
    const badMap: CriterionSource = { ...wcagSource, clausesByCriterion: { "test.criterion.example": ["1.4"] } };
    const criterion = makeCriterion({ sourceRefs: ["wcag-2-2"] });
    const result = validateCriteriaPolicy([criterion], [badMap]);
    expect(result.issues.some((issue) => issue.message.includes("is not a WCAG success-criterion id"))).toBe(true);
  });
});

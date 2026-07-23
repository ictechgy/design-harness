import type { Finding } from "@design-harness/core";
import { describe, expect, it } from "vitest";
import {
  FAILURE_PROGRESS_VERSION,
  computeDeterministicFailureProgress
} from "./loop-progress.js";

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "generated-id",
    category: "accessibility",
    severity: "high",
    confidence: "high",
    viewport: "desktop",
    selector: "html",
    evidenceRefs: ["measurement-desktop"],
    problem: "problem",
    recommendation: "recommendation",
    checkName: "page-lang-missing",
    criterionId: "semantic.page-language.present",
    sourceRefs: ["wcag22:3.1.1"],
    determinism: "deterministic",
    resultKind: "failure",
    runtime: "static-dom",
    region: { x: 0, y: 0, width: 1, height: 1 },
    observed: false,
    expected: true,
    ...overrides
  };
}

describe("computeDeterministicFailureProgress", () => {
  it("returns the version, exact count, and a stable SHA-256 fingerprint", () => {
    const progress = computeDeterministicFailureProgress([
      finding({ viewport: "mobile", selector: undefined }),
      finding()
    ]);
    expect(progress).toEqual({
      version: FAILURE_PROGRESS_VERSION,
      count: 2,
      fingerprint: "00d6ec56ceeffb95a4ba0979b0c8d946e1c9d778a09f19ed301bb1cf58f7d5a8"
    });
  });

  it("ignores finding order and presentation, evidence, geometry, and generated ids", () => {
    const first = finding();
    const second = finding({
      id: "second-id",
      selector: "body > main",
      viewport: "mobile"
    });
    const baseline = computeDeterministicFailureProgress([first, second]);
    const regenerated = computeDeterministicFailureProgress([
      {
        ...second,
        id: "regenerated-2",
        evidenceRefs: ["other-evidence"],
        problem: "different problem copy",
        recommendation: "different recommendation",
        region: { x: 100, y: 200, width: 300, height: 400 },
        observed: { arbitrary: "value" },
        expected: "different"
      },
      {
        ...first,
        id: "regenerated-1",
        evidenceRefs: [],
        region: undefined,
        severity: "critical",
        confidence: "medium"
      }
    ]);
    expect(regenerated).toEqual(baseline);
  });

  it("ignores non-failures regardless of their identity", () => {
    const baseline = computeDeterministicFailureProgress([finding()]);
    const withExcludedFindings = computeDeterministicFailureProgress([
      finding(),
      finding({ id: "det-risk", determinism: "deterministic", resultKind: "risk", selector: "#risk" }),
      finding({ id: "heuristic-risk", determinism: "heuristic", resultKind: "risk", selector: "#heuristic" }),
      finding({ id: "heuristic-review", determinism: "heuristic", resultKind: "needs-review", selector: "#review" }),
      finding({ id: "subjective", determinism: "subjective", resultKind: "needs-review", selector: "#subjective" })
    ]);
    expect(withExcludedFindings).toEqual(baseline);
  });

  it.each([
    ["criterion", { criterionId: "other.criterion" }],
    ["check", { checkName: "other-check" }],
    ["viewport", { viewport: "mobile" }],
    ["selector", { selector: "body" }]
  ] as const)("changes when the %s tuple field changes", (_label, changed) => {
    const baseline = computeDeterministicFailureProgress([finding()]);
    expect(computeDeterministicFailureProgress([finding(changed)]).fingerprint)
      .not.toBe(baseline.fingerprint);
  });

  it("preserves multiset multiplicity, including identical tuples", () => {
    const once = computeDeterministicFailureProgress([finding()]);
    const twice = computeDeterministicFailureProgress([
      finding({ id: "one" }),
      finding({ id: "two" })
    ]);
    expect(once.count).toBe(1);
    expect(twice.count).toBe(2);
    expect(twice.fingerprint).not.toBe(once.fingerprint);
  });

  it("uses empty tuple members for absent criterion and selector", () => {
    const withoutOptionalIdentity = computeDeterministicFailureProgress([
      finding({ criterionId: undefined, selector: undefined })
    ]);
    expect(withoutOptionalIdentity.count).toBe(1);
    expect(withoutOptionalIdentity.fingerprint).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("sorts tuple fields by UTF-16 code units rather than Unicode code points", () => {
    const progress = computeDeterministicFailureProgress([
      finding({ criterionId: "\ue000", checkName: "check", selector: undefined }),
      finding({ criterionId: "😀", checkName: "check", selector: undefined })
    ]);
    // UTF-16 places the emoji's leading high surrogate before U+E000; code-point order would be reversed.
    expect(progress.fingerprint).toBe(
      "59db9891fd752127f63bdc18d64c1abc3889ceaf7443d800f77ad8dfeca803de"
    );
  });
});

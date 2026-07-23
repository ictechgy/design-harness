import { describe, expect, it } from "vitest";
import type { Finding } from "@design-harness/core";
import {
  FINDING_COVERAGE_CHECK_NAMES,
  assertFindingCoverageIntegrity,
  findingSamplesTruncatedNotice,
  type FindingCoverage
} from "./finding-coverage.js";

describe("finding coverage integrity", () => {
  it("allows absent diagnostics and validates the exact inventory against materialized findings", () => {
    expect(() => assertFindingCoverageIntegrity(undefined, "desktop", [])).not.toThrow();

    const coverage = coverageFor("desktop", {
      "text-clipping": { detectedCount: 7, emittedCount: 5 },
      "tap-target-risk": { detectedCount: 1, emittedCount: 1 }
    });
    const findings = [
      ...Array.from({ length: 5 }, () => finding("text-clipping")),
      finding("tap-target-risk")
    ];

    expect(() => assertFindingCoverageIntegrity(coverage, "desktop", findings)).not.toThrow();
  });

  it.each([
    ["viewport mismatch", (coverage: FindingCoverage) => { coverage.viewport = "mobile"; }],
    ["missing entry", (coverage: FindingCoverage) => { coverage.entries.pop(); }],
    ["duplicate check", (coverage: FindingCoverage) => {
      coverage.entries[coverage.entries.length - 1] = { ...coverage.entries[0]! };
    }],
    ["unknown check", (coverage: FindingCoverage) => {
      coverage.entries[0] = { ...coverage.entries[0]!, checkName: "not-a-check" };
    }],
    ["negative count", (coverage: FindingCoverage) => { coverage.entries[0]!.detectedCount = -1; }],
    ["fractional count", (coverage: FindingCoverage) => { coverage.entries[0]!.detectedCount = 0.5; }],
    ["inconsistent total", (coverage: FindingCoverage) => { coverage.entries[0]!.detectedCount = 1; }],
    ["zero limit", (coverage: FindingCoverage) => { coverage.entries[0]!.limit = 0; }],
    ["incorrect limit", (coverage: FindingCoverage) => { coverage.entries[0]!.limit = 6; }],
    ["emitted over limit", (coverage: FindingCoverage) => {
      Object.assign(coverage.entries[0]!, { detectedCount: 6, emittedCount: 6, omittedCount: 0 });
    }],
    ["wrong heading cap group", (coverage: FindingCoverage) => {
      const entry = coverage.entries.find(({ checkName }) => checkName === "empty-heading")!;
      delete entry.capGroup;
    }],
    ["unexpected non-heading cap group", (coverage: FindingCoverage) => {
      coverage.entries[0]!.capGroup = "headingIssues";
    }]
  ])("rejects %s", (_label, mutate) => {
    const coverage = coverageFor("desktop");
    mutate(coverage);
    expect(() => assertFindingCoverageIntegrity(coverage, "desktop", [])).toThrow(/Invalid finding coverage/);
  });

  it("rejects emitted counts that do not match materialized findings", () => {
    const coverage = coverageFor("desktop", {
      "text-clipping": { detectedCount: 1, emittedCount: 1 }
    });
    expect(() => assertFindingCoverageIntegrity(coverage, "desktop", [])).toThrow(/materialized findings/);
  });

  it("rejects heading emitted counts above their shared five-finding cap", () => {
    const coverage = coverageFor("desktop", {
      "empty-heading": { detectedCount: 2, emittedCount: 2 },
      "heading-level-skip": { detectedCount: 2, emittedCount: 2 },
      "duplicate-h1": { detectedCount: 2, emittedCount: 2 }
    });
    const findings = [
      ...Array.from({ length: 2 }, () => finding("empty-heading")),
      ...Array.from({ length: 2 }, () => finding("heading-level-skip")),
      ...Array.from({ length: 2 }, () => finding("duplicate-h1"))
    ];

    expect(() => assertFindingCoverageIntegrity(coverage, "desktop", findings)).toThrow(/capGroup "headingIssues"/);
  });

  it("keeps font-family and unreachable aggregate checks outside the exact inventory", () => {
    expect(FINDING_COVERAGE_CHECK_NAMES).toHaveLength(20);
    expect(FINDING_COVERAGE_CHECK_NAMES).not.toContain("unapproved-font-family");
    expect(FINDING_COVERAGE_CHECK_NAMES).not.toContain("repeated-visual-weight-risk");
    expect(FINDING_COVERAGE_CHECK_NAMES).not.toContain("saturated-color-noise-risk");
    expect(FINDING_COVERAGE_CHECK_NAMES).not.toContain("checklist-state-visibility-risk");
  });
});

describe("finding truncation notice", () => {
  it("summarizes multiple omitted checks once with stable UTF-16 check ordering", () => {
    const coverage = coverageFor("desktop", {
      "text-clipping": { detectedCount: 8, emittedCount: 5 },
      "dom-contrast-risk": { detectedCount: 25, emittedCount: 5 }
    });

    const notice = findingSamplesTruncatedNotice([coverage]);

    expect(notice).toMatchObject({
      code: "finding-samples-truncated",
      details: {
        viewports: [{
          viewport: "desktop",
          checks: [
            { checkName: "dom-contrast-risk", detectedCount: 25, emittedCount: 5, omittedCount: 20, limit: 5 },
            { checkName: "text-clipping", detectedCount: 8, emittedCount: 5, omittedCount: 3, limit: 5 }
          ]
        }]
      }
    });
    expect(notice).not.toHaveProperty("viewport");
  });

  it("keeps two viewports separate and sorts them by UTF-16 code units", () => {
    const notice = findingSamplesTruncatedNotice([
      coverageFor("mobile", { "tap-target-risk": { detectedCount: 6, emittedCount: 5 } }),
      coverageFor("desktop", { "text-clipping": { detectedCount: 6, emittedCount: 5 } })
    ]);
    const details = notice?.details as { viewports: Array<{ viewport: string }> };

    expect(details.viewports.map(({ viewport }) => viewport)).toEqual(["desktop", "mobile"]);
  });

  it("emits no notice at or below each limit", () => {
    const coverage = coverageFor("desktop", {
      "text-clipping": { detectedCount: 5, emittedCount: 5 },
      "tap-target-risk": { detectedCount: 3, emittedCount: 3 }
    });

    expect(findingSamplesTruncatedNotice([coverage])).toBeUndefined();
  });
});

function coverageFor(
  viewport: string,
  counts: Partial<Record<string, { detectedCount: number; emittedCount: number }>> = {}
): FindingCoverage {
  return {
    viewport,
    entries: FINDING_COVERAGE_CHECK_NAMES.map((checkName) => {
      const count = counts[checkName] ?? { detectedCount: 0, emittedCount: 0 };
      return {
        checkName,
        ...(isHeadingCheck(checkName) ? { capGroup: "headingIssues" } : {}),
        detectedCount: count.detectedCount,
        emittedCount: count.emittedCount,
        omittedCount: count.detectedCount - count.emittedCount,
        limit: 5
      };
    })
  };
}

function isHeadingCheck(checkName: string): boolean {
  return checkName === "empty-heading" || checkName === "heading-level-skip" || checkName === "duplicate-h1";
}

function finding(checkName: string): Finding {
  return {
    id: `finding-${checkName}`,
    category: "accessibility",
    severity: "low",
    confidence: "high",
    viewport: "desktop",
    evidenceRefs: [],
    problem: "test",
    recommendation: "test",
    checkName
  };
}

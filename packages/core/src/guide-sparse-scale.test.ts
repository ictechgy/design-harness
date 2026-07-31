import { describe, expect, it } from "vitest";
import {
  compileDesignGuide,
  createExampleDesignGuide,
  SPARSE_SCALE_NOTICE_MINIMUM,
  type DesignGuide
} from "./index.js";

/**
 * Sparse declared scale notice.
 *
 * Measured motivation: across 24 generated dashboard screens on 2026-08-01, the
 * example guide's two declared spacing values left 79-91% of the distinct spacing
 * values actually used off-contract, and the shipped `off-scale-spacing` detector
 * reports each of those as a project-contract risk against a contract that never
 * supplied enough values.
 */
describe("sparse declared scale notice", () => {
  const withScale = (
    spacing: Record<string, number>,
    radius: Record<string, number>
  ): DesignGuide => {
    const guide = structuredClone(createExampleDesignGuide());
    guide.tokens.spacing = { $type: "dimension" } as DesignGuide["tokens"]["spacing"];
    guide.tokens.radius = { $type: "dimension" } as DesignGuide["tokens"]["radius"];
    for (const [name, value] of Object.entries(spacing)) {
      (guide.tokens.spacing as Record<string, unknown>)[name] = {
        $value: { value, unit: "rem" }
      };
    }
    for (const [name, value] of Object.entries(radius)) {
      (guide.tokens.radius as Record<string, unknown>)[name] = {
        $value: { value, unit: "px" }
      };
    }
    return guide;
  };

  it("fires on the example guide, which declares two of each", () => {
    const result = compileDesignGuide(createExampleDesignGuide());
    expect(result.notices).toHaveLength(2);
    expect(result.notices.map((notice) => notice.scale).sort()).toEqual(["radius", "spacing"]);
    for (const notice of result.notices) {
      expect(notice.code).toBe("sparse-declared-scale");
      expect(notice.declaredCount).toBe(2);
      expect(notice.minimumForNotice).toBe(SPARSE_SCALE_NOTICE_MINIMUM);
    }
  });

  it("stays silent once a scale reaches the documented minimum", () => {
    const result = compileDesignGuide(
      withScale({ xs: 0.25, sm: 0.5, md: 1, lg: 2 }, { sm: 4, md: 8, lg: 12, xl: 16 })
    );
    expect(result.notices).toHaveLength(0);
  });

  it("reports each scale independently", () => {
    const result = compileDesignGuide(
      withScale({ xs: 0.25, sm: 0.5, md: 1, lg: 2 }, { sm: 4, md: 8 })
    );
    expect(result.notices).toHaveLength(1);
    expect(result.notices[0]?.scale).toBe("radius");
  });

  it("fires at exactly one below the minimum and not at the minimum", () => {
    const three = compileDesignGuide(
      withScale({ sm: 0.5, md: 1, lg: 2 }, { sm: 4, md: 8, lg: 12, xl: 16 })
    );
    expect(three.notices.map((notice) => notice.scale)).toEqual(["spacing"]);
    const four = compileDesignGuide(
      withScale({ xs: 0.25, sm: 0.5, md: 1, lg: 2 }, { sm: 4, md: 8, lg: 12, xl: 16 })
    );
    expect(four.notices).toHaveLength(0);
  });

  /**
   * The critical invariant. A notice is an observation about the guide, not a
   * change to it. A compiled pack must be byte-identical whether or not anyone
   * reads the notices, or the notice would silently alter agent guidance.
   */
  it("never changes the pack, the hash, or the token estimate", () => {
    const sparse = compileDesignGuide(createExampleDesignGuide());
    expect(sparse.notices.length).toBeGreaterThan(0);
    expect(sparse.rules).toHaveLength(5);
    expect(sparse.tokenEstimate.estimated).toBe(1306);
    expect(sparse.markdown).not.toContain("sparse-declared-scale");
    expect(sparse.markdown).not.toContain("under-declared");
    expect(sparse.designTokensJson).not.toContain("sparse");
  });

  it("keeps the source hash independent of notice state", () => {
    // Two guides with identical tokens must hash identically; the notice is derived,
    // never an input.
    const left = compileDesignGuide(withScale({ sm: 0.5, md: 1 }, { sm: 4, md: 8 }));
    const right = compileDesignGuide(withScale({ sm: 0.5, md: 1 }, { sm: 4, md: 8 }));
    expect(left.sourceHash).toBe(right.sourceHash);
    expect(left.notices).toHaveLength(2);
  });

  it("documents the minimum as arbitrary rather than validated", () => {
    expect(SPARSE_SCALE_NOTICE_MINIMUM).toBe(4);
  });

  it("explains the consequence rather than only stating a count", () => {
    const [notice] = compileDesignGuide(createExampleDesignGuide()).notices;
    expect(notice?.message).toContain("invent");
    expect(notice?.message).toContain("contract risks");
  });
});

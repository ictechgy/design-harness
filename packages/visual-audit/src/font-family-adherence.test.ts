import { describe, expect, it } from "vitest";
import type { FontFamilyAdherencePolicy } from "@design-harness/core";
import { analyzeFontFamilyAdherence } from "./font-family-adherence.js";
import { MAX_FONT_FAMILY_DIAGNOSTIC_SCALARS } from "./font-family.js";
import type { TextInventoryItem } from "./checks.js";

const policy: FontFamilyAdherencePolicy = {
  policyId: "font-family-adherence-v1",
  allowedFamilies: [
    { value: "Inter", kind: "named" },
    { value: "sans-serif", kind: "generic" }
  ],
  ignoreSelectors: []
};

describe("font-family adherence aggregation", () => {
  it("returns an observable clean summary when every computed member is approved", () => {
    const result = analyzeFontFamilyAdherence(
      [item("#clean", '"INTER", SANS-SERIF')],
      policy,
      { evaluatedElementCount: 1, ignoredElementCount: 0 }
    );

    expect(result).toEqual({
      ok: true,
      summary: {
        policyId: "font-family-adherence-v1",
        allowedFamilies: policy.allowedFamilies,
        evaluatedElementCount: 1,
        ignoredElementCount: 0,
        violatingElementCount: 0,
        distinctViolationStackCount: 0,
        emittedStackCount: 0,
        truncated: false,
        stacks: []
      }
    });
  });

  it("groups raw stacks, ranks by affected count, and caps stacks and samples", () => {
    const items = [
      ...Array.from({ length: 7 }, (_, index) => item(`#many-${index}`, '"Unexpected A", sans-serif')),
      item("#b", '"Unexpected B", sans-serif'),
      item("#c", '"Unexpected C", sans-serif'),
      item("#d", '"Unexpected D", sans-serif'),
      item("#e", '"Unexpected E", sans-serif'),
      item("#f", '"Unexpected F", sans-serif')
    ];
    const result = analyzeFontFamilyAdherence(
      items,
      policy,
      { evaluatedElementCount: items.length, ignoredElementCount: 0 }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary).toMatchObject({
      violatingElementCount: 12,
      distinctViolationStackCount: 6,
      emittedStackCount: 5,
      truncated: true
    });
    expect(result.summary.stacks.map((stack) => stack.rawStack)).toEqual([
      '"Unexpected A", sans-serif',
      '"Unexpected B", sans-serif',
      '"Unexpected C", sans-serif',
      '"Unexpected D", sans-serif',
      '"Unexpected E", sans-serif'
    ]);
    expect(result.summary.stacks[0]).toMatchObject({
      affectedElementCount: 7,
      selectors: ["#many-0", "#many-1", "#many-2", "#many-3", "#many-4"]
    });
    expect(result.summary.stacks[0]?.regions).toHaveLength(5);
  });

  it("keeps different raw stacks distinct and deduplicates unexpected members per stack", () => {
    const result = analyzeFontFamilyAdherence([
      item("#one", '"Other", "Other", sans-serif'),
      item("#two", "Other, sans-serif")
    ], policy, { evaluatedElementCount: 2, ignoredElementCount: 0 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.distinctViolationStackCount).toBe(2);
    expect(result.summary.stacks[0]?.unexpectedFamilies).toEqual([{ value: "Other", kind: "named" }]);
  });

  it("fails the scoped analysis for invalid serialization or inconsistent capture counts", () => {
    expect(analyzeFontFamilyAdherence(
      [item("#bad", "Inter,,sans-serif")],
      policy,
      { evaluatedElementCount: 1, ignoredElementCount: 0 }
    )).toMatchObject({
      ok: false,
      error: { code: "unparsable-computed-family", elementIndex: 0 }
    });

    expect(analyzeFontFamilyAdherence(
      [item("#clean", "Inter")],
      policy,
      { evaluatedElementCount: 0, ignoredElementCount: 0 }
    )).toEqual({ ok: false, error: { code: "evidence-count-mismatch" } });
  });

  it("preserves the bounded raw stack while bounding decoded display strings", () => {
    const longUnexpected = `Family-${"x".repeat(200)}`;
    const longSelector = `#${"s".repeat(400)}`;
    const rawStack = `"${longUnexpected}", sans-serif`;
    const result = analyzeFontFamilyAdherence(
      [item(longSelector, rawStack)],
      policy,
      { evaluatedElementCount: 1, ignoredElementCount: 0 }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.stacks[0]!.rawStack).toBe(rawStack);
    expect([...result.summary.stacks[0]!.unexpectedFamilies[0]!.value.slice(0, -1)]).toHaveLength(
      MAX_FONT_FAMILY_DIAGNOSTIC_SCALARS
    );
    expect(result.summary.stacks[0]!.unexpectedFamilies[0]).toMatchObject({ truncated: true });
    expect([...result.summary.stacks[0]!.selectors[0]!.slice(0, -1)]).toHaveLength(
      MAX_FONT_FAMILY_DIAGNOSTIC_SCALARS
    );
  });
});

function item(selector: string, fontFamily: string): TextInventoryItem {
  return {
    selector,
    text: "Visible text",
    region: { x: 10, y: 20, width: 200, height: 24 },
    fontSize: 16,
    fontWeight: "400",
    nearestLang: "en",
    tag: "p",
    role: "",
    accessibleName: "Visible text",
    fontFamily
  };
}

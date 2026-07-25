import { describe, expect, it } from "vitest";
import {
  analyzeSpacingAdherence,
  type SpacingAdherenceCandidate,
  type SpacingAdherenceCollectionCounts
} from "./spacing-adherence.js";

const policy = {
  allowedValues: [
    { value: 4, unit: "px" as const },
    { value: 0.5, unit: "rem" as const },
    { value: 12, unit: "px" as const }
  ],
  ignoreSelectors: [],
  policyId: "spacing-adherence-v1" as const
};

describe("analyzeSpacingAdherence", () => {
  it("matches px, viewport-relative rem, implicit zero, negative margin magnitude, and resolved numeric values", () => {
    const candidates = [
      candidate({ property: "padding-top", valuePx: 4 }),
      candidate({ property: "column-gap", valuePx: 8 }),
      candidate({ property: "padding-left", valuePx: 0 }),
      candidate({ property: "margin-right", valuePx: -8 }),
      candidate({ property: "row-gap", valuePx: 12 }),
      candidate({ property: "margin-bottom", valuePx: 7.999 })
    ];
    const result = analyzeSpacingAdherence(
      candidates,
      policy,
      counts(10, 2, 2, {
        "auto-margin": 1,
        "normal-gap": 1
      }),
      16
    );

    expect(result).toEqual({
      ok: true,
      summary: {
        policyId: "spacing-adherence-v1",
        allowedValuesPx: [4, 8, 12],
        rootFontSizePx: 16,
        candidateSlotCount: 10,
        evaluatedSlotCount: 6,
        ignoredSlotCount: 2,
        ignoredByReason: { "selector-exception": 2 },
        skippedSlotCount: 2,
        skippedByReason: { "auto-margin": 1, "normal-gap": 1 },
        violatingSlotCount: 0,
        distinctViolationGroupCount: 0,
        emittedGroupCount: 0,
        truncatedGroupCount: 0,
        groups: []
      }
    });
  });

  it("converts fractional rem at each root size and applies an inclusive 0.001 CSS-px tolerance", () => {
    const fractionalPolicy = {
      ...policy,
      allowedValues: [{ value: 0.333333, unit: "rem" as const }]
    };
    const atSixteen = analyzeSpacingAdherence(
      [candidate({ valuePx: 5.333328 })],
      fractionalPolicy,
      counts(1),
      16
    );
    const atSeventeen = analyzeSpacingAdherence(
      [
        candidate({ selector: "#exact", valuePx: 5.666661 }),
        candidate({ selector: "#boundary", valuePx: 5.667661 }),
        candidate({ selector: "#outside", valuePx: 5.667662 })
      ],
      fractionalPolicy,
      counts(3),
      17
    );

    expect(atSixteen.ok && atSixteen.summary.allowedValuesPx).toEqual([5.333328]);
    expect(atSixteen.ok && atSixteen.summary.violatingSlotCount).toBe(0);
    expect(atSeventeen.ok && atSeventeen.summary.allowedValuesPx).toHaveLength(1);
    expect(atSeventeen.ok && atSeventeen.summary.allowedValuesPx[0]).toBeCloseTo(5.666661, 12);
    expect(atSeventeen.ok && atSeventeen.summary.violatingSlotCount).toBe(1);
    expect(atSeventeen.ok && atSeventeen.summary.groups[0]).toMatchObject({
      unexpectedValuePx: 5.667662,
      affectedSlotCount: 1
    });
  });

  it("retains signed unexpected margins and keeps equal values on different properties distinct", () => {
    const candidates = [
      candidate({ selector: "#negative", property: "margin-top", valuePx: -10 }),
      candidate({ selector: "#padding", property: "padding-top", valuePx: 10 })
    ];
    const result = analyzeSpacingAdherence(candidates, policy, counts(2), 16);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.groups).toEqual([
      {
        property: "margin-top",
        unexpectedValuePx: -10,
        affectedSlotCount: 1,
        selectors: ["#negative"],
        regions: [candidate().region],
        sampleCount: 1,
        omittedSampleCount: 0
      },
      {
        property: "padding-top",
        unexpectedValuePx: 10,
        affectedSlotCount: 1,
        selectors: ["#padding"],
        regions: [candidate().region],
        sampleCount: 1,
        omittedSampleCount: 0
      }
    ]);
  });

  it("canonicalizes signed zero and decimal numeric serializations", () => {
    const result = analyzeSpacingAdherence(
      [
        candidate({ selector: "#negative-zero", valuePx: -0 }),
        candidate({ selector: "#decimal-a", property: "margin-top", valuePx: 10 }),
        candidate({ selector: "#decimal-b", property: "margin-top", valuePx: 10.0 })
      ],
      { ...policy, allowedValues: [{ value: -0, unit: "px" as const }] },
      counts(3),
      16
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.is(result.summary.allowedValuesPx[0], -0)).toBe(false);
    expect(result.summary.groups).toHaveLength(1);
    expect(result.summary.groups[0]).toMatchObject({
      unexpectedValuePx: 10,
      affectedSlotCount: 2,
      sampleCount: 2
    });
  });

  it("caps groups and samples while retaining exact violation accounting", () => {
    const repeated = Array.from({ length: 7 }, (_, index) => candidate({
      selector: `#repeated-${index}`,
      property: "margin-top",
      valuePx: 20
    }));
    const distinct = Array.from({ length: 6 }, (_, index) => candidate({
      selector: `#distinct-${index}`,
      property: "padding-right",
      valuePx: 30 + index
    }));
    const candidates = [...repeated, ...distinct];
    const result = analyzeSpacingAdherence(candidates, policy, counts(candidates.length), 16);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary).toMatchObject({
      candidateSlotCount: 13,
      evaluatedSlotCount: 13,
      violatingSlotCount: 13,
      distinctViolationGroupCount: 7,
      emittedGroupCount: 5,
      truncatedGroupCount: 2
    });
    expect(result.summary.groups[0]).toMatchObject({
      property: "margin-top",
      unexpectedValuePx: 20,
      affectedSlotCount: 7,
      sampleCount: 5,
      omittedSampleCount: 2
    });
    expect(result.summary.groups[0]?.selectors).toHaveLength(5);
  });

  it("fails closed for negative padding/gap and nonfinite candidate evidence", () => {
    for (const invalidCandidate of [
      candidate({ property: "padding-bottom", valuePx: -4 }),
      candidate({ property: "row-gap", valuePx: -4 }),
      candidate({ property: "column-gap", valuePx: Number.NaN })
    ]) {
      expect(analyzeSpacingAdherence(
        [invalidCandidate],
        policy,
        counts(1),
        16
      )).toEqual({ ok: false, error: { code: "invalid-candidate" } });
    }
  });

  it("fails closed for absent, nonfinite, or nonpositive root-font evidence", () => {
    for (const rootFontSizePx of [undefined, Number.NaN, Number.POSITIVE_INFINITY, 0, -16]) {
      expect(analyzeSpacingAdherence(
        [],
        policy,
        counts(0),
        rootFontSizePx
      )).toEqual({ ok: false, error: { code: "invalid-root-font-size" } });
    }
  });

  it("fails closed for invalid policies and collection-count mismatches", () => {
    expect(analyzeSpacingAdherence(
      [],
      { ...policy, allowedValues: [] },
      counts(0),
      16
    )).toEqual({ ok: false, error: { code: "invalid-policy" } });

    expect(analyzeSpacingAdherence(
      [],
      { ...policy, allowedValues: [{ value: -1, unit: "px" as const }] },
      counts(0),
      16
    )).toEqual({ ok: false, error: { code: "invalid-policy" } });

    expect(analyzeSpacingAdherence(
      [candidate()],
      policy,
      counts(2),
      16
    )).toEqual({ ok: false, error: { code: "evidence-count-mismatch" } });

    expect(analyzeSpacingAdherence(
      [],
      policy,
      counts(1, 0, 1, { "normal-gap": 2 }),
      16
    )).toEqual({ ok: false, error: { code: "evidence-count-mismatch" } });
  });
});

function candidate(
  overrides: Partial<SpacingAdherenceCandidate> = {}
): SpacingAdherenceCandidate {
  return {
    selector: "#sample",
    region: { x: 10, y: 20, width: 100, height: 30 },
    property: "margin-top",
    valuePx: 4,
    ...overrides
  };
}

function counts(
  candidateSlotCount: number,
  ignoredSlotCount = 0,
  skippedSlotCount = 0,
  skippedByReason: SpacingAdherenceCollectionCounts["skippedByReason"] = {}
): SpacingAdherenceCollectionCounts {
  return {
    candidateSlotCount,
    ignoredSlotCount,
    skippedSlotCount,
    skippedByReason
  };
}

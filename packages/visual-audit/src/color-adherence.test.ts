import { describe, expect, it } from "vitest";
import {
  analyzeColorAdherence,
  parsedColorToRgba8,
  type ColorAdherenceCandidate
} from "./color-adherence.js";

const policy = {
  allowedColors: [
    { red: 20, green: 20, blue: 26, alpha: 255 },
    { red: 255, green: 255, blue: 255, alpha: 255 }
  ],
  ignoreSelectors: [],
  policyId: "color-adherence-v1" as const
};

describe("analyzeColorAdherence", () => {
  it("keeps exact allowed RGBA8 values silent while accounting for ignored and skipped slots", () => {
    const result = analyzeColorAdherence([
      candidate({ property: "color", value: "rgb(20, 20, 26)" }),
      candidate({ property: "border-left-color", value: "RGB(20 20 26 / 100%)" }),
      candidate({ property: "background-color", value: "rgb(255, 255, 255)" }),
      candidate({ property: "border-top-color", value: "rgba(0, 0, 0, 0)" }),
      candidate({ property: "border-right-color", value: "color(display-p3 1 0 0)" }),
      candidate({ property: "border-bottom-color", value: "oklch(0.5 0.2 20)" }),
      candidate({ property: "background-color", value: "not-a-color" })
    ], policy, {
      candidateSlotCount: 9,
      ignoredSlotCount: 2,
      skippedSlotCount: 0,
      skippedByReason: {}
    });

    expect(result).toEqual({
      ok: true,
      summary: {
        policyId: "color-adherence-v1",
        allowedColors: policy.allowedColors,
        candidateSlotCount: 9,
        evaluatedSlotCount: 3,
        ignoredSlotCount: 3,
        ignoredByReason: { "selector-exception": 2, transparent: 1 },
        skippedSlotCount: 3,
        skippedByReason: { "unsupported-color": 3 },
        violatingSlotCount: 0,
        distinctViolationGroupCount: 0,
        emittedGroupCount: 0,
        truncatedGroupCount: 0,
        groups: []
      }
    });
  });

  it("groups by property and exact color with five samples and exact omission counts", () => {
    const candidates = [
      ...Array.from({ length: 7 }, (_, index) => candidate({
        selector: `#text-${index}`,
        property: "color",
        value: index % 2 === 0 ? "rgb(1, 2, 3)" : "color(srgb 0.0039215686 0.0078431373 0.011764706)"
      })),
      candidate({ selector: "#background", property: "background-color", value: "rgb(1, 2, 3)" })
    ];
    const result = analyzeColorAdherence(
      candidates,
      policy,
      {
        candidateSlotCount: candidates.length,
        ignoredSlotCount: 0,
        skippedSlotCount: 0,
        skippedByReason: {}
      }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary).toMatchObject({
      candidateSlotCount: 8,
      evaluatedSlotCount: 8,
      violatingSlotCount: 8,
      distinctViolationGroupCount: 2,
      emittedGroupCount: 2,
      truncatedGroupCount: 0
    });
    expect(result.summary.groups[0]).toMatchObject({
      property: "color",
      unexpectedColor: { red: 1, green: 2, blue: 3, alpha: 255 },
      affectedSlotCount: 7,
      sampleCount: 5,
      omittedSampleCount: 2
    });
    expect(result.summary.groups[0]?.selectors).toHaveLength(5);
    expect(result.summary.groups[0]?.rawComputedValues).toHaveLength(2);
    expect(result.summary.groups[1]).toMatchObject({
      property: "background-color",
      affectedSlotCount: 1,
      omittedSampleCount: 0
    });
  });

  it("caps groups at five and records the exact truncated group count", () => {
    const candidates = Array.from({ length: 7 }, (_, index) => candidate({
      selector: `#paint-${index}`,
      property: "background-color",
      value: `rgb(${index + 1}, 2, 3)`
    }));
    const result = analyzeColorAdherence(
      candidates,
      policy,
      {
        candidateSlotCount: 7,
        ignoredSlotCount: 0,
        skippedSlotCount: 0,
        skippedByReason: {}
      }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.groups).toHaveLength(5);
    expect(result.summary).toMatchObject({
      distinctViolationGroupCount: 7,
      emittedGroupCount: 5,
      truncatedGroupCount: 2
    });
  });

  it("fails closed when collection counts or policy bytes are invalid", () => {
    expect(analyzeColorAdherence(
      [candidate()],
      policy,
      {
        candidateSlotCount: 2,
        ignoredSlotCount: 0,
        skippedSlotCount: 0,
        skippedByReason: {}
      }
    )).toEqual({ ok: false, error: { code: "evidence-count-mismatch" } });

    expect(analyzeColorAdherence(
      [],
      { ...policy, allowedColors: [{ red: -1, green: 0, blue: 0, alpha: 255 }] },
      {
        candidateSlotCount: 0,
        ignoredSlotCount: 0,
        skippedSlotCount: 0,
        skippedByReason: {}
      }
    )).toEqual({ ok: false, error: { code: "invalid-policy" } });
  });

  it("uses exact clamp-and-round RGBA8 identity", () => {
    expect(parsedColorToRgba8({
      red: -0.1,
      green: 127.5,
      blue: 300,
      alpha: 0.501
    })).toEqual({ red: 0, green: 128, blue: 255, alpha: 128 });
  });
});

function candidate(overrides: Partial<ColorAdherenceCandidate> = {}): ColorAdherenceCandidate {
  return {
    selector: "#sample",
    region: { x: 10, y: 20, width: 100, height: 30 },
    property: "color",
    value: "rgb(20, 20, 26)",
    ...overrides
  };
}

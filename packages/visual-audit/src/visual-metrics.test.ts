import {
  DENSITY_COMPLEXITY_BUDGET_POLICY_ID,
  DENSITY_COMPLEXITY_METHOD_ID,
  DENSITY_TEXT_CLUSTER_METHOD_ID,
  DENSITY_VISIBLE_ELEMENT_METHOD_ID,
  PALETTE_DISCIPLINE_BUDGET_POLICY_ID,
  PALETTE_DISCIPLINE_METHOD_ID,
  TYPOGRAPHY_VARIANT_BUDGET_POLICY_ID,
  TYPOGRAPHY_VARIANT_METHOD_ID,
  type DensityComplexityBudgetPolicy,
  type PaletteDisciplineBudgetPolicy,
  type TypographyVariantBudgetPolicy
} from "@design-harness/core";
import { describe, expect, it } from "vitest";
import type {
  DensityComplexityCollection,
  DensityTextFragment,
  PaletteDisciplineCandidate,
  PaletteDisciplineCollectionCounts,
  TypographyVariantCandidate,
  TypographyVariantCollectionCounts,
  VisualMetricRegion
} from "./browser-measurements.js";
import {
  analyzeDensityComplexity,
  analyzePaletteDiscipline,
  analyzeTypographyVariants
} from "./visual-metrics.js";

describe("analyzeTypographyVariants", () => {
  it("keeps exact totals while bounding and deterministically ordering variants and locations", () => {
    const commonSelectors = ["#z", "#a", "#m", "#\uE000", "#😀", "#b"];
    const candidates = [
      ...commonSelectors.map((selector) => typographyCandidate({ selector })),
      ...[17, 18, 19, 20, 21].map((size, index) => typographyCandidate({
        selector: `#unique-${index}`,
        fontSize: `${size}px`
      }))
    ];
    const result = analyzeTypographyVariants(
      candidates,
      typographyPolicy(),
      typographyCounts(candidates.length, { ignored: 2 })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.summary).toMatchObject({
      policyId: TYPOGRAPHY_VARIANT_BUDGET_POLICY_ID,
      methodId: TYPOGRAPHY_VARIANT_METHOD_ID,
      maxDistinctVariants: 8,
      coverage: "complete",
      candidateElementCount: 13,
      collectedElementCount: 11,
      evaluatedElementCount: 11,
      ignoredElementCount: 2,
      skippedElementCount: 0,
      distinctVariantCount: 6,
      emittedVariantCount: 5,
      omittedVariantCount: 1
    });
    expect(result.summary.variants[0]).toMatchObject({
      affectedElementCount: 6,
      emittedLocationCount: 5,
      omittedLocationCount: 1
    });
    expect(result.summary.variants[0].locations.map((location) => location.selector)).toEqual([
      "#a",
      "#b",
      "#m",
      "#z",
      "#\uE000"
    ]);
  });

  it("adds typed Node normalization skips to browser skips and marks the count lower-bound", () => {
    const candidates = [
      typographyCandidate({ selector: "#valid" }),
      typographyCandidate({ selector: "#invalid", fontSize: "calc(1rem)" })
    ];
    const result = analyzeTypographyVariants(
      candidates,
      typographyPolicy(),
      typographyCounts(candidates.length, {
        ignored: 1,
        skipped: 1,
        skippedByReason: { "font-family-too-long": 1 }
      })
    );

    expect(result).toMatchObject({
      ok: true,
      summary: {
        coverage: "lower-bound",
        candidateElementCount: 4,
        collectedElementCount: 2,
        evaluatedElementCount: 1,
        ignoredElementCount: 1,
        skippedElementCount: 2,
        skippedByReason: {
          "font-family-too-long": 1,
          "invalid-font-size": 1
        },
        distinctVariantCount: 1
      }
    });
  });

  it("is input-order stable for equal-frequency Unicode identities and locations", () => {
    const candidates = [
      typographyCandidate({ selector: "#😀", fontFamily: "\"😀\"" }),
      typographyCandidate({ selector: "#\uE000", fontFamily: "\"\uE000\"" })
    ];
    const forward = analyzeTypographyVariants(
      candidates,
      typographyPolicy(),
      typographyCounts(2)
    );
    const reverse = analyzeTypographyVariants(
      [...candidates].reverse(),
      typographyPolicy(),
      typographyCounts(2)
    );

    expect(reverse).toEqual(forward);
    expect(forward.ok && forward.summary.variants.map(
      (variant) => variant.locations[0].selector
    )).toEqual(["#\uE000", "#😀"]);
  });

  it("rejects forged policies, malformed candidates, and every accounting mismatch", () => {
    const candidate = typographyCandidate();
    const validCounts = typographyCounts(1);
    const invalidPolicy = {
      ...typographyPolicy(),
      methodId: "forged"
    } as unknown as TypographyVariantBudgetPolicy;

    expect(analyzeTypographyVariants([candidate], invalidPolicy, validCounts))
      .toEqual({ ok: false, error: { code: "invalid-policy" } });
    expect(analyzeTypographyVariants(
      [{ ...candidate, region: { ...candidate.region, width: 0 } }],
      typographyPolicy(),
      validCounts
    )).toEqual({ ok: false, error: { code: "invalid-candidate" } });

    for (const counts of [
      { ...validCounts, collectedElementCount: 0 },
      { ...validCounts, candidateElementCount: 2 },
      {
        candidateElementCount: 2_001,
        collectedElementCount: 0,
        ignoredElementCount: 2_001,
        skippedElementCount: 0,
        skippedByReason: {}
      },
      { ...validCounts, skippedElementCount: 1 },
      {
        ...validCounts,
        skippedElementCount: 1,
        skippedByReason: { "font-family-too-long": -1 }
      }
    ]) {
      expect(analyzeTypographyVariants([candidate], typographyPolicy(), counts))
        .toEqual({ ok: false, error: { code: "evidence-count-mismatch" } });
    }
  });
});

describe("analyzePaletteDiscipline", () => {
  it("parses RGBA8, keeps alpha identities, collapses hue inputs, and accounts for skips", () => {
    const candidates = [
      paletteCandidate({ selector: "#red", value: "rgb(255, 0, 0)" }),
      paletteCandidate({ selector: "#half-red", value: "rgba(255, 0, 0, 0.5)" }),
      paletteCandidate({ selector: "#blue", value: "color(srgb 0 0 1)" }),
      paletteCandidate({ selector: "#transparent", value: "rgba(1, 2, 3, 0)" }),
      paletteCandidate({ selector: "#unsupported", value: "color(display-p3 1 0 0)" })
    ];
    const counts = paletteCounts(candidates.length, {
      ignored: 2,
      skipped: 1,
      skippedByReason: { "computed-color-too-long": 1 }
    });
    const result = analyzePaletteDiscipline(candidates, palettePolicy(), counts);

    expect(result).toMatchObject({
      ok: true,
      summary: {
        policyId: PALETTE_DISCIPLINE_BUDGET_POLICY_ID,
        methodId: PALETTE_DISCIPLINE_METHOD_ID,
        maxDistinctColors: 24,
        maxChromaticHueFamilies: 4,
        coverage: "lower-bound",
        candidateSlotCount: 8,
        collectedSlotCount: 5,
        evaluatedSlotCount: 3,
        ignoredSlotCount: 3,
        ignoredByReason: { "selector-exception": 2, transparent: 1 },
        skippedSlotCount: 2,
        skippedByReason: {
          "computed-color-too-long": 1,
          "unsupported-color": 1
        },
        distinctColorCount: 3,
        emittedColorCount: 3,
        omittedColorCount: 0,
        hueFamilyCount: 2
      }
    });
    if (!result.ok) {
      return;
    }
    expect(result.summary.colors.map((example) => example.identity)).toEqual([
      "0,0,255,255",
      "255,0,0,128",
      "255,0,0,255"
    ]);
  });

  it("bounds exact color and location evidence after deterministic frequency/RGBA ordering", () => {
    const repeated = ["#z", "#a", "#m", "#\uE000", "#😀", "#b"].map(
      (selector) => paletteCandidate({ selector, value: "rgb(255, 0, 0)" })
    );
    const candidates = [
      ...repeated,
      paletteCandidate({ value: "rgb(0, 0, 0)" }),
      paletteCandidate({ value: "rgb(0, 0, 255)" }),
      paletteCandidate({ value: "rgb(0, 255, 0)" }),
      paletteCandidate({ value: "rgb(128, 128, 128)" }),
      paletteCandidate({ value: "rgb(255, 255, 0)" })
    ];
    const result = analyzePaletteDiscipline(
      candidates,
      palettePolicy(),
      paletteCounts(candidates.length)
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.summary).toMatchObject({
      coverage: "complete",
      evaluatedSlotCount: 11,
      distinctColorCount: 6,
      emittedColorCount: 5,
      omittedColorCount: 1
    });
    expect(result.summary.colors[0]).toMatchObject({
      identity: "255,0,0,255",
      occurrenceCount: 6,
      emittedLocationCount: 5,
      omittedLocationCount: 1
    });
    expect(result.summary.colors[0].locations.map((location) => location.selector)).toEqual([
      "#a",
      "#b",
      "#m",
      "#z",
      "#\uE000"
    ]);
  });

  it("reclassifies overlong raw colors as explicit lower-bound skips before parsing", () => {
    const overlongButParseable = `${" ".repeat(257)}rgb(255, 0, 0)`;
    const result = analyzePaletteDiscipline(
      [paletteCandidate({ value: overlongButParseable })],
      palettePolicy(),
      paletteCounts(1)
    );

    expect(result).toMatchObject({
      ok: true,
      summary: {
        coverage: "lower-bound",
        candidateSlotCount: 1,
        collectedSlotCount: 1,
        evaluatedSlotCount: 0,
        skippedSlotCount: 1,
        skippedByReason: { "computed-color-too-long": 1 },
        distinctColorCount: 0,
        hueFamilyCount: 0
      }
    });
  });

  it("is permutation-stable and rejects policy, candidate, and accounting corruption", () => {
    const candidates = [
      paletteCandidate({ selector: "#b", value: "rgb(0, 0, 255)" }),
      paletteCandidate({ selector: "#r", value: "rgb(255, 0, 0)" })
    ];
    const counts = paletteCounts(2);
    const forward = analyzePaletteDiscipline(candidates, palettePolicy(), counts);
    const reverse = analyzePaletteDiscipline([...candidates].reverse(), palettePolicy(), counts);
    expect(reverse).toEqual(forward);

    expect(analyzePaletteDiscipline(
      candidates,
      { ...palettePolicy(), maxDistinctColors: 0 },
      counts
    )).toEqual({ ok: false, error: { code: "invalid-policy" } });
    expect(analyzePaletteDiscipline(
      [{ ...candidates[0], property: "box-shadow" } as unknown as PaletteDisciplineCandidate],
      palettePolicy(),
      paletteCounts(1)
    )).toEqual({ ok: false, error: { code: "invalid-candidate" } });
    expect(analyzePaletteDiscipline(
      candidates,
      palettePolicy(),
      { ...counts, candidateSlotCount: 3 }
    )).toEqual({ ok: false, error: { code: "evidence-count-mismatch" } });
    expect(analyzePaletteDiscipline(
      [],
      palettePolicy(),
      {
        candidateSlotCount: 5_001,
        collectedSlotCount: 0,
        ignoredSlotCount: 5_001,
        skippedSlotCount: 0,
        skippedByReason: {}
      }
    )).toEqual({ ok: false, error: { code: "evidence-count-mismatch" } });
  });
});

describe("analyzeDensityComplexity", () => {
  it("materializes complete visible and union-find cluster summaries with deterministic boxes", () => {
    const collection: DensityComplexityCollection = {
      visibleElements: {
        elementUniverseCount: 5,
        visibleElementCount: 2,
        ignoredElementCount: 1,
        ineligibleElementCount: 2,
        skippedElementCount: 0,
        skippedByReason: {},
        samples: [
          { selector: "#later", region: region(50, 50, 10, 10) },
          { selector: "#first", region: region(5, 5, 10, 10) }
        ],
        omittedSampleCount: 0
      },
      textClusters: {
        textNodeUniverseCount: 3,
        ignoredTextNodeCount: 0,
        ineligibleTextNodeCount: 0,
        skippedTextNodeCount: 0,
        evaluatedTextNodeCount: 3,
        skippedByReason: {},
        textFragmentCount: 3,
        fragments: [
          fragment("p", "#p", 0, 0, 20, 10),
          fragment("p", "#strong", 20, 0, 40, 10),
          fragment("q", "#q", 100, 100, 120, 110)
        ]
      }
    };
    const result = analyzeDensityComplexity(collection, densityPolicy());

    expect(result).toMatchObject({
      ok: true,
      summary: {
        policyId: DENSITY_COMPLEXITY_BUDGET_POLICY_ID,
        methodId: DENSITY_COMPLEXITY_METHOD_ID,
        visibleElementMethodId: DENSITY_VISIBLE_ELEMENT_METHOD_ID,
        textClusterMethodId: DENSITY_TEXT_CLUSTER_METHOD_ID,
        maxVisibleElements: 120,
        maxTextClusters: 48,
        visibleElements: {
          coverage: "complete",
          elementUniverseCount: 5,
          visibleElementCount: 2,
          emittedSampleCount: 2,
          omittedSampleCount: 0
        },
        textClusters: {
          coverage: "complete",
          textClusterCount: 2,
          edgeTestCount: 1,
          emittedSampleCount: 2,
          omittedSampleCount: 0
        }
      }
    });
    if (!result.ok || !result.summary.textClusters) {
      return;
    }
    expect(result.summary.visibleElements?.samples.map((sample) => sample.selector))
      .toEqual(["#first", "#later"]);
    expect(result.summary.textClusters.samples).toEqual([
      {
        selector: "#p",
        region: region(0, 0, 40, 10),
        fragmentCount: 2
      },
      {
        selector: "#q",
        region: region(100, 100, 20, 10),
        fragmentCount: 1
      }
    ]);
  });

  it("keeps visible lower bounds evaluable while making skipped text explicitly incomplete", () => {
    const fragments = Array.from(
      { length: 1_415 },
      (_, index) => fragment("same-root", `#f-${index}`, index * 100, 0, index * 100 + 10, 10)
    );
    const collection: DensityComplexityCollection = {
      visibleElements: {
        elementUniverseCount: 4,
        visibleElementCount: 2,
        ignoredElementCount: 0,
        ineligibleElementCount: 1,
        skippedElementCount: 1,
        skippedByReason: { "unsupported-clip-or-mask": 1 },
        samples: [
          { selector: "#a", region: region(0, 0, 10, 10) },
          { selector: "#b", region: region(20, 0, 10, 10) }
        ],
        omittedSampleCount: 0
      },
      textClusters: {
        textNodeUniverseCount: 1_416,
        ignoredTextNodeCount: 0,
        ineligibleTextNodeCount: 0,
        skippedTextNodeCount: 1,
        evaluatedTextNodeCount: 1_415,
        skippedByReason: { "unsupported-clip-or-mask": 1 },
        textFragmentCount: fragments.length,
        fragments
      }
    };
    const result = analyzeDensityComplexity(collection, densityPolicy());

    expect(result).toMatchObject({
      ok: true,
      summary: {
        visibleElements: {
          coverage: "lower-bound",
          visibleElementCount: 2,
          skippedElementCount: 1
        },
        textClusters: {
          coverage: "incomplete",
          textClusterCount: null,
          edgeTestCount: null,
          emittedSampleCount: 0,
          omittedSampleCount: null,
          samples: []
        }
      }
    });
  });

  it("bounds ten deterministic cluster samples without changing the exact count", () => {
    const fragments = Array.from(
      { length: 12 },
      (_, index) => fragment(`root-${index}`, `#item-${11 - index}`, index * 20, index * 10)
    );
    const result = analyzeDensityComplexity({
      textClusters: {
        textNodeUniverseCount: 12,
        ignoredTextNodeCount: 0,
        ineligibleTextNodeCount: 0,
        skippedTextNodeCount: 0,
        evaluatedTextNodeCount: 12,
        skippedByReason: {},
        textFragmentCount: 12,
        fragments: [...fragments].reverse()
      }
    }, densityPolicy({ visible: false }));

    expect(result).toMatchObject({
      ok: true,
      summary: {
        textClusters: {
          coverage: "complete",
          textClusterCount: 12,
          edgeTestCount: 0,
          emittedSampleCount: 10,
          omittedSampleCount: 2
        }
      }
    });
    if (!result.ok || !result.summary.textClusters) {
      return;
    }
    expect(result.summary.textClusters.samples.map((sample) => sample.region.y))
      .toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90]);
  });

  it("returns a typed edge-cap error only for complete cluster evidence", () => {
    const fragments = Array.from(
      { length: 1_415 },
      (_, index) => fragment("same-root", `#f-${index}`, index * 100, 0, index * 100 + 10, 10)
    );
    const result = analyzeDensityComplexity({
      textClusters: {
        textNodeUniverseCount: fragments.length,
        ignoredTextNodeCount: 0,
        ineligibleTextNodeCount: 0,
        skippedTextNodeCount: 0,
        evaluatedTextNodeCount: fragments.length,
        skippedByReason: {},
        textFragmentCount: fragments.length,
        fragments
      }
    }, densityPolicy({ visible: false }));

    expect(result).toEqual({
      ok: false,
      error: {
        code: "edge-cap-exceeded",
        component: "text-clusters",
        edgeTests: 1_000_001
      }
    });
  });

  it("rejects component mismatch, accounting corruption, invalid samples, and fragment caps", () => {
    expect(analyzeDensityComplexity(
      {},
      densityPolicy()
    )).toEqual({
      ok: false,
      error: { code: "evidence-count-mismatch" }
    });

    expect(analyzeDensityComplexity({
      visibleElements: {
        elementUniverseCount: 1,
        visibleElementCount: 1,
        ignoredElementCount: 0,
        ineligibleElementCount: 0,
        skippedElementCount: 0,
        skippedByReason: {},
        samples: [{ selector: "#x", region: region(0, 0, 0, 10) }],
        omittedSampleCount: 0
      }
    }, densityPolicy({ text: false }))).toEqual({
      ok: false,
      error: { code: "invalid-candidate", component: "visible-elements" }
    });

    expect(analyzeDensityComplexity({
      visibleElements: {
        elementUniverseCount: 2,
        visibleElementCount: 1,
        ignoredElementCount: 0,
        ineligibleElementCount: 0,
        skippedElementCount: 0,
        skippedByReason: {},
        samples: [{ selector: "#x", region: region(0, 0, 10, 10) }],
        omittedSampleCount: 0
      }
    }, densityPolicy({ text: false }))).toEqual({
      ok: false,
      error: { code: "evidence-count-mismatch", component: "visible-elements" }
    });

    expect(analyzeDensityComplexity({
      visibleElements: {
        elementUniverseCount: 10_001,
        visibleElementCount: 0,
        ignoredElementCount: 10_001,
        ineligibleElementCount: 0,
        skippedElementCount: 0,
        skippedByReason: {},
        samples: [],
        omittedSampleCount: 0
      }
    }, densityPolicy({ text: false }))).toEqual({
      ok: false,
      error: { code: "evidence-count-mismatch", component: "visible-elements" }
    });

    expect(analyzeDensityComplexity({
      textClusters: {
        textNodeUniverseCount: 1,
        ignoredTextNodeCount: 0,
        ineligibleTextNodeCount: 0,
        skippedTextNodeCount: 0,
        evaluatedTextNodeCount: 1,
        skippedByReason: {},
        textFragmentCount: 1,
        fragments: [fragment("", "#bad", 0, 0)]
      }
    }, densityPolicy({ visible: false }))).toEqual({
      ok: false,
      error: { code: "invalid-candidate", component: "text-clusters" }
    });

    expect(analyzeDensityComplexity({
      textClusters: {
        textNodeUniverseCount: 20_001,
        ignoredTextNodeCount: 20_001,
        ineligibleTextNodeCount: 0,
        skippedTextNodeCount: 0,
        evaluatedTextNodeCount: 0,
        skippedByReason: {},
        textFragmentCount: 0,
        fragments: []
      }
    }, densityPolicy({ visible: false }))).toEqual({
      ok: false,
      error: { code: "evidence-count-mismatch", component: "text-clusters" }
    });

    const overCap = Array.from(
      { length: 20_001 },
      (_, index) => fragment(`root-${index}`, `#f-${index}`, index * 2, 0, index * 2 + 1, 1)
    );
    expect(analyzeDensityComplexity({
      textClusters: {
        textNodeUniverseCount: 20_000,
        ignoredTextNodeCount: 0,
        ineligibleTextNodeCount: 0,
        skippedTextNodeCount: 0,
        evaluatedTextNodeCount: 20_000,
        skippedByReason: {},
        textFragmentCount: overCap.length,
        fragments: overCap
      }
    }, densityPolicy({ visible: false }))).toEqual({
      ok: false,
      error: {
        code: "fragment-cap-exceeded",
        component: "text-clusters",
        edgeTests: 0
      }
    });
  });
});

function typographyCandidate(
  overrides: Partial<TypographyVariantCandidate> = {}
): TypographyVariantCandidate {
  return {
    selector: "#type",
    region: region(0, 0, 100, 20),
    fontFamily: "\"Example Sans\", sans-serif",
    fontSize: "16px",
    fontWeight: "normal",
    fontStyle: "normal",
    ...overrides
  };
}

function typographyCounts(
  collected: number,
  options: {
    ignored?: number;
    skipped?: number;
    skippedByReason?: TypographyVariantCollectionCounts["skippedByReason"];
  } = {}
): TypographyVariantCollectionCounts {
  const ignored = options.ignored ?? 0;
  const skipped = options.skipped ?? 0;
  return {
    candidateElementCount: collected + ignored + skipped,
    collectedElementCount: collected,
    ignoredElementCount: ignored,
    skippedElementCount: skipped,
    skippedByReason: options.skippedByReason ?? {}
  };
}

function typographyPolicy(): TypographyVariantBudgetPolicy {
  return {
    maxDistinctVariants: 8,
    ignoreSelectors: [],
    policyId: TYPOGRAPHY_VARIANT_BUDGET_POLICY_ID,
    methodId: TYPOGRAPHY_VARIANT_METHOD_ID
  };
}

function paletteCandidate(
  overrides: Partial<PaletteDisciplineCandidate> = {}
): PaletteDisciplineCandidate {
  return {
    selector: "#paint",
    region: region(0, 0, 100, 20),
    property: "background-color",
    value: "rgb(0, 0, 0)",
    ...overrides
  };
}

function paletteCounts(
  collected: number,
  options: {
    ignored?: number;
    skipped?: number;
    skippedByReason?: PaletteDisciplineCollectionCounts["skippedByReason"];
  } = {}
): PaletteDisciplineCollectionCounts {
  const ignored = options.ignored ?? 0;
  const skipped = options.skipped ?? 0;
  return {
    candidateSlotCount: collected + ignored + skipped,
    collectedSlotCount: collected,
    ignoredSlotCount: ignored,
    skippedSlotCount: skipped,
    skippedByReason: options.skippedByReason ?? {}
  };
}

function palettePolicy(): PaletteDisciplineBudgetPolicy {
  return {
    maxDistinctColors: 24,
    maxChromaticHueFamilies: 4,
    ignoreSelectors: [],
    policyId: PALETTE_DISCIPLINE_BUDGET_POLICY_ID,
    methodId: PALETTE_DISCIPLINE_METHOD_ID
  };
}

function densityPolicy(
  components: { visible?: boolean; text?: boolean } = {}
): DensityComplexityBudgetPolicy {
  const visible = components.visible ?? true;
  const text = components.text ?? true;
  return {
    ...(visible ? { maxVisibleElements: 120 } : {}),
    ...(text ? { maxTextClusters: 48 } : {}),
    ignoreSelectors: [],
    policyId: DENSITY_COMPLEXITY_BUDGET_POLICY_ID,
    methodId: DENSITY_COMPLEXITY_METHOD_ID,
    visibleElementMethodId: DENSITY_VISIBLE_ELEMENT_METHOD_ID,
    textClusterMethodId: DENSITY_TEXT_CLUSTER_METHOD_ID
  };
}

function fragment(
  rootId: string,
  selector: string,
  left: number,
  top: number,
  right: number = left + 10,
  bottom: number = top + 10
): DensityTextFragment {
  return { rootId, selector, left, top, right, bottom };
}

function region(x: number, y: number, width: number, height: number): VisualMetricRegion {
  return { x, y, width, height };
}

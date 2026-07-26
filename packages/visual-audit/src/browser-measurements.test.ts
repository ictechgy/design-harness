import { describe, expect, it } from "vitest";
import { collectViewportMeasurements } from "./browser-measurements.js";

describe("collectViewportMeasurements finding coverage", () => {
  it("omits cap coverage when page-empty policy suppresses otherwise detected samples", async () => {
    const raw = {
      measurements: {
        viewport: "desktop",
        textLength: 0,
        meaningfulElementCount: 0
      },
      notices: [],
      contrastCandidates: [],
      tapTargetCandidates: [],
      findingCoverage: {
        viewport: "desktop",
        entries: [{
          checkName: "missing-image-alt",
          detectedCount: 1,
          emittedCount: 0,
          omittedCount: 1,
          limit: 5
        }]
      }
    };
    const page = {
      evaluate: async <T>(): Promise<T> => raw as T
    };

    const result = await collectViewportMeasurements(page);

    expect(result.findingCoverage).toBeUndefined();
  });
});

describe("collectViewportMeasurements spacing collection", () => {
  it("passes detector-specific selectors and preserves scoped browser evidence", async () => {
    let receivedConfig: unknown;
    let serializedClosure = "";
    const raw = {
      measurements: {
        viewport: "desktop",
        textLength: 1,
        meaningfulElementCount: 1
      },
      notices: [],
      contrastCandidates: [],
      tapTargetCandidates: [],
      spacingAdherenceCandidates: [{
        selector: "#sample",
        region: { x: 0, y: 0, width: 100, height: 40 },
        property: "margin-top",
        valuePx: -8
      }],
      spacingAdherenceCollection: {
        candidateSlotCount: 10,
        ignoredSlotCount: 0,
        skippedSlotCount: 9,
        skippedByReason: {
          "normal-gap": 2,
          "auto-margin": 1,
          "unsupported-typed-value": 6
        }
      },
      spacingAdherenceRootFontSizePx: 17
    };
    const page = {
      evaluate: async <T>(pageFunction: (arg?: unknown) => T | Promise<T>, arg?: unknown): Promise<T> => {
        receivedConfig = arg;
        serializedClosure = pageFunction.toString();
        return raw as T;
      }
    };

    const result = await collectViewportMeasurements(page, {
      spacing: { ignoreSelectors: [".third-party-spacing"] }
    });

    expect(receivedConfig).toEqual({
      spacing: { ignoreSelectors: [".third-party-spacing"] }
    });
    expect(serializedClosure).toContain("collectSpacingAdherenceCandidates");
    expect(serializedClosure).toContain("computedStyleMap");
    expect(serializedClosure).toContain("isAdherenceElementVisibleInViewport");
    expect(serializedClosure).toContain("spacingAdherenceIgnoreSelectors");
    for (const property of [
      "margin-top",
      "margin-right",
      "margin-bottom",
      "margin-left",
      "padding-top",
      "padding-right",
      "padding-bottom",
      "padding-left",
      "row-gap",
      "column-gap"
    ]) {
      expect(serializedClosure).toContain(property);
    }
    for (const skipReason of [
      "auto-margin",
      "normal-gap",
      "typed-om-unavailable",
      "typed-om-error",
      "unsupported-typed-value",
      "computed-spacing-too-long",
      "nonfinite-computed-value",
      "invalid-negative"
    ]) {
      expect(serializedClosure).toContain(skipReason);
    }
    expect(result.spacingAdherenceCandidates).toEqual(raw.spacingAdherenceCandidates);
    expect(result.spacingAdherenceCollection).toEqual(raw.spacingAdherenceCollection);
    expect(result.spacingAdherenceRootFontSizePx).toBe(17);
    expect(result.spacingAdherenceError).toBeUndefined();
  });

  it("preserves a spacing-scoped browser failure without synthesizing clean coverage", async () => {
    const raw = {
      measurements: {
        viewport: "desktop",
        textLength: 1,
        meaningfulElementCount: 1
      },
      notices: [],
      contrastCandidates: [],
      tapTargetCandidates: [],
      spacingAdherenceError: {
        code: "invalid-selector",
        selectorIndex: 0
      }
    };
    const page = {
      evaluate: async <T>(): Promise<T> => raw as T
    };

    const result = await collectViewportMeasurements(page, {
      spacing: { ignoreSelectors: ["["] }
    });

    expect(result.spacingAdherenceError).toEqual({
      code: "invalid-selector",
      selectorIndex: 0
    });
    expect(result.spacingAdherenceCandidates).toBeUndefined();
    expect(result.spacingAdherenceCollection).toBeUndefined();
    expect(result.spacingAdherenceRootFontSizePx).toBeUndefined();
  });

  it("keeps the result spacing-free when no policy activates browser collection", async () => {
    let receivedConfig: unknown = "not-called";
    const raw = {
      measurements: {
        viewport: "desktop",
        textLength: 1,
        meaningfulElementCount: 1
      },
      notices: [],
      contrastCandidates: [],
      tapTargetCandidates: []
    };
    const page = {
      evaluate: async <T>(_pageFunction: (arg?: unknown) => T | Promise<T>, arg?: unknown): Promise<T> => {
        receivedConfig = arg;
        return raw as T;
      }
    };

    const result = await collectViewportMeasurements(page);

    expect(receivedConfig).toBeUndefined();
    expect(result).not.toHaveProperty("spacingAdherenceCandidates");
    expect(result).not.toHaveProperty("spacingAdherenceCollection");
    expect(result).not.toHaveProperty("spacingAdherenceRootFontSizePx");
    expect(result).not.toHaveProperty("spacingAdherenceError");
  });
});

describe("collectViewportMeasurements visual-metric collection", () => {
  it("forwards metric-owned selectors and density component activation", async () => {
    let receivedConfig: unknown;
    let serializedClosure = "";
    const raw = {
      measurements: {
        viewport: "desktop",
        textLength: 1,
        meaningfulElementCount: 1
      },
      notices: [],
      contrastCandidates: [],
      tapTargetCandidates: [],
      typographyVariantCandidates: [{
        selector: "#headline",
        region: { x: 10, y: 20, width: 200, height: 40 },
        fontFamily: "\"Inter\", sans-serif",
        fontSize: "32px",
        fontWeight: "700",
        fontStyle: "normal"
      }],
      typographyVariantCollection: {
        candidateElementCount: 3,
        collectedElementCount: 1,
        ignoredElementCount: 1,
        skippedElementCount: 1,
        skippedByReason: { "font-family-too-long": 1 }
      },
      paletteDisciplineCandidates: [{
        selector: "#headline",
        region: { x: 10, y: 20, width: 200, height: 40 },
        property: "color",
        value: "rgb(12, 34, 56)"
      }],
      paletteDisciplineCollection: {
        candidateSlotCount: 3,
        collectedSlotCount: 1,
        ignoredSlotCount: 1,
        skippedSlotCount: 1,
        skippedByReason: { "computed-color-too-long": 1 }
      },
      densityComplexityCollection: {
        visibleElements: {
          elementUniverseCount: 4,
          visibleElementCount: 1,
          ignoredElementCount: 1,
          ineligibleElementCount: 1,
          skippedElementCount: 1,
          skippedByReason: { "unsupported-clip-or-mask": 1 },
          samples: [{
            selector: "#headline",
            region: { x: 10, y: 20, width: 200, height: 40 }
          }],
          omittedSampleCount: 0
        },
        textClusters: {
          textNodeUniverseCount: 4,
          ignoredTextNodeCount: 1,
          ineligibleTextNodeCount: 1,
          skippedTextNodeCount: 1,
          evaluatedTextNodeCount: 1,
          skippedByReason: { "unsupported-clip-or-mask": 1 },
          textFragmentCount: 1,
          fragments: [{
            rootId: "root-1",
            selector: "#headline",
            left: 10.25,
            top: 20.5,
            right: 210.75,
            bottom: 60.125
          }]
        }
      }
    };
    const page = {
      evaluate: async <T>(
        pageFunction: (arg?: unknown) => T | Promise<T>,
        arg?: unknown
      ): Promise<T> => {
        receivedConfig = arg;
        serializedClosure = pageFunction.toString();
        return raw as T;
      }
    };

    const result = await collectViewportMeasurements(page, {
      typographyVariants: { ignoreSelectors: [".type-vendor"] },
      paletteDiscipline: { ignoreSelectors: [".palette-vendor"] },
      densityComplexity: {
        ignoreSelectors: [".density-vendor"],
        collectVisibleElements: true,
        collectTextClusters: true
      }
    });

    expect(receivedConfig).toEqual({
      typographyVariants: { ignoreSelectors: [".type-vendor"] },
      paletteDiscipline: { ignoreSelectors: [".palette-vendor"] },
      densityComplexity: {
        ignoreSelectors: [".density-vendor"],
        collectVisibleElements: true,
        collectTextClusters: true
      }
    });
    expect(serializedClosure).toContain("collectTypographyVariantCandidates");
    expect(serializedClosure).toContain("collectPaletteDisciplineCandidates");
    expect(serializedClosure).toContain("collectDensityComplexity");
    expect(serializedClosure).toContain("collectDensityVisibleElements");
    expect(serializedClosure).toContain("collectDensityTextFragments");
    for (const prepareSelectors of [
      "prepareTypographyVariantSelectors();",
      "preparePaletteDisciplineSelectors();",
      "prepareDensityComplexitySelectors();"
    ]) {
      expect(serializedClosure.indexOf(prepareSelectors)).toBeGreaterThanOrEqual(0);
      expect(serializedClosure.indexOf(prepareSelectors))
        .toBeLessThan(serializedClosure.indexOf("const textElements"));
    }
    expect(serializedClosure).toContain("document.createTreeWalker(document.body, 4)");
    expect(serializedClosure).toContain("range.selectNodeContents(textNode)");
    expect(serializedClosure).toContain("unsupported-clip-or-mask");
    expect(serializedClosure).toContain("MAX_DENSITY_DOM_ELEMENTS");
    expect(serializedClosure).toContain("MAX_DENSITY_TEXT_NODES");
    expect(serializedClosure).toContain("MAX_DENSITY_TEXT_FRAGMENTS");
    expect(result.typographyVariantCandidates).toEqual(raw.typographyVariantCandidates);
    expect(result.typographyVariantCollection).toEqual(raw.typographyVariantCollection);
    expect(result.paletteDisciplineCandidates).toEqual(raw.paletteDisciplineCandidates);
    expect(result.paletteDisciplineCollection).toEqual(raw.paletteDisciplineCollection);
    expect(result.densityComplexityCollection).toEqual(raw.densityComplexityCollection);
  });

  it("keeps visual-metric output absent when no config activates collection", async () => {
    let receivedConfig: unknown = "not-called";
    let serializedClosure = "";
    const raw = {
      measurements: {
        viewport: "desktop",
        textLength: 1,
        meaningfulElementCount: 1
      },
      notices: [],
      contrastCandidates: [],
      tapTargetCandidates: []
    };
    const page = {
      evaluate: async <T>(
        pageFunction: (arg?: unknown) => T | Promise<T>,
        arg?: unknown
      ): Promise<T> => {
        receivedConfig = arg;
        serializedClosure = pageFunction.toString();
        return raw as T;
      }
    };

    const result = await collectViewportMeasurements(page);

    expect(receivedConfig).toBeUndefined();
    expect(serializedClosure).toContain(
      "typographyVariantsEnabled && typographyVariantError"
    );
    expect(serializedClosure).toContain(
      "paletteDisciplineEnabled && paletteDisciplineError"
    );
    expect(serializedClosure).toContain(
      "densityComplexityEnabled && densityComplexityError"
    );
    expect(result).not.toHaveProperty("typographyVariantCandidates");
    expect(result).not.toHaveProperty("typographyVariantCollection");
    expect(result).not.toHaveProperty("typographyVariantError");
    expect(result).not.toHaveProperty("paletteDisciplineCandidates");
    expect(result).not.toHaveProperty("paletteDisciplineCollection");
    expect(result).not.toHaveProperty("paletteDisciplineError");
    expect(result).not.toHaveProperty("densityComplexityCollection");
    expect(result).not.toHaveProperty("densityComplexityError");
  });

  it("activates atomic-owner collapse only after the outer owner is viewport eligible", async () => {
    let serializedClosure = "";
    const raw = {
      measurements: {
        viewport: "desktop",
        textLength: 1,
        meaningfulElementCount: 1
      },
      notices: [],
      contrastCandidates: [],
      tapTargetCandidates: [],
      densityComplexityCollection: {
        visibleElements: {
          elementUniverseCount: 2,
          visibleElementCount: 1,
          ignoredElementCount: 0,
          ineligibleElementCount: 1,
          skippedElementCount: 0,
          skippedByReason: {},
          samples: [{
            selector: "#inner-control",
            region: { x: 0, y: 0, width: 80, height: 32 }
          }],
          omittedSampleCount: 0
        }
      }
    };
    const page = {
      evaluate: async <T>(
        pageFunction: (arg?: unknown) => T | Promise<T>
      ): Promise<T> => {
        serializedClosure = pageFunction.toString();
        return raw as T;
      }
    };

    const result = await collectViewportMeasurements(page, {
      densityComplexity: {
        ignoreSelectors: [],
        collectVisibleElements: true,
        collectTextClusters: false
      }
    });

    expect(serializedClosure).toContain("insideEligibleAtomicOwner.has(parent)");
    expect(serializedClosure).toContain("insideEligibleAtomicOwner.add(element)");
    expect(serializedClosure).not.toContain("hasDensityAtomicAncestor");
    expect(result.densityComplexityCollection).toEqual(raw.densityComplexityCollection);
  });

  it("preserves selector failures only on their owning metrics", async () => {
    const raw = {
      measurements: {
        viewport: "desktop",
        textLength: 1,
        meaningfulElementCount: 1
      },
      notices: [],
      contrastCandidates: [],
      tapTargetCandidates: [],
      typographyVariantError: {
        code: "invalid-selector",
        selectorIndex: 0
      },
      paletteDisciplineCandidates: [{
        selector: "body",
        region: { x: 0, y: 0, width: 100, height: 100 },
        property: "background-color",
        value: "rgb(255, 255, 255)"
      }],
      paletteDisciplineCollection: {
        candidateSlotCount: 1,
        collectedSlotCount: 1,
        ignoredSlotCount: 0,
        skippedSlotCount: 0,
        skippedByReason: {}
      },
      densityComplexityError: {
        code: "selector-evaluation",
        textNodeIndex: 2
      }
    };
    const page = {
      evaluate: async <T>(): Promise<T> => raw as T
    };

    const result = await collectViewportMeasurements(page, {
      typographyVariants: { ignoreSelectors: ["["] },
      paletteDiscipline: { ignoreSelectors: [] },
      densityComplexity: {
        ignoreSelectors: [":has("],
        collectVisibleElements: false,
        collectTextClusters: true
      }
    });

    expect(result.typographyVariantError).toEqual(raw.typographyVariantError);
    expect(result.typographyVariantCandidates).toBeUndefined();
    expect(result.typographyVariantCollection).toBeUndefined();
    expect(result.paletteDisciplineCandidates).toEqual(raw.paletteDisciplineCandidates);
    expect(result.paletteDisciplineCollection).toEqual(raw.paletteDisciplineCollection);
    expect(result.paletteDisciplineError).toBeUndefined();
    expect(result.densityComplexityError).toEqual(raw.densityComplexityError);
    expect(result.densityComplexityCollection).toBeUndefined();
  });

  it.each([
    [
      "typographyVariantError",
      { code: "candidate-limit", candidateCount: 2_001, limit: 2_000 }
    ],
    [
      "paletteDisciplineError",
      { code: "candidate-limit", candidateCount: 5_001, limit: 5_000 }
    ],
    [
      "densityComplexityError",
      {
        code: "fragment-limit",
        textNodeIndex: 20_000,
        candidateCount: 20_001,
        limit: 20_000
      }
    ]
  ] as const)("preserves %s cap payloads without synthesizing a summary", async (
    errorProperty,
    error
  ) => {
    const raw = {
      measurements: {
        viewport: "desktop",
        textLength: 1,
        meaningfulElementCount: 1
      },
      notices: [],
      contrastCandidates: [],
      tapTargetCandidates: [],
      [errorProperty]: error
    };
    const page = {
      evaluate: async <T>(): Promise<T> => raw as T
    };

    const result = await collectViewportMeasurements(page, {
      typographyVariants: { ignoreSelectors: [] },
      paletteDiscipline: { ignoreSelectors: [] },
      densityComplexity: {
        ignoreSelectors: [],
        collectVisibleElements: true,
        collectTextClusters: true
      }
    });

    expect(result[errorProperty]).toEqual(error);
    if (errorProperty === "typographyVariantError") {
      expect(result.typographyVariantCollection).toBeUndefined();
    } else if (errorProperty === "paletteDisciplineError") {
      expect(result.paletteDisciplineCollection).toBeUndefined();
    } else {
      expect(result.densityComplexityCollection).toBeUndefined();
    }
  });
});

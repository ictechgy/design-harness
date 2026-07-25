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

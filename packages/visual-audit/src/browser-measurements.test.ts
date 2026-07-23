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

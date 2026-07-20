import { describe, expect, it } from "vitest";
import {
  computeContrastRisks,
  contrastRatio,
  parseRgb,
  relativeLuminance,
  requiredContrastRatio,
  type ContrastCandidate
} from "./measurement-primitives.js";

function candidate(overrides: Partial<ContrastCandidate> = {}): ContrastCandidate {
  return {
    selector: "p",
    text: "sample",
    region: { x: 0, y: 0, width: 100, height: 20 },
    color: "rgb(0, 0, 0)",
    backgroundColor: "rgb(255, 255, 255)",
    fontSizePx: 15,
    fontWeight: 400,
    ...overrides
  };
}

describe("parseRgb", () => {
  it("reads rgb() and rgba() including alpha", () => {
    expect(parseRgb("rgb(11, 15, 25)")).toEqual({ red: 11, green: 15, blue: 25, alpha: 1 });
    expect(parseRgb("rgba(255, 255, 255, 0.06)")).toEqual({ red: 255, green: 255, blue: 255, alpha: 0.06 });
  });

  // Documents shipped behaviour rather than endorsing it. Chromium serialises CSS Color 4 values in their
  // own space, so each of these is a real computed value that silently becomes opaque black — and because
  // the fallback alpha is 1, it also terminates the ancestor walk. Step 4 changes this.
  it.each([
    "oklch(0.6 0.15 250)",
    "oklab(0.999994 0.0000455678 0.0000200868 / 0.06)",
    "color(display-p3 0.2 0.4 0.8)",
    "lab(50 20 -30)",
    "not a colour"
  ])("falls open to opaque black for %s", (value) => {
    expect(parseRgb(value)).toEqual({ red: 0, green: 0, blue: 0, alpha: 1 });
  });
});

describe("relativeLuminance", () => {
  it("returns the sRGB endpoints", () => {
    expect(relativeLuminance({ red: 0, green: 0, blue: 0 })).toBe(0);
    expect(relativeLuminance({ red: 255, green: 255, blue: 255 })).toBeCloseTo(1, 10);
  });

  // The shipped threshold is WCAG 2.x's 0.03928 rather than sRGB's 0.04045. No 8-bit channel falls between
  // them, so this pins the choice against accidental change once compositing produces fractional channels.
  it("uses the linear branch below the WCAG threshold", () => {
    expect(relativeLuminance({ red: 10, green: 10, blue: 10 })).toBeCloseTo(0.0030352, 6);
  });
});

describe("contrastRatio", () => {
  it("computes the documented extremes", () => {
    expect(contrastRatio({ red: 0, green: 0, blue: 0 }, { red: 255, green: 255, blue: 255 })).toBeCloseTo(21, 5);
    expect(contrastRatio({ red: 120, green: 120, blue: 120 }, { red: 120, green: 120, blue: 120 })).toBe(1);
  });

  it("is symmetric in its arguments", () => {
    const dark = { red: 26, green: 29, blue: 39 };
    const light = { red: 230, green: 237, blue: 247 };
    expect(contrastRatio(dark, light)).toBeCloseTo(contrastRatio(light, dark), 12);
  });

  // The clean-corpus reference values, recomputed here so the fixtures and the code cannot drift apart.
  // See examples/ui-quality-fixtures/clean-corpus-expected.md.
  it("reproduces the clean-corpus composited surface values", () => {
    const surface = { red: 26, green: 29, blue: 39 };
    expect(contrastRatio({ red: 230, green: 237, blue: 247 }, surface)).toBeCloseTo(14.27, 2);
    expect(contrastRatio({ red: 191, green: 192, blue: 195 }, surface)).toBeCloseTo(9.24, 2);
    expect(contrastRatio({ red: 83, green: 86, blue: 93 }, surface)).toBeCloseTo(2.29, 2);
  });
});

describe("requiredContrastRatio", () => {
  it.each([
    [24, 400, 3],
    [24, 700, 3],
    [18.66, 700, 3],
    [20, 700, 3],
    [18.66, 400, 4.5],
    [18.65, 700, 4.5],
    [15, 400, 4.5],
    [23.99, 400, 4.5]
  ])("%ipx weight %i requires %f:1", (fontSizePx, fontWeight, expected) => {
    expect(requiredContrastRatio(fontSizePx, fontWeight)).toBe(expected);
  });
});

describe("computeContrastRisks", () => {
  it("keeps only candidates below their required ratio", () => {
    const risks = computeContrastRisks([
      candidate({ selector: "#pass", color: "rgb(0, 0, 0)", backgroundColor: "rgb(255, 255, 255)" }),
      candidate({ selector: "#fail", color: "rgb(200, 200, 200)", backgroundColor: "rgb(255, 255, 255)" })
    ]);
    expect(risks.map((risk) => risk.selector)).toEqual(["#fail"]);
  });

  it("applies the large-text threshold, so a heading can pass where body text fails", () => {
    // 3.84:1 against white — above the 3:1 large-text threshold, below the 4.5:1 body threshold. The
    // whole point of the case is that it lands between them.
    const color = "rgb(130, 130, 130)";
    const backgroundColor = "rgb(255, 255, 255)";
    const risks = computeContrastRisks([
      candidate({ selector: "#heading", color, backgroundColor, fontSizePx: 24, fontWeight: 700 }),
      candidate({ selector: "#body", color, backgroundColor, fontSizePx: 15, fontWeight: 400 })
    ]);
    expect(risks.map((risk) => risk.selector)).toEqual(["#body"]);
  });

  it("preserves the sample shape and reports what it measured", () => {
    const [risk] = computeContrastRisks([
      candidate({ selector: "#faint", color: "rgb(220, 220, 220)", backgroundColor: "rgb(255, 255, 255)" })
    ]);
    expect(risk).toMatchObject({
      selector: "#faint",
      text: "sample",
      region: { x: 0, y: 0, width: 100, height: 20 },
      requiredRatio: 4.5,
      color: "rgb(220, 220, 220)",
      backgroundColor: "rgb(255, 255, 255)"
    });
    expect(Object.keys(risk)).toEqual([
      "selector",
      "text",
      "region",
      "ratio",
      "requiredRatio",
      "color",
      "backgroundColor"
    ]);
  });

  it("caps the emitted samples", () => {
    const many = Array.from({ length: 25 }, (_unused, index) =>
      candidate({ selector: `#fail-${index}`, color: "rgb(250, 250, 250)", backgroundColor: "rgb(255, 255, 255)" })
    );
    expect(computeContrastRisks(many)).toHaveLength(10);
  });

  it("drops non-finite ratios rather than reporting them", () => {
    const risks = computeContrastRisks([
      candidate({ selector: "#unparseable", color: "not a colour", backgroundColor: "also not a colour" })
    ]);
    // Both sides fall open to opaque black, giving a finite 1:1 — the failure this documents is that the
    // ratio is fabricated, not that it is non-finite. Step 4 replaces the fallback with a skip.
    expect(risks).toHaveLength(1);
    expect(risks[0]?.ratio).toBe(1);
  });

  // Regression pin for the defect the milestone exists to fix. When step 4 lands, this expectation must be
  // rewritten deliberately — it should not drift silently.
  it("currently mis-scores a translucent surface as opaque white", () => {
    const [risk] = computeContrastRisks([
      candidate({ selector: "#surface-body", color: "rgb(230, 237, 247)", backgroundColor: "rgba(255, 255, 255, 0.06)" })
    ]);
    expect(risk?.ratio).toBeCloseTo(1.18, 2);
  });
});

import { describe, expect, it } from "vitest";
import {
  centreDistance,
  compositeOver,
  computeContrastRisks,
  computeTapTargetRisks,
  contrastRatio,
  isUndersizedTarget,
  parseCssColor,
  pointToRectDistance,
  relativeLuminance,
  requiredContrastRatio,
  tapTargetSpacingExempt,
  type ContrastCandidate,
  type TapTargetCandidate,
  type TargetRect
} from "./measurement-primitives.js";

function candidate(overrides: Partial<ContrastCandidate> = {}): ContrastCandidate {
  return {
    selector: "p",
    text: "sample",
    region: { x: 0, y: 0, width: 100, height: 20 },
    color: "rgb(0, 0, 0)",
    backgroundLayers: ["rgb(255, 255, 255)"],
    canvasColor: "rgb(255, 255, 255)",
    fontSizePx: 15,
    fontWeight: 400,
    ...overrides
  };
}

/** Rounds a converted colour for comparison against Chromium's 8-bit rasteriser output. */
function rounded(value: ReturnType<typeof parseCssColor>) {
  if (!value) {
    return null;
  }
  return [Math.round(value.red), Math.round(value.green), Math.round(value.blue)];
}

describe("parseCssColor", () => {
  it("reads legacy rgb() and rgba() including alpha", () => {
    expect(parseCssColor("rgb(11, 15, 25)")).toEqual({ red: 11, green: 15, blue: 25, alpha: 1 });
    expect(parseCssColor("rgba(255, 255, 255, 0.06)")).toEqual({ red: 255, green: 255, blue: 255, alpha: 0.06 });
  });

  it("keeps fully transparent black distinguishable from unparseable", () => {
    expect(parseCssColor("rgba(0, 0, 0, 0)")).toEqual({ red: 0, green: 0, blue: 0, alpha: 0 });
    expect(parseCssColor("not a colour")).toBeNull();
  });

  // Every expected value was confirmed against Chromium's own canvas getImageData at zero channel
  // difference after rounding. These are the colours the clean-corpus fixtures actually declare.
  it.each([
    ["oklch(0.18 0.02 260)", [12, 18, 26]],
    ["oklch(0.95 0.01 260)", [235, 239, 245]],
    ["oklch(0.92 0.01 260)", [225, 229, 235]],
    ["oklch(0.45 0.01 260)", [82, 85, 91]],
    ["oklch(0.6 0.15 250)", [39, 132, 213]],
    ["color(srgb 1 1 1 / 0.06)", [255, 255, 255]]
  ])("converts %s", (input, expected) => {
    expect(rounded(parseCssColor(input))).toEqual(expected);
  });

  it("converts the color-mix(in oklab) surface, whose linear red exceeds 1 and must clamp", () => {
    const parsed = parseCssColor("oklab(0.999994 0.0000455678 0.0000200868 / 0.06)");
    expect(parsed?.alpha).toBeCloseTo(0.06, 10);
    expect(rounded(parsed)).toEqual([255, 255, 255]);
  });

  it("clamps a negative linear channel instead of producing NaN", () => {
    // oklch(0.5 0.3 150) has linear red = -0.128; Math.pow of a negative would be NaN, which the finite
    // filter would drop with no skip recorded.
    const parsed = parseCssColor("oklch(0.5 0.3 150)");
    expect(parsed).not.toBeNull();
    expect(rounded(parsed)?.[0]).toBe(0);
    expect(Number.isFinite(parsed?.green)).toBe(true);
  });

  it("treats the none keyword as zero rather than NaN", () => {
    expect(Number.isFinite(parseCssColor("oklch(none 0.1 200)")?.red)).toBe(true);
    const achromatic = parseCssColor("oklch(0.5 none 200)");
    expect(rounded(achromatic)).toEqual([99, 99, 99]);
  });

  // Not "unknowable" — deliberately out of scope for this milestone, recorded as a known limitation in
  // docs/criteria-and-checks.md. The contract that matters is that they skip rather than fabricate.
  it.each([
    "color(display-p3 1 0 0)",
    "lab(50 40 59.5)",
    "lch(60 40 250)",
    ""
  ])("returns null for %s so the caller skips", (value) => {
    expect(parseCssColor(value)).toBeNull();
  });

  it("is anchored, so a colour embedded in other text does not match", () => {
    expect(parseCssColor("url(x) rgb(1, 2, 3)")).toBeNull();
  });
});

describe("relativeLuminance", () => {
  it("returns the sRGB endpoints", () => {
    expect(relativeLuminance({ red: 0, green: 0, blue: 0 })).toBe(0);
    expect(relativeLuminance({ red: 255, green: 255, blue: 255 })).toBeCloseTo(1, 10);
  });

  // The shipped threshold is WCAG 2.x's 0.03928 rather than sRGB's 0.04045. No 8-bit channel falls between
  // them, but compositing now produces fractional channels that can. Pinned so it is never changed as a
  // side effect.
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
});

describe("compositeOver", () => {
  it("discards everything beneath an opaque layer", () => {
    const layers = [parseCssColor("rgba(255, 255, 255, 0.06)")!, parseCssColor("rgb(11, 15, 25)")!];
    const overWhite = compositeOver(layers, parseCssColor("rgb(255, 255, 255)")!);
    const overBlack = compositeOver(layers, parseCssColor("rgb(0, 0, 0)")!);
    expect(overWhite).toEqual(overBlack);
  });

  // The clean-corpus surface, unrounded. Rounding composited channels first would give (26, 29, 39) and
  // shift the fixture ratios by up to 0.03 — enough to matter next to a 4.5 threshold.
  it("composites the clean-corpus surface without rounding", () => {
    const surface = compositeOver(
      [parseCssColor("rgba(255, 255, 255, 0.06)")!],
      parseCssColor("rgb(11, 15, 25)")!
    );
    expect(surface.red).toBeCloseTo(25.64, 6);
    expect(surface.green).toBeCloseTo(29.4, 6);
    expect(surface.blue).toBeCloseTo(38.8, 6);
    expect(relativeLuminance(surface)).toBeCloseTo(0.01258526, 8);
  });

  it("reproduces the clean-corpus reference ratios from declared layers", () => {
    const layers = [parseCssColor("rgba(255, 255, 255, 0.06)")!];
    const base = parseCssColor("rgb(11, 15, 25)")!;
    const surface = compositeOver(layers, base);
    const ratioFor = (color: string) =>
      contrastRatio(compositeOver([parseCssColor(color)!, ...layers], base), surface);

    expect(ratioFor("rgb(230, 237, 247)")).toBeCloseTo(14.2377, 3);
    expect(ratioFor("rgba(255, 255, 255, 0.72)")).toBeCloseTo(9.2017, 3);
    expect(ratioFor("rgba(255, 255, 255, 0.25)")).toBeCloseTo(2.2768, 3);
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
    const { risks } = computeContrastRisks([
      candidate({ selector: "#pass", color: "rgb(0, 0, 0)" }),
      candidate({ selector: "#fail", color: "rgb(200, 200, 200)" })
    ]);
    expect(risks.map((risk) => risk.selector)).toEqual(["#fail"]);
  });

  it("applies the large-text threshold, so a heading can pass where body text fails", () => {
    // 3.84:1 against white — above the 3:1 large-text threshold, below the 4.5:1 body threshold.
    const color = "rgb(130, 130, 130)";
    const { risks } = computeContrastRisks([
      candidate({ selector: "#heading", color, fontSizePx: 24, fontWeight: 700 }),
      candidate({ selector: "#body", color, fontSizePx: 15, fontWeight: 400 })
    ]);
    expect(risks.map((risk) => risk.selector)).toEqual(["#body"]);
  });

  it("preserves the shipped sample shape and key order", () => {
    const { risks } = computeContrastRisks([
      candidate({ selector: "#faint", color: "rgb(220, 220, 220)" })
    ]);
    expect(Object.keys(risks[0]!)).toEqual([
      "selector",
      "text",
      "region",
      "ratio",
      "requiredRatio",
      "color",
      "backgroundColor"
    ]);
    // `color` stays the declared foreground so it is actionable in devtools; `backgroundColor` is now the
    // composited backdrop, which is what that field always claimed to be.
    expect(risks[0]).toMatchObject({ color: "rgb(220, 220, 220)", backgroundColor: "rgb(255, 255, 255)" });
  });

  it("caps the emitted samples", () => {
    const many = Array.from({ length: 25 }, (_unused, index) =>
      candidate({ selector: `#fail-${index}`, color: "rgb(250, 250, 250)" })
    );
    expect(computeContrastRisks(many).risks).toHaveLength(10);
  });

  // Rewritten from the step-3 pin, which asserted the fail-open fabricated a 1:1 ratio.
  it("records a skip instead of fabricating a ratio for an unsupported colour space", () => {
    const { risks, coverage } = computeContrastRisks([
      candidate({ selector: "#p3", color: "color(display-p3 0.25 0.25 0.25)", backgroundLayers: ["rgb(17, 17, 17)"] })
    ]);
    expect(risks).toHaveLength(0);
    expect(coverage).toEqual({
      evaluatedElementCount: 0,
      skippedElementCount: 1,
      skippedByReason: { "unsupported-color-space": 1 }
    });
  });

  // Rewritten from the step-3 pin, which asserted the translucent surface scored 1.18:1 against white.
  it("composites a translucent surface over the page root instead of reading it as opaque white", () => {
    const { risks, coverage } = computeContrastRisks([
      candidate({
        selector: "#surface-body",
        color: "rgb(230, 237, 247)",
        backgroundLayers: ["rgba(255, 255, 255, 0.06)", "rgb(11, 15, 25)"]
      })
    ]);
    // 14.24:1 against the composited surface — comfortably passing. The shipped build resolved the
    // backdrop to opaque white and reported a false 1.18:1.
    expect(risks).toHaveLength(0);
    expect(coverage.evaluatedElementCount).toBe(1);
  });

  it("still flags translucent text that is genuinely too faint", () => {
    const { risks } = computeContrastRisks([
      candidate({ selector: "#too-faint", color: "rgba(255, 255, 255, 0.25)", backgroundLayers: ["rgb(11, 15, 25)"] })
    ]);
    // Compositing the background but not the foreground would score this ~16.8:1 and let it pass.
    expect(risks).toHaveLength(1);
    expect(risks[0]?.ratio).toBeCloseTo(2.1935, 3);
  });

  it("skips invisible text rather than reporting a fabricated 1:1", () => {
    const { risks, coverage } = computeContrastRisks([
      candidate({ selector: "#reserved", color: "rgba(0, 0, 0, 0)", backgroundLayers: ["rgb(229, 231, 235)"] })
    ]);
    expect(risks).toHaveLength(0);
    expect(coverage.skippedByReason).toEqual({ "invisible-text": 1 });
  });

  it("honours a skip reason set by the browser walk", () => {
    const { risks, coverage } = computeContrastRisks([
      candidate({ selector: "#hero", skipReason: "background-image" }),
      candidate({ selector: "#glass", skipReason: "backdrop-filter" })
    ]);
    expect(risks).toHaveLength(0);
    expect(coverage.skippedByReason).toEqual({ "background-image": 1, "backdrop-filter": 1 });
  });

  it("reports coverage so silence is distinguishable from not measuring", () => {
    const { coverage } = computeContrastRisks([
      candidate({ selector: "#a" }),
      candidate({ selector: "#b" }),
      candidate({ selector: "#c", skipReason: "detached-backdrop" })
    ]);
    expect(coverage).toEqual({
      evaluatedElementCount: 2,
      skippedElementCount: 1,
      skippedByReason: { "detached-backdrop": 1 }
    });
  });
});

describe("tap-target Spacing exception", () => {
  const box = (x: number, y: number, width: number, height: number): TargetRect => ({ x, y, width, height });

  describe("pointToRectDistance", () => {
    it("is zero when the point is inside the rectangle", () => {
      expect(pointToRectDistance({ x: 10, y: 10 }, box(0, 0, 20, 20))).toBe(0);
    });
    it("measures the nearest edge orthogonally and the nearest corner diagonally", () => {
      expect(pointToRectDistance({ x: 30, y: 10 }, box(0, 0, 20, 20))).toBe(10);
      expect(pointToRectDistance({ x: 23, y: 24 }, box(0, 0, 20, 20))).toBeCloseTo(5, 10);
    });
  });

  describe("centreDistance", () => {
    it("is symmetric", () => {
      expect(centreDistance(box(0, 0, 16, 16), box(20, 0, 16, 16)))
        .toBeCloseTo(centreDistance(box(20, 0, 16, 16), box(0, 0, 16, 16)), 12);
    });
  });

  describe("isUndersizedTarget", () => {
    it.each([
      [box(0, 0, 24, 24), false],
      [box(0, 0, 23, 24), true],
      [box(0, 0, 24, 23), true],
      [box(0, 0, 60, 16), true],
      [box(0, 0, 0, 40), false]
    ])("%o -> %s", (rect, expected) => {
      expect(isUndersizedTarget(rect)).toBe(expected);
    });
  });

  describe("tapTargetSpacingExempt", () => {
    it("exempts an isolated undersized target", () => {
      const target = box(300, 300, 16, 16);
      expect(tapTargetSpacingExempt(target, [target])).toBe(true);
    });

    it("flags two 16x16 icons whose circles overlap (centres 20px apart)", () => {
      const a = box(20, 20, 16, 16);
      const b = box(40, 20, 16, 16);
      expect(tapTargetSpacingExempt(a, [a, b])).toBe(false);
      expect(tapTargetSpacingExempt(b, [a, b])).toBe(false);
    });

    it("exempts the same icons once spaced 24px centre-to-centre", () => {
      const a = box(20, 20, 16, 16);
      const b = box(44, 20, 16, 16); // centres 24 apart — tangent, strict inequality exempts
      expect(tapTargetSpacingExempt(a, [a, b])).toBe(true);
    });

    // The discriminator: #disc's circle intersects #wide's box (rect test fires) while their centres are
    // 34px apart (circle test alone would exempt). The conjunctive reading must flag it.
    it("flags a small target whose circle intersects a wide neighbour's box, though their centres are far", () => {
      const disc = box(88, 120, 16, 16); // centre (96,128)
      const wide = box(100, 120, 60, 16); // box x[100,160]; centre→box = 4 < 12; centre dist 34
      expect(centreDistance(disc, wide)).toBeCloseTo(34, 10);
      expect(pointToRectDistance({ x: 96, y: 128 }, wide)).toBeCloseTo(4, 10);
      expect(tapTargetSpacingExempt(disc, [disc, wide])).toBe(false);
    });

    it("exempts a target tangent to a sized neighbour's box at exactly 12px", () => {
      // Sized neighbour, so only the rect test applies. Centre→box is exactly 12, and the strict
      // inequality exempts. (Two undersized boxes here would still trip the circle test at 20 < 24.)
      const target = box(0, 0, 16, 16); // centre (8,8)
      const neighbour = box(20, 0, 40, 40); // sized; box x[20,60]; centre→box = 12 exactly
      expect(pointToRectDistance({ x: 8, y: 8 }, neighbour)).toBe(12);
      expect(tapTargetSpacingExempt(target, [target, neighbour])).toBe(true);
    });

    it("exempts two undersized circles tangent at exactly 24px centre distance", () => {
      const a = box(0, 0, 16, 16); // centre (8,8)
      const b = box(24, 0, 16, 16); // centre (32,8); distance 24 exactly, and boxes 8px apart so rect ok
      expect(centreDistance(a, b)).toBe(24);
      expect(pointToRectDistance({ x: 8, y: 8 }, b)).toBeGreaterThanOrEqual(12);
      expect(tapTargetSpacingExempt(a, [a, b])).toBe(true);
    });
  });

  describe("computeTapTargetRisks", () => {
    const candidate = (selector: string, rect: TargetRect): TapTargetCandidate =>
      ({ selector, text: selector, region: rect, rect });

    it("flags only the cramped and discriminator targets on the bad-fixture geometry", () => {
      const candidates = [
        candidate("#cramp-a", box(20, 20, 16, 16)),
        candidate("#cramp-b", box(40, 20, 16, 16)),
        candidate("#wide", box(100, 120, 60, 16)),
        candidate("#disc", box(88, 120, 16, 16)),
        candidate("#lonely", box(300, 300, 16, 16)),
        candidate("#big", box(300, 20, 44, 44))
      ];
      expect(computeTapTargetRisks(candidates).map((risk) => risk.selector).sort())
        .toEqual(["#cramp-a", "#cramp-b", "#disc"]);
    });

    it("is silent on the good-fixture geometry", () => {
      const candidates = [
        candidate("#icon-a", box(20, 20, 16, 16)),
        candidate("#icon-b", box(20, 60, 16, 16)),
        candidate("#wide", box(20, 100, 60, 16)),
        candidate("#small", box(120, 100, 16, 16)),
        candidate("#ua-check", box(20, 200, 13, 13))
      ];
      expect(computeTapTargetRisks(candidates)).toEqual([]);
    });

    it("drops the rect field and keeps the sample shape", () => {
      const [risk] = computeTapTargetRisks([
        candidate("#a", box(20, 20, 16, 16)),
        candidate("#b", box(40, 20, 16, 16))
      ]);
      expect(Object.keys(risk)).toEqual(["selector", "text", "region"]);
    });

    it("caps the emitted samples", () => {
      const many = Array.from({ length: 25 }, (_unused, index) =>
        candidate(`#x-${index}`, box(index * 20, 0, 16, 16))
      );
      expect(computeTapTargetRisks(many).length).toBeLessThanOrEqual(10);
    });
  });
});

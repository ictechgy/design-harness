import { describe, expect, it } from "vitest";
import {
  DensityClusterError,
  HUE_FAMILY_SPAN_MICRODEGREES,
  HUE_MICRODEGREE_SCALE,
  HUE_TURN_MICRODEGREES,
  MAX_DOM_ELEMENTS,
  MAX_EDGE_TESTS,
  MAX_EVIDENCE_SAMPLES,
  MAX_INLINE_GAP_HEIGHTS,
  MAX_LEFT_EDGE_DELTA_HEIGHTS,
  MAX_NEXT_LINE_GAP_HEIGHTS,
  MAX_TEXT_FRAGMENTS,
  MAX_TEXT_NODES,
  MIN_NEXT_LINE_X_OVERLAP,
  MIN_VERTICAL_OVERLAP,
  OKLAB_ACHROMATIC_CUTOFF,
  TypographyTupleNormalizationError,
  centreDistance,
  compositeOver,
  countDensityTextClusters,
  computeContrastRisks,
  computeTapTargetRisks,
  contrastRatio,
  densityFragmentsAreAdjacent,
  hueFamilyCoverFromRgba8,
  isUndersizedTarget,
  isChromaticOklabChroma,
  minimumCircularHueCover,
  normalizeTypographyTuple,
  oklabChromaHueFromRgba8,
  parseCssColor,
  pointToRectDistance,
  relativeLuminance,
  requiredContrastRatio,
  rgba8FromParsedColor,
  rgba8Identity,
  tapTargetSpacingExempt,
  type ContrastCandidate,
  type DensityTextFragment,
  type TapTargetCandidate,
  type TargetRect,
  type TypographyTupleInput
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

function typographyInput(overrides: Partial<TypographyTupleInput> = {}): TypographyTupleInput {
  return {
    fontFamily: "Inter, sans-serif",
    fontSize: "16px",
    fontWeight: "400",
    fontStyle: "normal",
    ...overrides
  };
}

function fragment(
  rootId: string,
  left: number,
  top: number,
  width = 10,
  height = 10
): DensityTextFragment {
  return { rootId, left, top, right: left + width, bottom: top + height };
}

/** Rounds a converted colour for comparison against Chromium's 8-bit rasteriser output. */
function rounded(value: ReturnType<typeof parseCssColor>) {
  if (!value) {
    return null;
  }
  return [Math.round(value.red), Math.round(value.green), Math.round(value.blue)];
}

describe("typography tuple normalization", () => {
  it("decodes and ASCII-folds an ordered, duplicate-preserving family list into the exact identity", () => {
    const escaped = normalizeTypographyTuple(typographyInput({
      fontFamily: "I\\6e ter, SANS-SERIF, I\\6e ter",
      fontSize: "16.0004px",
      fontWeight: "normal",
      fontStyle: "oblique"
    }));
    const equivalent = normalizeTypographyTuple(typographyInput({
      fontFamily: "inter, sans-serif, INTER",
      fontSize: "16.00049px",
      fontWeight: "400",
      fontStyle: "oblique 14deg"
    }));

    expect(escaped).toEqual({
      tuple: {
        families: ["named\u0000inter", "generic\u0000sans-serif", "named\u0000inter"],
        sizeMilliPx: 16_000,
        weightMilli: 400_000,
        style: "oblique:14000000"
      },
      identity:
        "{\"families\":[\"named\\u0000inter\",\"generic\\u0000sans-serif\",\"named\\u0000inter\"],"
        + "\"sizeMilliPx\":16000,\"weightMilli\":400000,\"style\":\"oblique:14000000\"}"
    });
    expect(equivalent.identity).toBe(escaped.identity);
  });

  it("keeps order, named-versus-generic kind, duplicates, and Unicode normalization identity-bearing", () => {
    const identity = (fontFamily: string) =>
      normalizeTypographyTuple(typographyInput({ fontFamily })).identity;

    expect(identity("Inter, serif")).not.toBe(identity("serif, Inter"));
    expect(identity("\"serif\"")).not.toBe(identity("serif"));
    expect(identity("Inter, Inter")).not.toBe(identity("Inter"));
    expect(identity("Å")).not.toBe(identity("A\\30a "));
    expect(identity("École")).not.toBe(identity("école"));
    expect(identity("INTER")).toBe(identity("inter"));
  });

  it("quantizes size, numeric weight, and oblique angle independently at the frozen precision", () => {
    const base = normalizeTypographyTuple(typographyInput({
      fontSize: "12.3454px",
      fontWeight: "400.0004",
      fontStyle: "oblique 14.0000004deg"
    }));
    expect(base.tuple).toMatchObject({
      sizeMilliPx: 12_345,
      weightMilli: 400_000,
      style: "oblique:14000000"
    });
    expect(normalizeTypographyTuple(typographyInput({
      fontSize: "12.34549px",
      fontWeight: "400.00049",
      fontStyle: "oblique 14.00000049deg"
    })).identity).toBe(base.identity);

    expect(normalizeTypographyTuple(typographyInput({
      fontSize: "12.3456px",
      fontWeight: "400.0004",
      fontStyle: "oblique 14.0000004deg"
    })).identity).not.toBe(base.identity);
    expect(normalizeTypographyTuple(typographyInput({
      fontSize: "12.3454px",
      fontWeight: "400.0006",
      fontStyle: "oblique 14.0000004deg"
    })).identity).not.toBe(base.identity);
    expect(normalizeTypographyTuple(typographyInput({
      fontSize: "12.3454px",
      fontWeight: "400.0004",
      fontStyle: "oblique 14.0000006deg"
    })).identity).not.toBe(base.identity);
  });

  it("normalizes the two weight keywords and the bare oblique default", () => {
    expect(normalizeTypographyTuple(typographyInput({ fontWeight: "normal" })).tuple.weightMilli)
      .toBe(400_000);
    expect(normalizeTypographyTuple(typographyInput({ fontWeight: "bold" })).tuple.weightMilli)
      .toBe(700_000);
    expect(normalizeTypographyTuple(typographyInput({ fontWeight: "700" })).tuple.weightMilli)
      .toBe(700_000);
    expect(normalizeTypographyTuple(typographyInput({ fontStyle: "oblique" })).tuple.style)
      .toBe("oblique:14000000");
    expect(normalizeTypographyTuple(typographyInput({ fontStyle: "oblique -0deg" })).tuple.style)
      .toBe("oblique:0");
  });

  it("measures the family ceiling in Unicode scalars rather than UTF-16 code units", () => {
    expect(() => normalizeTypographyTuple(typographyInput({
      fontFamily: "😀".repeat(1_024)
    }))).not.toThrow();

    try {
      normalizeTypographyTuple(typographyInput({ fontFamily: "😀".repeat(1_025) }));
      throw new Error("expected font-family-too-long");
    } catch (error) {
      expect(error).toBeInstanceOf(TypographyTupleNormalizationError);
      expect(error).toMatchObject({ code: "font-family-too-long" });
    }
  });

  it.each([
    [{ fontFamily: "" }, "invalid-font-family"],
    [{ fontSize: "0px" }, "invalid-font-size"],
    [{ fontSize: "16" }, "invalid-font-size"],
    [{ fontSize: "1e309px" }, "invalid-font-size"],
    [{ fontSize: "9007199254741px" }, "invalid-font-size"],
    [{ fontWeight: "0" }, "invalid-font-weight"],
    [{ fontWeight: "1000.0001" }, "invalid-font-weight"],
    [{ fontWeight: "bolder" }, "invalid-font-weight"],
    [{ fontStyle: "oblique 14rad" }, "invalid-font-style"],
    [{ fontStyle: "oblique 1e309deg" }, "invalid-font-style"],
    [{ fontStyle: "inherit" }, "invalid-font-style"]
  ] as const)("turns an invalid raw component into typed skip evidence: %o", (overrides, code) => {
    try {
      normalizeTypographyTuple(typographyInput(overrides));
      throw new Error(`expected ${code}`);
    } catch (error) {
      expect(error).toBeInstanceOf(TypographyTupleNormalizationError);
      expect(error).toMatchObject({ code });
    }
  });
});

describe("palette RGBA8 and chromatic hue primitives", () => {
  it("clamps then rounds every parsed component to the exact RGBA8 identity", () => {
    const color = rgba8FromParsedColor({
      red: -0.6,
      green: 12.49,
      blue: 254.5,
      alpha: 0.5
    });
    expect(color).toEqual({ red: 0, green: 12, blue: 255, alpha: 128 });
    expect(rgba8Identity(color!)).toBe("0,12,255,128");
    expect(rgba8FromParsedColor({ red: Number.NaN, green: 0, blue: 0, alpha: 1 }))
      .toBeNull();
    expect(() => rgba8Identity({ red: 256, green: 0, blue: 0, alpha: 255 }))
      .toThrow(RangeError);
  });

  it("keeps alpha variants distinct in RGBA identity while sharing one RGB hue input", () => {
    const redOpaque = { red: 255, green: 0, blue: 0, alpha: 255 };
    const redHalfAlpha = { red: 255, green: 0, blue: 0, alpha: 128 };
    expect(new Set([rgba8Identity(redOpaque), rgba8Identity(redHalfAlpha)]).size).toBe(2);
    expect(hueFamilyCoverFromRgba8([redOpaque, redHalfAlpha])).toEqual({
      count: 1,
      starts: [29_233_885]
    });
  });

  it("pins the binary64 sRGB-to-OKLab chroma and hue quantization", () => {
    expect(oklabChromaHueFromRgba8({ red: 255, green: 0, blue: 0, alpha: 255 }))
      .toEqual({ chromaMicro: 257_683, hueMicrodegrees: 29_233_885 });
    expect(oklabChromaHueFromRgba8({ red: 0, green: 255, blue: 0, alpha: 255 }))
      .toEqual({ chromaMicro: 294_827, hueMicrodegrees: 142_495_339 });
    expect(oklabChromaHueFromRgba8({ red: 0, green: 0, blue: 255, alpha: 255 }))
      .toEqual({ chromaMicro: 313_214, hueMicrodegrees: 264_052_021 });
    expect(oklabChromaHueFromRgba8({ red: 128, green: 128, blue: 128, alpha: 255 }))
      .toEqual({ chromaMicro: 0, hueMicrodegrees: null });
  });

  it("makes 29_999 achromatic and 30_000 chromatic", () => {
    expect(OKLAB_ACHROMATIC_CUTOFF).toBe(30_000);
    expect(isChromaticOklabChroma(29_999)).toBe(false);
    expect(isChromaticOklabChroma(30_000)).toBe(true);
  });

  it.each([
    [[359_000_000, 1_000_000], { count: 1, starts: [359_000_000] }],
    [[0, 30_000_000], { count: 1, starts: [0] }],
    [[0, 30_000_001], { count: 2, starts: [0, 30_000_001] }],
    [[0, 25_000_000, 50_000_000], { count: 2, starts: [0, 25_000_000] }]
  ])("computes the frozen closed circular cover for %o", (hues, expected) => {
    expect(minimumCircularHueCover(hues)).toEqual(expected);
  });

  it("uses the lexicographically smallest sorted starts to break equal-count ties", () => {
    // Rotating the same three points yields [0,40] or [0,20]; both use two arcs.
    expect(minimumCircularHueCover([0, 20_000_000, 40_000_000])).toEqual({
      count: 2,
      starts: [0, 20_000_000]
    });
  });

  it("is invariant to permutation, duplicates, whole turns, and added achromatic colors", () => {
    const canonical = minimumCircularHueCover([0, 25_000_000, 50_000_000]);
    expect(minimumCircularHueCover([
      410_000_000,
      25_000_000,
      0,
      50_000_000,
      -360_000_000,
      25_000_000
    ])).toEqual(canonical);

    const red = { red: 255, green: 0, blue: 0, alpha: 255 };
    const gray = { red: 128, green: 128, blue: 128, alpha: 255 };
    const transparentBlue = { red: 0, green: 0, blue: 255, alpha: 0 };
    expect(hueFamilyCoverFromRgba8([gray, transparentBlue, red, gray]))
      .toEqual(hueFamilyCoverFromRgba8([red]));
    expect(minimumCircularHueCover([])).toEqual({ count: 0, starts: [] });
    expect(HUE_TURN_MICRODEGREES).toBe(360_000_000);
    expect(HUE_MICRODEGREE_SCALE).toBe(1_000_000);
    expect(HUE_FAMILY_SPAN_MICRODEGREES).toBe(30_000_000);
  });
});

describe("density fragment connectivity", () => {
  it("pins every frozen safety and topology constant", () => {
    expect({
      MAX_DOM_ELEMENTS,
      MAX_TEXT_NODES,
      MAX_TEXT_FRAGMENTS,
      MAX_EDGE_TESTS,
      MAX_EVIDENCE_SAMPLES,
      MIN_VERTICAL_OVERLAP,
      MAX_INLINE_GAP_HEIGHTS,
      MIN_NEXT_LINE_X_OVERLAP,
      MAX_NEXT_LINE_GAP_HEIGHTS,
      MAX_LEFT_EDGE_DELTA_HEIGHTS
    }).toEqual({
      MAX_DOM_ELEMENTS: 10_000,
      MAX_TEXT_NODES: 20_000,
      MAX_TEXT_FRAGMENTS: 20_000,
      MAX_EDGE_TESTS: 1_000_000,
      MAX_EVIDENCE_SAMPLES: 10,
      MIN_VERTICAL_OVERLAP: 0.5,
      MAX_INLINE_GAP_HEIGHTS: 1,
      MIN_NEXT_LINE_X_OVERLAP: 0.25,
      MAX_NEXT_LINE_GAP_HEIGHTS: 1,
      MAX_LEFT_EDGE_DELTA_HEIGHTS: 1
    });
  });

  it("treats touching or overlapping rectangles as adjacent only inside one flow root", () => {
    const upper = fragment("root", 0, 0);
    const cornerTouching = fragment("root", 10, 10);
    expect(densityFragmentsAreAdjacent(upper, cornerTouching)).toBe(true);
    expect(densityFragmentsAreAdjacent(upper, { ...cornerTouching, rootId: "other" }))
      .toBe(false);
  });

  it("makes the inline overlap and gap inequalities closed at their exact boundaries", () => {
    const left = fragment("root", 0, 0);
    expect(densityFragmentsAreAdjacent(left, fragment("root", 20, 5))).toBe(true);
    expect(densityFragmentsAreAdjacent(left, fragment("root", 20.000_001, 5)))
      .toBe(false);
    expect(densityFragmentsAreAdjacent(left, fragment("root", 20, 5.000_001)))
      .toBe(false);
  });

  it("makes next-line x-overlap and left-edge alternatives closed at their exact boundaries", () => {
    const wide = fragment("root", 0, 0, 40, 10);
    expect(densityFragmentsAreAdjacent(wide, fragment("root", 30, 20, 40, 10)))
      .toBe(true);
    expect(densityFragmentsAreAdjacent(wide, fragment("root", 30.000_001, 20, 40, 10)))
      .toBe(false);

    const narrow = fragment("root", 0, 0, 5, 10);
    expect(densityFragmentsAreAdjacent(narrow, fragment("root", 10, 20, 5, 10)))
      .toBe(true);
    expect(densityFragmentsAreAdjacent(narrow, fragment("root", 10.000_001, 20, 5, 10)))
      .toBe(false);
  });

  it("uses union-find transitivity, but never bridges different flow roots", () => {
    const result = countDensityTextClusters([
      fragment("paragraph", 0, 0),
      fragment("paragraph", 40, 0),
      fragment("paragraph", 20, 0),
      fragment("paragraph", 100, 0),
      fragment("other-paragraph", 0, 0)
    ]);
    expect(result).toEqual({
      clusterCount: 3,
      edgeTests: 6,
      components: [[0, 1, 2], [3], [4]]
    });
    expect(densityFragmentsAreAdjacent(
      fragment("paragraph", 0, 0),
      fragment("paragraph", 40, 0)
    )).toBe(false);
  });

  it("keeps count and edge accounting stable under input permutations", () => {
    const inputs = [
      fragment("a", 0, 0),
      fragment("a", 20, 0),
      fragment("a", 100, 0),
      fragment("b", 0, 0),
      fragment("b", 20, 0)
    ];
    const forward = countDensityTextClusters(inputs);
    const reverse = countDensityTextClusters([...inputs].reverse());
    expect(forward.clusterCount).toBe(3);
    expect(reverse.clusterCount).toBe(3);
    expect(forward.edgeTests).toBe(4);
    expect(reverse.edgeTests).toBe(4);
    expect(forward.components.every(
      (component) => component.every((value, index) => index === 0 || component[index - 1] < value)
    )).toBe(true);
  });

  it("rejects invalid geometry instead of silently manufacturing a component", () => {
    try {
      countDensityTextClusters([{ rootId: "x", left: 0, top: 0, right: 0, bottom: 10 }]);
      throw new Error("expected invalid-fragment");
    } catch (error) {
      expect(error).toBeInstanceOf(DensityClusterError);
      expect(error).toMatchObject({ code: "invalid-fragment", edgeTests: 0 });
    }
  });

  it("allows exactly one million pair tests and aborts on pair 1,000,001", () => {
    const repeated = (rootId: string, count: number) =>
      Array.from({ length: count }, () => fragment(rootId, 0, 0));
    const atCap = [
      ...repeated("a", 1_414), // 998,991 pairs
      ...repeated("b", 45),    // +990
      ...repeated("c", 6),     // +15
      ...repeated("d", 3),     // +3
      ...repeated("e", 2)      // +1 = 1,000,000
    ];
    expect(countDensityTextClusters(atCap)).toMatchObject({
      clusterCount: 5,
      edgeTests: MAX_EDGE_TESTS
    });

    try {
      countDensityTextClusters([...atCap, fragment("e", 0, 0)]);
      throw new Error("expected edge-cap-exceeded");
    } catch (error) {
      expect(error).toBeInstanceOf(DensityClusterError);
      expect(error).toMatchObject({
        code: "edge-cap-exceeded",
        edgeTests: MAX_EDGE_TESTS + 1
      });
    }
  });
});

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

  it("reports all 25 detected risks while carrying at most 10 samples", () => {
    const many = Array.from({ length: 25 }, (_unused, index) =>
      candidate({ selector: `#fail-${index}`, color: "rgb(250, 250, 250)" })
    );
    const { risks, detectedCount } = computeContrastRisks(many);
    expect(detectedCount).toBe(25);
    expect(risks).toHaveLength(10);
  });

  it("keeps the exact detected count when it is at or below the sample cap", () => {
    const atCap = Array.from({ length: 10 }, (_unused, index) =>
      candidate({ selector: `#at-cap-${index}`, color: "rgb(250, 250, 250)" })
    );
    const { risks, detectedCount } = computeContrastRisks(atCap);
    expect(detectedCount).toBe(10);
    expect(risks).toHaveLength(10);
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
      candidate({ selector: "#glass", skipReason: "backdrop-filter" }),
      candidate({ selector: "#faded", skipReason: "opacity" }),
      candidate({ selector: "#blended", skipReason: "mix-blend-mode" }),
      candidate({ selector: "#filtered", skipReason: "filter" })
    ]);
    expect(risks).toHaveLength(0);
    expect(coverage.skippedByReason).toEqual({
      "background-image": 1,
      "backdrop-filter": 1,
      opacity: 1,
      "mix-blend-mode": 1,
      filter: 1
    });
  });

  it("keeps browser skip reasons above Node colour and foreground skips", () => {
    const { risks, coverage } = computeContrastRisks([
      candidate({ selector: "#invalid-colour", color: "lab(50 40 59.5)", skipReason: "opacity" }),
      candidate({ selector: "#invisible", color: "rgba(0, 0, 0, 0)", skipReason: "filter" })
    ]);
    expect(risks).toHaveLength(0);
    expect(coverage).toEqual({
      evaluatedElementCount: 0,
      skippedElementCount: 2,
      skippedByReason: { opacity: 1, filter: 1 }
    });
  });

  it("does not globally skip ordinary candidates when paint effects use normal defaults", () => {
    const { risks, coverage } = computeContrastRisks([
      candidate({ selector: "#ordinary-low-contrast", color: "rgb(120, 120, 120)" }),
      candidate({ selector: "#faded", skipReason: "opacity" }),
      candidate({ selector: "#blended", skipReason: "mix-blend-mode" }),
      candidate({ selector: "#filtered", skipReason: "filter" })
    ]);
    expect(risks.map((risk) => risk.selector)).toEqual(["#ordinary-low-contrast"]);
    expect(coverage).toEqual({
      evaluatedElementCount: 1,
      skippedElementCount: 3,
      skippedByReason: { opacity: 1, "mix-blend-mode": 1, filter: 1 }
    });
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
      expect(computeTapTargetRisks(candidates).risks.map((risk) => risk.selector).sort())
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
      expect(computeTapTargetRisks(candidates)).toEqual({ risks: [], detectedCount: 0 });
    });

    it("drops the rect field and keeps the sample shape", () => {
      const [risk] = computeTapTargetRisks([
        candidate("#a", box(20, 20, 16, 16)),
        candidate("#b", box(40, 20, 16, 16))
      ]).risks;
      expect(Object.keys(risk)).toEqual(["selector", "text", "region"]);
    });

    it("reports all 25 detected risks while carrying at most 10 samples", () => {
      const many = Array.from({ length: 25 }, (_unused, index) =>
        candidate(`#x-${index}`, box(index * 20, 0, 16, 16))
      );
      const { risks, detectedCount } = computeTapTargetRisks(many);
      expect(detectedCount).toBe(25);
      expect(risks).toHaveLength(10);
    });

    it("keeps the exact detected count when it is below the sample cap", () => {
      const belowCap = Array.from({ length: 6 }, (_unused, index) =>
        candidate(`#below-cap-${index}`, box(index * 20, 0, 16, 16))
      );
      const { risks, detectedCount } = computeTapTargetRisks(belowCap);
      expect(detectedCount).toBe(6);
      expect(risks).toHaveLength(6);
    });
  });
});

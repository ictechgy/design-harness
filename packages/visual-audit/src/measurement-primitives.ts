import { foldAsciiCase } from "@design-harness/core";
import type { ContrastRiskSample, ElementSample } from "./checks.js";
import { parseFontFamilyList } from "./font-family.js";

export {
  DENSITY_COMPLEXITY_BUDGET_POLICY_ID,
  DENSITY_COMPLEXITY_METHOD_ID,
  DENSITY_TEXT_CLUSTER_METHOD_ID,
  DENSITY_VISIBLE_ELEMENT_METHOD_ID,
  PALETTE_DISCIPLINE_BUDGET_POLICY_ID,
  PALETTE_DISCIPLINE_METHOD_ID,
  TYPOGRAPHY_VARIANT_BUDGET_POLICY_ID,
  TYPOGRAPHY_VARIANT_METHOD_ID
} from "@design-harness/core";

/**
 * DOM-free measurement computations.
 *
 * These deliberately live outside the `page.evaluate` closure in `browser-measurements.ts`. Playwright
 * serialises that closure with `Function.prototype.toString` and evaluates the resulting source text in the
 * page, where module-scope identifiers do not exist — so a function imported into the closure would
 * typecheck, unit-test green, and throw `ReferenceError` at runtime. `audit-url.ts` catches that, records a
 * failed check, and continues, which means the failure is silent and every finding for the viewport
 * disappears.
 *
 * The browser therefore collects plain values and the arithmetic happens here, in Node, where it is
 * directly testable. Nothing in this module may reference `document`, `window`, or a DOM type.
 */

/** Why a collected element produced no contrast finding. Local union — not a RubricCategory, not a
 *  source-strength value — so `check:enum-lockstep` and `check:criteria-policy` are untouched. */
export type ContrastSkipReason =
  | "background-image"
  | "backdrop-filter"
  | "opacity"
  | "mix-blend-mode"
  | "filter"
  | "unsupported-color-space"
  | "invisible-text"
  | "detached-backdrop";

/** One text element as observed in the page, before any contrast arithmetic. */
export interface ContrastCandidate extends ElementSample {
  /** Computed `-webkit-text-fill-color` falling back to `color`, verbatim. */
  color: string;
  /**
   * Computed `background-color` of the element and each ancestor the walk visited, nearest first. The
   * element itself is layer 0 because its own background paints behind its own text. The walk stops at the
   * first layer that carries no alpha component, so the last entry is normally opaque.
   */
  backgroundLayers: string[];
  /** Canvas colour measured from a `color: Canvas` probe. Used only when no collected layer is opaque. */
  canvasColor: string;
  fontSizePx: number;
  fontWeight: number;
  /** Set by the browser when the backdrop is unknowable; Node adds its own reasons on top. */
  skipReason?: ContrastSkipReason;
}

export interface ParsedColor {
  red: number;
  green: number;
  blue: number;
  alpha: number;
}

export interface ContrastCoverage {
  evaluatedElementCount: number;
  skippedElementCount: number;
  skippedByReason: Partial<Record<ContrastSkipReason, number>>;
}

export interface ContrastRiskResult {
  risks: ContrastRiskSample[];
  /** Exact post-skip, below-threshold count before `MAX_CONTRAST_SAMPLES` is applied. */
  detectedCount: number;
  coverage: ContrastCoverage;
}

/* -------------------------------------------------------------------------------------------------- */
/* Evidence-backed visual-metric primitives                                                              */
/* -------------------------------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------------------------------- */
/* Typography tuple normalization                                                                        */
/* -------------------------------------------------------------------------------------------------- */

export const MAX_COMPUTED_FONT_FAMILY_SCALARS = 1_024;
export const MAX_TYPOGRAPHY_VARIANT_CANDIDATES = 2_000;
export const MAX_PALETTE_DISCIPLINE_SLOTS = 5_000;
export const TYPOGRAPHY_SIZE_MILLIPX_SCALE = 1_000;
export const TYPOGRAPHY_WEIGHT_MILLI_SCALE = 1_000;
export const TYPOGRAPHY_STYLE_MICRODEGREE_SCALE = 1_000_000;
export const DEFAULT_OBLIQUE_DEGREES = 14;

export interface TypographyTupleInput {
  /** Raw computed `font-family` serialization. */
  fontFamily: string;
  /** Raw computed `font-size` serialization, including the `px` unit. */
  fontSize: string;
  /** Raw computed `font-weight` serialization. */
  fontWeight: string;
  /** Raw computed `font-style` serialization. */
  fontStyle: string;
}

export type NormalizedTypographyStyle = "normal" | "italic" | `oblique:${number}`;

export interface NormalizedTypographyTuple {
  /** Ordered, duplicate-preserving `kind + U+0000 + ASCII-folded value` members. */
  families: string[];
  sizeMilliPx: number;
  weightMilli: number;
  style: NormalizedTypographyStyle;
}

export interface NormalizedTypographyTupleResult {
  tuple: NormalizedTypographyTuple;
  /** Canonical JSON identity with the contractually frozen property order. */
  identity: string;
}

export type TypographyTupleNormalizationErrorCode =
  | "font-family-too-long"
  | "invalid-font-family"
  | "invalid-font-size"
  | "invalid-font-weight"
  | "invalid-font-style";

export class TypographyTupleNormalizationError extends Error {
  constructor(public readonly code: TypographyTupleNormalizationErrorCode) {
    super(`Could not normalize typography tuple: ${code}`);
    this.name = "TypographyTupleNormalizationError";
  }
}

const CSS_NUMBER_SOURCE = String.raw`[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?`;
const COMPUTED_FONT_SIZE_PATTERN = new RegExp(String.raw`^(${CSS_NUMBER_SOURCE})px$`, "i");
const NUMERIC_FONT_WEIGHT_PATTERN = new RegExp(String.raw`^(${CSS_NUMBER_SOURCE})$`, "i");
const OBLIQUE_STYLE_PATTERN = new RegExp(
  String.raw`^oblique(?:\s+(${CSS_NUMBER_SOURCE})deg)?$`,
  "i"
);

/**
 * Normalize a raw computed typography tuple and derive its canonical identity.
 *
 * Invalid components throw a typed error so a materializer can account for the
 * candidate as skipped instead of fabricating a tuple.
 */
export function normalizeTypographyTuple(input: TypographyTupleInput): NormalizedTypographyTupleResult {
  if (unicodeScalarCountExceeds(input.fontFamily, MAX_COMPUTED_FONT_FAMILY_SCALARS)) {
    throw new TypographyTupleNormalizationError("font-family-too-long");
  }

  let parsedFamilies: ReturnType<typeof parseFontFamilyList>;
  try {
    parsedFamilies = parseFontFamilyList(input.fontFamily);
  } catch {
    throw new TypographyTupleNormalizationError("invalid-font-family");
  }

  const sizeMatch = input.fontSize.trim().match(COMPUTED_FONT_SIZE_PATTERN);
  const sizePx = sizeMatch ? Number(sizeMatch[1]) : Number.NaN;
  if (!(sizePx > 0) || !Number.isFinite(sizePx)) {
    throw new TypographyTupleNormalizationError("invalid-font-size");
  }
  const sizeMilliPx = quantizeSafeInteger(
    sizePx,
    TYPOGRAPHY_SIZE_MILLIPX_SCALE,
    "invalid-font-size"
  );

  const weightInput = foldAsciiCase(input.fontWeight.trim());
  let weight: number;
  if (weightInput === "normal") {
    weight = 400;
  } else if (weightInput === "bold") {
    weight = 700;
  } else {
    const weightMatch = weightInput.match(NUMERIC_FONT_WEIGHT_PATTERN);
    weight = weightMatch ? Number(weightMatch[1]) : Number.NaN;
  }
  if (!Number.isFinite(weight) || weight < 1 || weight > 1_000) {
    throw new TypographyTupleNormalizationError("invalid-font-weight");
  }
  const weightMilli = quantizeSafeInteger(
    weight,
    TYPOGRAPHY_WEIGHT_MILLI_SCALE,
    "invalid-font-weight"
  );

  const styleInput = foldAsciiCase(input.fontStyle.trim());
  let style: NormalizedTypographyStyle;
  if (styleInput === "normal" || styleInput === "italic") {
    style = styleInput;
  } else {
    const styleMatch = styleInput.match(OBLIQUE_STYLE_PATTERN);
    if (!styleMatch) {
      throw new TypographyTupleNormalizationError("invalid-font-style");
    }
    const angle = styleMatch[1] === undefined ? DEFAULT_OBLIQUE_DEGREES : Number(styleMatch[1]);
    if (!Number.isFinite(angle)) {
      throw new TypographyTupleNormalizationError("invalid-font-style");
    }
    const microdegrees = quantizeSafeInteger(
      angle,
      TYPOGRAPHY_STYLE_MICRODEGREE_SCALE,
      "invalid-font-style"
    );
    style = `oblique:${microdegrees}`;
  }

  const tuple: NormalizedTypographyTuple = {
    families: parsedFamilies.map(
      ({ kind, value }) => `${kind}\u0000${foldAsciiCase(value)}`
    ),
    sizeMilliPx,
    weightMilli,
    style
  };
  return { tuple, identity: typographyTupleIdentity(tuple) };
}

/** Canonical JSON serialization of a normalized typography tuple. */
export function typographyTupleIdentity(tuple: NormalizedTypographyTuple): string {
  return JSON.stringify({
    families: tuple.families,
    sizeMilliPx: tuple.sizeMilliPx,
    weightMilli: tuple.weightMilli,
    style: tuple.style
  });
}

function unicodeScalarCountExceeds(value: string, maximum: number): boolean {
  let count = 0;
  for (const _character of value) {
    count += 1;
    if (count > maximum) {
      return true;
    }
  }
  return false;
}

function quantizeSafeInteger(
  value: number,
  scale: number,
  errorCode: TypographyTupleNormalizationErrorCode
): number {
  const quantized = Math.round(value * scale);
  if (!Number.isSafeInteger(quantized)) {
    throw new TypographyTupleNormalizationError(errorCode);
  }
  return Object.is(quantized, -0) ? 0 : quantized;
}

/* -------------------------------------------------------------------------------------------------- */
/* Palette RGBA8 identity and OKLab hue cover                                                            */
/* -------------------------------------------------------------------------------------------------- */

export const OKLAB_CHROMA_QUANTIZATION_SCALE = 1_000_000;
export const OKLAB_ACHROMATIC_CUTOFF = 30_000;
export const HUE_MICRODEGREE_SCALE = 1_000_000;
export const HUE_TURN_MICRODEGREES = 360_000_000;
export const HUE_FAMILY_SPAN_MICRODEGREES = 30_000_000;

export interface Rgba8 {
  red: number;
  green: number;
  blue: number;
  alpha: number;
}

export interface QuantizedOklabChromaHue {
  /** `round(OKLab chroma * 1_000_000)`. */
  chromaMicro: number;
  /** Quantized hue in `[0, 360_000_000)`, or null below the achromatic cutoff. */
  hueMicrodegrees: number | null;
}

export interface CircularHueCover {
  count: number;
  /** Numerically sorted clockwise arc starts in microdegrees. */
  starts: number[];
}

/** Clamp and quantize a parsed CSS color to its exact rendered RGBA8 tuple. */
export function rgba8FromParsedColor(color: ParsedColor): Rgba8 | null {
  if (![color.red, color.green, color.blue, color.alpha].every(Number.isFinite)) {
    return null;
  }
  return {
    red: Math.round(clamp(color.red, 0, 255)),
    green: Math.round(clamp(color.green, 0, 255)),
    blue: Math.round(clamp(color.blue, 0, 255)),
    alpha: Math.round(clamp(color.alpha, 0, 1) * 255)
  };
}

/** Exact distinct-palette identity. Alpha remains identity-bearing. */
export function rgba8Identity(color: Rgba8): string {
  assertRgba8(color);
  return `${color.red},${color.green},${color.blue},${color.alpha}`;
}

/** The frozen cutoff is closed on its chromatic side: 29_999 is out, 30_000 is in. */
export function isChromaticOklabChroma(chromaMicro: number): boolean {
  return Number.isSafeInteger(chromaMicro) && chromaMicro >= OKLAB_ACHROMATIC_CUTOFF;
}

/**
 * Decode an sRGB byte triple and quantize its OKLab chroma and hue using the
 * frozen binary64 formula. Alpha does not participate.
 */
export function oklabChromaHueFromRgba8(color: Rgba8): QuantizedOklabChromaHue {
  assertRgba8(color);
  const red = decodeSrgbByte(color.red);
  const green = decodeSrgbByte(color.green);
  const blue = decodeSrgbByte(color.blue);

  const long = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
  const medium = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
  const short = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
  const aAxis = 1.9779984951 * long - 2.4285922050 * medium + 0.4505937099 * short;
  const bAxis = 0.0259040371 * long + 0.7827717662 * medium - 0.8086757660 * short;
  const chromaMicro = Math.round(
    Math.hypot(aAxis, bAxis) * OKLAB_CHROMA_QUANTIZATION_SCALE
  );

  if (!isChromaticOklabChroma(chromaMicro)) {
    return { chromaMicro, hueMicrodegrees: null };
  }

  const hueDegrees = positiveModulo(Math.atan2(bAxis, aAxis) * 180 / Math.PI, 360);
  const hueMicrodegrees = positiveModulo(
    Math.round(hueDegrees * HUE_MICRODEGREE_SCALE),
    HUE_TURN_MICRODEGREES
  );
  return { chromaMicro, hueMicrodegrees };
}

/**
 * Minimum closed clockwise 30-degree circular cover. Inputs are integer
 * microdegrees; order, duplicates, and whole-turn offsets do not affect output.
 */
export function minimumCircularHueCover(huesMicrodegrees: Iterable<number>): CircularHueCover {
  const unique = new Set<number>();
  for (const hue of huesMicrodegrees) {
    if (!Number.isSafeInteger(hue)) {
      throw new RangeError("Hue values must be safe integer microdegrees");
    }
    unique.add(positiveModulo(hue, HUE_TURN_MICRODEGREES));
  }
  const hues = [...unique].sort((left, right) => left - right);
  if (hues.length === 0) {
    return { count: 0, starts: [] };
  }

  let best: number[] | undefined;
  for (let rotation = 0; rotation < hues.length; rotation += 1) {
    const unwrapped = hues.map((_hue, offset) => {
      const index = (rotation + offset) % hues.length;
      return hues[index] + (index < rotation ? HUE_TURN_MICRODEGREES : 0);
    });
    const starts: number[] = [];
    let index = 0;
    while (index < unwrapped.length) {
      const start = unwrapped[index];
      starts.push(positiveModulo(start, HUE_TURN_MICRODEGREES));
      index += 1;
      while (
        index < unwrapped.length
        && unwrapped[index] <= start + HUE_FAMILY_SPAN_MICRODEGREES
      ) {
        index += 1;
      }
    }
    starts.sort((left, right) => left - right);
    if (
      best === undefined
      || starts.length < best.length
      || (starts.length === best.length && numericArrayLexicographicallyBefore(starts, best))
    ) {
      best = starts;
    }
  }

  return { count: best!.length, starts: best! };
}

/**
 * Collapse alpha variants to distinct nontransparent RGB triples, exclude
 * achromatic triples, then compute the frozen hue cover.
 */
export function hueFamilyCoverFromRgba8(colors: Iterable<Rgba8>): CircularHueCover {
  const seenRgb = new Set<string>();
  const hues: number[] = [];
  for (const color of colors) {
    assertRgba8(color);
    if (color.alpha === 0) {
      continue;
    }
    const rgbIdentity = `${color.red},${color.green},${color.blue}`;
    if (seenRgb.has(rgbIdentity)) {
      continue;
    }
    seenRgb.add(rgbIdentity);
    const { hueMicrodegrees } = oklabChromaHueFromRgba8(color);
    if (hueMicrodegrees !== null) {
      hues.push(hueMicrodegrees);
    }
  }
  return minimumCircularHueCover(hues);
}

function decodeSrgbByte(byte: number): number {
  const value = byte / 255;
  return value <= 0.04045
    ? value / 12.92
    : ((value + 0.055) / 1.055) ** 2.4;
}

function assertRgba8(color: Rgba8): void {
  if (![color.red, color.green, color.blue, color.alpha].every(
    (value) => Number.isInteger(value) && value >= 0 && value <= 255
  )) {
    throw new RangeError("RGBA8 channels must be integers in 0..255");
  }
}

function numericArrayLexicographicallyBefore(left: number[], right: number[]): boolean {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] < right[index];
    }
  }
  return false;
}

function positiveModulo(value: number, modulus: number): number {
  const remainder = value % modulus;
  if (remainder === 0) {
    return 0;
  }
  return remainder < 0 ? remainder + modulus : remainder;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return value < minimum ? minimum : value > maximum ? maximum : value;
}

/* -------------------------------------------------------------------------------------------------- */
/* Density fragment connectivity                                                                         */
/* -------------------------------------------------------------------------------------------------- */

export const MAX_DOM_ELEMENTS = 10_000;
export const MAX_TEXT_NODES = 20_000;
export const MAX_TEXT_FRAGMENTS = 20_000;
export const MAX_EDGE_TESTS = 1_000_000;
export const MAX_EVIDENCE_SAMPLES = 10;

export const MIN_VERTICAL_OVERLAP = 0.50;
export const MAX_INLINE_GAP_HEIGHTS = 1.00;
export const MIN_NEXT_LINE_X_OVERLAP = 0.25;
export const MAX_NEXT_LINE_GAP_HEIGHTS = 1.00;
export const MAX_LEFT_EDGE_DELTA_HEIGHTS = 1.00;

/** One positive, viewport-clipped text rectangle collected by the browser. */
export interface DensityTextFragment {
  /** Browser-assigned identity for the fragment's nearest block-like flow root. */
  rootId: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface DensityTextClusterCount {
  clusterCount: number;
  /** Exact number of unordered within-root pairs examined. */
  edgeTests: number;
  /**
   * Connected components expressed as original fragment indices. Indices are
   * sorted within each component; components are sorted by their first index.
   */
  components: number[][];
}

export type DensityClusterErrorCode =
  | "invalid-fragment"
  | "fragment-cap-exceeded"
  | "edge-cap-exceeded";

export class DensityClusterError extends Error {
  constructor(
    public readonly code: DensityClusterErrorCode,
    public readonly edgeTests: number
  ) {
    super(`Could not count density text clusters: ${code}`);
    this.name = "DensityClusterError";
  }
}

/** Frozen geometric adjacency predicate; fragments in different flow roots never connect. */
export function densityFragmentsAreAdjacent(
  left: DensityTextFragment,
  right: DensityTextFragment
): boolean {
  assertDensityTextFragment(left);
  assertDensityTextFragment(right);
  return left.rootId === right.rootId && fragmentGeometryIsAdjacent(left, right);
}

/**
 * Count union-find connected components across a flat fragment list, grouping
 * exclusively by `rootId` and enforcing the frozen fragment and edge caps.
 */
export function countDensityTextClusters(
  fragments: readonly DensityTextFragment[]
): DensityTextClusterCount {
  if (fragments.length > MAX_TEXT_FRAGMENTS) {
    throw new DensityClusterError("fragment-cap-exceeded", 0);
  }

  const byRoot = new Map<string, Array<{ fragment: DensityTextFragment; originalIndex: number }>>();
  for (let originalIndex = 0; originalIndex < fragments.length; originalIndex += 1) {
    const fragment = fragments[originalIndex];
    assertDensityTextFragment(fragment);
    const group = byRoot.get(fragment.rootId);
    if (group) {
      group.push({ fragment, originalIndex });
    } else {
      byRoot.set(fragment.rootId, [{ fragment, originalIndex }]);
    }
  }

  let edgeTests = 0;
  const components: number[][] = [];
  for (const group of byRoot.values()) {
    const parents = group.map((_entry, index) => index);

    for (let left = 0; left < group.length; left += 1) {
      for (let right = left + 1; right < group.length; right += 1) {
        edgeTests += 1;
        if (edgeTests > MAX_EDGE_TESTS) {
          throw new DensityClusterError("edge-cap-exceeded", edgeTests);
        }
        if (fragmentGeometryIsAdjacent(group[left].fragment, group[right].fragment)) {
          unionParents(parents, left, right);
        }
      }
    }

    const indicesByRoot = new Map<number, number[]>();
    for (let index = 0; index < parents.length; index += 1) {
      const root = findParent(parents, index);
      const component = indicesByRoot.get(root);
      if (component) {
        component.push(group[index].originalIndex);
      } else {
        indicesByRoot.set(root, [group[index].originalIndex]);
      }
    }
    for (const component of indicesByRoot.values()) {
      component.sort((left, right) => left - right);
      components.push(component);
    }
  }

  components.sort((left, right) => left[0] - right[0]);
  return { clusterCount: components.length, edgeTests, components };
}

function assertDensityTextFragment(fragment: DensityTextFragment): void {
  if (
    typeof fragment.rootId !== "string"
    || ![fragment.left, fragment.top, fragment.right, fragment.bottom].every(Number.isFinite)
    || !(fragment.right > fragment.left)
    || !(fragment.bottom > fragment.top)
  ) {
    throw new DensityClusterError("invalid-fragment", 0);
  }
}

function fragmentGeometryIsAdjacent(
  left: DensityTextFragment,
  right: DensityTextFragment
): boolean {
  const gapX = Math.max(0, Math.max(left.left, right.left) - Math.min(left.right, right.right));
  const gapY = Math.max(0, Math.max(left.top, right.top) - Math.min(left.bottom, right.bottom));
  const overlapX = Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left));
  const overlapY = Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
  const leftHeight = left.bottom - left.top;
  const rightHeight = right.bottom - right.top;
  const maximumHeight = Math.max(leftHeight, rightHeight);
  const minimumHeight = Math.min(leftHeight, rightHeight);
  const minimumWidth = Math.min(left.right - left.left, right.right - right.left);

  return (gapX === 0 && gapY === 0)
    || (
      overlapY >= MIN_VERTICAL_OVERLAP * minimumHeight
      && gapX <= MAX_INLINE_GAP_HEIGHTS * maximumHeight
    )
    || (
      gapY <= MAX_NEXT_LINE_GAP_HEIGHTS * maximumHeight
      && (
        overlapX >= MIN_NEXT_LINE_X_OVERLAP * minimumWidth
        || Math.abs(left.left - right.left) <= MAX_LEFT_EDGE_DELTA_HEIGHTS * maximumHeight
      )
    );
}

function findParent(parents: number[], index: number): number {
  let root = index;
  while (parents[root] !== root) {
    root = parents[root];
  }
  while (parents[index] !== index) {
    const next = parents[index];
    parents[index] = root;
    index = next;
  }
  return root;
}

function unionParents(parents: number[], left: number, right: number): void {
  const leftRoot = findParent(parents, left);
  const rightRoot = findParent(parents, right);
  if (leftRoot !== rightRoot) {
    parents[rightRoot] = leftRoot;
  }
}

/* -------------------------------------------------------------------------------------------------- */
/* Oklab → sRGB                                                                                          */
/* -------------------------------------------------------------------------------------------------- */

/**
 * Ottosson's published constants (bottosson.github.io/posts/oklab/), which CSS Color 4 §9.2 specifies
 * normatively and Chromium implements. Deriving M1 independently from D65 primaries does not reproduce
 * these to better than 3.02e-4 per element — a known imprecision in the original derivation. The published
 * values are used regardless, because exact agreement with what Chromium paints is worth more than
 * notional colorimetric correctness; the measured divergence on contrast ratios is <= 7e-6 either way.
 *
 * Verified: rounding this pipeline's output reproduces Chromium's own canvas `getImageData` at zero
 * channel difference on all eight vectors in the test table, including out-of-gamut ones.
 */
const OKLAB_TO_LMS = [
  [1.0, 0.3963377773761749, 0.2158037573099136],
  [1.0, -0.1055613458156586, -0.0638541728258133],
  [1.0, -0.0894841775298119, -1.2914855480194092]
] as const;

const LMS_TO_LINEAR_SRGB = [
  [4.0767416360759583, -3.3077115392580629, 0.2309699031821043],
  [-1.2684380040921763, 2.6097574006633715, -0.3413193963102197],
  [-0.0041960862485017, -0.7034186179359362, 1.7076147009309444]
] as const;

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * sRGB (IEC 61966-2-1) gamma encode. The threshold is 0.0031308 — the *encode* breakpoint, deliberately
 * different from the 0.03928 decode threshold in `relativeLuminance`. Do not unify them.
 */
function encodeSrgb(value: number): number {
  return value <= 0.0031308 ? 12.92 * value : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
}

/**
 * Oklab → gamma-encoded sRGB, clamping linear channels to [0, 1] before encoding.
 *
 * The clamp is load-bearing in two directions. Negative linear channels are ordinary for in-CSS colours
 * (`oklch(0.5 0.3 150)` gives linear R = -0.128), and `Math.pow` of a negative is `NaN`, which would
 * propagate through `relativeLuminance` and then be silently dropped by the `Number.isFinite` filter with
 * no skip recorded. Above 1 it is equally real: `oklab(0.999994 …)` — the verbatim `color-mix(in oklab,
 * white 6%, transparent)` output that surfaces both tokens fixtures — lands at linear R = 1.000296.
 *
 * Clamping is also what Chromium does: `oklch(0.7 0.35 150)` rasterises to exactly `(0, 209, 0)` in its
 * canvas, matching this function. For a check that measures what a user sees on an sRGB display,
 * reproducing the renderer's clipping is correct, not a compromise. Contrast collapses three channels to
 * one luminance, so CSS Color 4 chroma-reduction gamut mapping would buy nothing measurable here.
 */
function oklabToSrgb(lightness: number, aAxis: number, bAxis: number, alpha: number): ParsedColor | null {
  if (![lightness, aAxis, bAxis, alpha].every((value) => Number.isFinite(value))) {
    return null;
  }
  const longPrime = OKLAB_TO_LMS[0][0] * lightness + OKLAB_TO_LMS[0][1] * aAxis + OKLAB_TO_LMS[0][2] * bAxis;
  const mediumPrime = OKLAB_TO_LMS[1][0] * lightness + OKLAB_TO_LMS[1][1] * aAxis + OKLAB_TO_LMS[1][2] * bAxis;
  const shortPrime = OKLAB_TO_LMS[2][0] * lightness + OKLAB_TO_LMS[2][1] * aAxis + OKLAB_TO_LMS[2][2] * bAxis;
  const long = longPrime * longPrime * longPrime;
  const medium = mediumPrime * mediumPrime * mediumPrime;
  const short = shortPrime * shortPrime * shortPrime;
  const channels = [0, 1, 2].map((row) =>
    255 * encodeSrgb(clamp01(
      LMS_TO_LINEAR_SRGB[row][0] * long
      + LMS_TO_LINEAR_SRGB[row][1] * medium
      + LMS_TO_LINEAR_SRGB[row][2] * short
    ))
  );
  return { red: channels[0], green: channels[1], blue: channels[2], alpha: clamp01(alpha) };
}

/* -------------------------------------------------------------------------------------------------- */
/* Parsing                                                                                               */
/* -------------------------------------------------------------------------------------------------- */

// Anchored. The shipped RGB_PATTERN was unanchored, which is safe only because no other computed form
// contains the substring "rgb(" — an unanchored oklch pattern would match inside fallback text.
const NUMBER = String.raw`(-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?%?|none)`;
const LEGACY_RGB_PATTERN = new RegExp(
  String.raw`^rgba?\(\s*${NUMBER}[\s,]+${NUMBER}[\s,]+${NUMBER}\s*(?:[,/]\s*${NUMBER}\s*)?\)$`, "i");
const OKLAB_PATTERN = new RegExp(
  String.raw`^oklab\(\s*${NUMBER}\s+${NUMBER}\s+${NUMBER}\s*(?:/\s*${NUMBER}\s*)?\)$`, "i");
const OKLCH_PATTERN = new RegExp(
  String.raw`^oklch\(\s*${NUMBER}\s+${NUMBER}\s+${NUMBER}(?:deg)?\s*(?:/\s*${NUMBER}\s*)?\)$`, "i");
const SRGB_PATTERN = new RegExp(
  String.raw`^color\(\s*srgb\s+${NUMBER}\s+${NUMBER}\s+${NUMBER}\s*(?:/\s*${NUMBER}\s*)?\)$`, "i");

/**
 * One component token. `none` behaves as 0 per CSS Color 4 §4.4 — Chromium serialises `oklch(none 0.1 200)`
 * verbatim, and letting that token reach `parseFloat` returns `NaN`, which produces a `NaN` ratio that the
 * `Number.isFinite` filter drops *without* recording a skip. Percentage scale is per-component: lightness
 * and alpha are relative to 1, a/b/chroma to 0.4 (§9.2), rgb channels to 255.
 */
function component(token: string | undefined, percentScale: number): number {
  if (token === undefined) {
    return 0;
  }
  const trimmed = token.trim().toLowerCase();
  if (trimmed === "none") {
    return 0;
  }
  const parsed = Number.parseFloat(trimmed);
  if (!Number.isFinite(parsed)) {
    return Number.NaN;
  }
  return trimmed.endsWith("%") ? (parsed / 100) * percentScale : parsed;
}

/**
 * Parses a *computed* colour serialisation, returning `null` for anything it cannot convert exactly.
 *
 * `null` is the whole point: it replaces the shipped fail-open to opaque black, which was the root cause of
 * both the fabricated 1:1 ratios and the halted ancestor walk (the fallback reported `alpha: 1`). `null`
 * must stay distinguishable from a legitimately parsed transparent black.
 *
 * Handled, all probed against Chromium 149:
 *  - `rgb()` / `rgba()`, including the modern `rgb(r g b / a%)` form — Chromium normalises that to legacy
 *    `rgba(r, g, b, a)` before it ever reaches here, so no widening was needed, only anchoring.
 *  - `oklab()` / `oklch()`, converted exactly.
 *  - `color(srgb …)`, which is what `color-mix(in srgb, …)` serialises to — a different form from the
 *    `in oklab` case the fixtures use, and trivially convertible rather than skippable.
 * Everything else — `color(display-p3 …)`, `lab()`, `lch()`, `color()` in any other space, and unparseable
 * text — returns `null` and the caller skips. `hsl()` and `hwb()` never reach the fallback: Chromium
 * serialises both to `rgb()`.
 */
export function parseCssColor(value: string): ParsedColor | null {
  if (typeof value !== "string") {
    return null;
  }
  const input = value.trim();

  const legacy = input.match(LEGACY_RGB_PATTERN);
  if (legacy) {
    const red = component(legacy[1], 255);
    const green = component(legacy[2], 255);
    const blue = component(legacy[3], 255);
    const alpha = legacy[4] === undefined ? 1 : component(legacy[4], 1);
    if (![red, green, blue, alpha].every((channel) => Number.isFinite(channel))) {
      return null;
    }
    return { red, green, blue, alpha: clamp01(alpha) };
  }

  const oklab = input.match(OKLAB_PATTERN);
  if (oklab) {
    return oklabToSrgb(
      component(oklab[1], 1),
      component(oklab[2], 0.4),
      component(oklab[3], 0.4),
      oklab[4] === undefined ? 1 : component(oklab[4], 1)
    );
  }

  const oklch = input.match(OKLCH_PATTERN);
  if (oklch) {
    const lightness = component(oklch[1], 1);
    const chroma = component(oklch[2], 0.4);
    const hue = component(oklch[3], 360);
    if (!Number.isFinite(hue)) {
      return null;
    }
    const radians = (hue * Math.PI) / 180;
    return oklabToSrgb(
      lightness,
      chroma * Math.cos(radians),
      chroma * Math.sin(radians),
      oklch[4] === undefined ? 1 : component(oklch[4], 1)
    );
  }

  const srgb = input.match(SRGB_PATTERN);
  if (srgb) {
    const red = component(srgb[1], 1);
    const green = component(srgb[2], 1);
    const blue = component(srgb[3], 1);
    const alpha = srgb[4] === undefined ? 1 : component(srgb[4], 1);
    if (![red, green, blue, alpha].every((channel) => Number.isFinite(channel))) {
      return null;
    }
    return { red: clamp01(red) * 255, green: clamp01(green) * 255, blue: clamp01(blue) * 255, alpha: clamp01(alpha) };
  }

  return null;
}

/* -------------------------------------------------------------------------------------------------- */
/* Compositing                                                                                           */
/* -------------------------------------------------------------------------------------------------- */

/**
 * Source-over composite of `layers` (top-most first) onto an opaque `base`.
 *
 * Folded bottom-up so the accumulator starts opaque and therefore stays opaque, which collapses the general
 * Porter-Duff form to a plain lerp and removes every division-by-zero branch.
 *
 * `base` is only reachable when no layer is opaque: an `alpha === 1` layer sets `out` to itself and
 * discards everything below, so passing the canvas colour unconditionally is exactly equivalent to
 * branching on whether the walk terminated. Verified: identical to the last float bit.
 */
export function compositeOver(layers: ParsedColor[], base: ParsedColor): ParsedColor {
  let out = base;
  for (let index = layers.length - 1; index >= 0; index -= 1) {
    const layer = layers[index];
    const alpha = clamp01(layer.alpha);
    out = {
      red: alpha * layer.red + (1 - alpha) * out.red,
      green: alpha * layer.green + (1 - alpha) * out.green,
      blue: alpha * layer.blue + (1 - alpha) * out.blue,
      alpha: 1
    };
  }
  return out;
}

/** Serialises a composited colour for the evidence block. Rounds for display only — never for arithmetic. */
function serializeColor(color: ParsedColor): string {
  return `rgb(${Math.round(color.red)}, ${Math.round(color.green)}, ${Math.round(color.blue)})`;
}

/* -------------------------------------------------------------------------------------------------- */
/* Scoring                                                                                               */
/* -------------------------------------------------------------------------------------------------- */

/**
 * WCAG 2.x relative luminance over gamma-encoded sRGB channels.
 *
 * The linearisation threshold is `0.03928`, matching WCAG 2.x and the value this check has always shipped;
 * the sRGB specification's own figure is `0.04045`. For 8-bit channels they are provably equivalent — no
 * integer `v` satisfies `0.03928 <= v/255 <= 0.04045` — and compositing now makes that interval reachable
 * with fractional channels. Measured worst case across the interval: 7.555e-7 per-channel linearised
 * divergence at v ~ 0.039302, propagating to at most 2.82e-4 on a contrast ratio. That only changes a
 * verdict when a ratio sits within 0.00028 of its threshold, so the shipped constant is kept deliberately
 * rather than changed as a side effect of step 4.
 */
export function relativeLuminance(color: { red: number; green: number; blue: number }): number {
  const [red, green, blue] = [color.red, color.green, color.blue].map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** WCAG 2.x contrast ratio. Both arguments must already be composited to opaque. */
export function contrastRatio(
  foreground: { red: number; green: number; blue: number },
  background: { red: number; green: number; blue: number }
): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

/** SC 1.4.3: 3:1 for large text (>=24px, or >=18.66px at weight >=700), otherwise 4.5:1. */
export function requiredContrastRatio(fontSizePx: number, fontWeight: number): number {
  return fontSizePx >= 24 || (fontSizePx >= 18.66 && fontWeight >= 700) ? 3 : 4.5;
}

/** Maximum contrast samples carried in a viewport's measurement payload. */
export const MAX_CONTRAST_SAMPLES = 10;

/**
 * Scores collected candidates and keeps only those below their required ratio.
 *
 * Channels stay fractional all the way into `relativeLuminance`. Rounding composited channels to integers
 * first reintroduces up to 0.5/255 of error, which moves the clean-corpus ratios by up to 0.034 — enough to
 * flip a verdict near 4.5. The only rounding is presentational, in `checks.ts`.
 *
 * `ContrastRiskSample` keeps its shipped seven-key shape and field order, so `audit.json` serialisation is
 * unchanged. `color` remains the declared foreground (actionable in devtools); `backgroundColor` is now the
 * *composited* backdrop rather than the first ancestor string, which is what that field always meant.
 */
export function computeContrastRisks(candidates: ContrastCandidate[]): ContrastRiskResult {
  const risks: ContrastRiskSample[] = [];
  const skippedByReason: Partial<Record<ContrastSkipReason, number>> = {};
  let evaluatedElementCount = 0;
  let skippedElementCount = 0;

  const skip = (reason: ContrastSkipReason): void => {
    skippedElementCount += 1;
    skippedByReason[reason] = (skippedByReason[reason] ?? 0) + 1;
  };

  for (const candidate of candidates) {
    const { color, backgroundLayers, canvasColor, fontSizePx, fontWeight, skipReason, ...sample } = candidate;

    if (skipReason) {
      skip(skipReason);
      continue;
    }

    const foreground = parseCssColor(color);
    if (!foreground) {
      skip("unsupported-color-space");
      continue;
    }
    // Alpha 0 means no glyph is painted, so there is nothing to contrast. Compositing both channels would
    // otherwise make the foreground equal the background and report a fabricated 1.000:1 on every skeleton
    // loader and width-reservation span. The foreground is sourced from `-webkit-text-fill-color` in the
    // closure, so text that is `color: transparent` but painted via a fill colour is still evaluated.
    if (foreground.alpha === 0) {
      skip("invisible-text");
      continue;
    }

    const layers: ParsedColor[] = [];
    let layersParsed = true;
    for (const layer of backgroundLayers) {
      const parsed = parseCssColor(layer);
      if (!parsed) {
        layersParsed = false;
        break;
      }
      layers.push(parsed);
    }
    const base = parseCssColor(canvasColor);
    if (!layersParsed || !base) {
      skip("unsupported-color-space");
      continue;
    }

    const background = compositeOver(layers, base);
    const composited = compositeOver([foreground, ...layers], base);
    const ratio = contrastRatio(composited, background);
    if (!Number.isFinite(ratio)) {
      skip("unsupported-color-space");
      continue;
    }

    evaluatedElementCount += 1;
    const requiredRatio = requiredContrastRatio(fontSizePx, fontWeight);
    if (ratio < requiredRatio) {
      risks.push({
        ...sample,
        ratio,
        requiredRatio,
        color,
        backgroundColor: serializeColor(background)
      });
    }
  }

  return {
    risks: risks.slice(0, MAX_CONTRAST_SAMPLES),
    detectedCount: risks.length,
    coverage: { evaluatedElementCount, skippedElementCount, skippedByReason }
  };
}
/* -------------------------------------------------------------------------------------------------- */
/* Tap-target Spacing exception (WCAG 2.2 SC 2.5.8)                                                      */
/* -------------------------------------------------------------------------------------------------- */

/** A rectangle in CSS pixels, as read from getBoundingClientRect. */
export interface TargetRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One interactive element observed for tap-target evaluation. Geometry only; no DOM. */
export interface TapTargetCandidate extends ElementSample {
  rect: TargetRect;
}

/** Maximum tap-target samples carried in a viewport's measurement payload. */
export const MAX_TAP_TARGET_SAMPLES = 10;

export interface TapTargetRiskResult {
  risks: ElementSample[];
  /** Exact count after evaluating the Spacing exception against the complete neighbour set. */
  detectedCount: number;
}

/** SC 2.5.8's minimum, and the derived circle radius. */
export const TAP_TARGET_MINIMUM_PX = 24;
const TAP_TARGET_RADIUS_PX = TAP_TARGET_MINIMUM_PX / 2;

function centre(rect: TargetRect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/** A target is undersized when either dimension is under 24px (and it has non-zero area). */
export function isUndersizedTarget(rect: TargetRect): boolean {
  return rect.width > 0 && rect.height > 0 && (rect.width < TAP_TARGET_MINIMUM_PX || rect.height < TAP_TARGET_MINIMUM_PX);
}

/** Euclidean distance from a point to the nearest edge of a rectangle; 0 when the point is inside. */
export function pointToRectDistance(point: { x: number; y: number }, rect: TargetRect): number {
  const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.width));
  const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.height));
  return Math.hypot(dx, dy);
}

/** Distance between the centres of two rectangles. */
export function centreDistance(a: TargetRect, b: TargetRect): number {
  const ca = centre(a);
  const cb = centre(b);
  return Math.hypot(ca.x - cb.x, ca.y - cb.y);
}

/**
 * WCAG 2.5.8 Spacing exception, conjunctive reading of the normative text: an undersized target is exempt
 * when its 24px-diameter circle intersects *neither* the bounding box of any other target, *nor* the 24px
 * circle of any other undersized target.
 *
 * Intersection is strict, so a circle tangent to a neighbour (distance exactly 12, or exactly 24 between
 * two undersized circles) is exempt — matching "do not intersect".
 *
 * The two tests are not redundant. The rect test alone would under-exempt two small targets whose boxes
 * are far but whose circles overlap; the circle test alone would over-exempt a small target hugging a
 * large one. The literal spec is their conjunction.
 */
export function tapTargetSpacingExempt(target: TargetRect, neighbours: TargetRect[]): boolean {
  const targetCentre = centre(target);
  for (const neighbour of neighbours) {
    if (neighbour === target) {
      continue;
    }
    if (pointToRectDistance(targetCentre, neighbour) < TAP_TARGET_RADIUS_PX) {
      return false;
    }
    if (isUndersizedTarget(neighbour) && centreDistance(target, neighbour) < TAP_TARGET_MINIMUM_PX) {
      return false;
    }
  }
  return true;
}

/**
 * Flags undersized interactive targets that are not exempt under the Spacing exception.
 *
 * Every interactive element participates as a *neighbour* (the rect test runs against sized targets too),
 * but only undersized elements can be *flagged*. Runs over the full set before any slice, so a genuine
 * violation cannot be pushed out of the sample window by exempt neighbours.
 */
export function computeTapTargetRisks(candidates: TapTargetCandidate[]): TapTargetRiskResult {
  const rects = candidates.map((candidate) => candidate.rect);
  const risks: ElementSample[] = [];
  for (const candidate of candidates) {
    const { rect, ...sample } = candidate;
    if (!isUndersizedTarget(rect)) {
      continue;
    }
    if (tapTargetSpacingExempt(rect, rects)) {
      continue;
    }
    risks.push(sample);
  }
  return {
    risks: risks.slice(0, MAX_TAP_TARGET_SAMPLES),
    detectedCount: risks.length
  };
}

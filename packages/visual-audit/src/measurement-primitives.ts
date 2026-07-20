import type { ContrastRiskSample, ElementSample } from "./checks.js";

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

/** One text element as observed in the page, before any contrast arithmetic. */
export interface ContrastCandidate extends ElementSample {
  /** Computed `color`, verbatim. */
  color: string;
  /**
   * Effective background as resolved by the DOM walk, verbatim. Today this is the computed
   * `background-color` of the nearest ancestor with a non-zero alpha, which is why translucent surfaces
   * are mis-scored — the repair changes what the browser collects here, not where it is computed.
   */
  backgroundColor: string;
  fontSizePx: number;
  fontWeight: number;
}

export interface ParsedColor {
  red: number;
  green: number;
  blue: number;
  alpha: number;
}

const RGB_PATTERN = /rgba?\(([^)]+)\)/;

/**
 * Parses a computed colour serialisation.
 *
 * Preserves the shipped fail-open behaviour exactly: anything that is not `rgb()`/`rgba()` yields opaque
 * black rather than a failure signal. Chromium serialises `oklch()`, `oklab()`, `color(display-p3 …)` and
 * `lab()` in their own colour space, so those all land on this fallback today — and because the fallback
 * reports `alpha: 1`, it also terminates the ancestor walk. Correcting that is step 4's job; this module
 * exists so the correction is testable.
 */
export function parseRgb(value: string): ParsedColor {
  const match = value.match(RGB_PATTERN);
  if (!match) {
    return { red: 0, green: 0, blue: 0, alpha: 1 };
  }
  const [red, green, blue, alpha = "1"] = match[1].split(",").map((part) => part.trim());
  return {
    red: Number.parseFloat(red),
    green: Number.parseFloat(green),
    blue: Number.parseFloat(blue),
    alpha: Number.parseFloat(alpha)
  };
}

/**
 * WCAG 2.x relative luminance over gamma-encoded sRGB channels.
 *
 * The linearisation threshold is `0.03928`, matching the constant WCAG 2.x specifies and the value this
 * check has always shipped. The sRGB specification's own figure is `0.04045`; the two are provably
 * equivalent for 8-bit channels, because no integer `v` satisfies `0.03928 <= v/255 <= 0.04045`. They can
 * differ in about the sixth decimal for fractional channels, which alpha compositing will start producing.
 * Changing it is therefore a deliberate decision, not a side effect of moving this function out of the
 * browser closure — so the shipped constant is preserved here.
 */
export function relativeLuminance(color: { red: number; green: number; blue: number }): number {
  const [red, green, blue] = [color.red, color.green, color.blue].map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** WCAG 2.x contrast ratio. Alpha is ignored by design here; compositing is the caller's responsibility. */
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
 * Field order matches the shipped `ContrastRiskSample` shape so the serialised measurement evidence is
 * unchanged by the extraction.
 */
export function computeContrastRisks(candidates: ContrastCandidate[]): ContrastRiskSample[] {
  return candidates
    .map((candidate) => {
      const { color, backgroundColor, fontSizePx, fontWeight, ...sample } = candidate;
      return {
        ...sample,
        ratio: contrastRatio(parseRgb(color), parseRgb(backgroundColor)),
        requiredRatio: requiredContrastRatio(fontSizePx, fontWeight),
        color,
        backgroundColor
      };
    })
    .filter((sample) => Number.isFinite(sample.ratio) && sample.ratio < sample.requiredRatio)
    .slice(0, MAX_CONTRAST_SAMPLES);
}

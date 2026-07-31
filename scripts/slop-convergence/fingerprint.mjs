/**
 * Browserless source-level fingerprint extraction and pairwise distance.
 *
 * No dependency is added, so HTML is read with regular expressions. Regex HTML
 * parsing is fragile, so the extractor is fail-closed: any construct it was not
 * designed to interpret raises instead of silently producing a partial
 * fingerprint. This mirrors the project's existing rule that a missing evidence
 * layer must skip rather than emit garbage.
 */

import { DIMENSIONS, UNSUPPORTED_SOURCE_PATTERNS } from "./contract.mjs";

const TAG_PATTERN = /<([a-zA-Z][a-zA-Z0-9-]*)\b/g;
const CLASS_ATTR_PATTERN = /\bclass\s*=\s*"([^"]*)"/g;
const STYLE_BLOCK_PATTERN = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
const STYLE_ATTR_PATTERN = /\bstyle\s*=\s*"([^"]*)"/g;

const HEX_COLOR_PATTERN = /#[0-9a-fA-F]{3,8}\b/g;
const FUNC_COLOR_PATTERN = /\b(?:rgb|rgba|hsl|hsla|oklch|oklab)\(\s*[^)]*\)/gi;
const FONT_SIZE_PATTERN = /\bfont-size\s*:\s*([^;"}]+)/gi;
const FONT_WEIGHT_PATTERN = /\bfont-weight\s*:\s*([^;"}]+)/gi;
const RADIUS_PATTERN = /\bborder-radius\s*:\s*([^;"}]+)/gi;
const SPACING_PATTERN = /\b(?:margin|padding|gap|row-gap|column-gap)(?:-(?:top|right|bottom|left))?\s*:\s*([^;"}]+)/gi;
const DISPLAY_PATTERN = /\bdisplay\s*:\s*([^;"}]+)/gi;

const LAYOUT_MODES = Object.freeze(["flex", "grid", "block", "inline-block", "inline-flex", "other"]);

export class UnsupportedSourceError extends Error {
  constructor(id, label) {
    super(`${label}: fingerprint extraction refuses unsupported construct "${id}"`);
    this.name = "UnsupportedSourceError";
    this.constructId = id;
  }
}

function assertSupported(source, label) {
  for (const { id, pattern } of UNSUPPORTED_SOURCE_PATTERNS) {
    if (pattern.test(source)) throw new UnsupportedSourceError(id, label);
  }
}

function collect(pattern, source, transform) {
  const found = [];
  pattern.lastIndex = 0;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const value = transform(match);
    if (value !== undefined && value !== null && value !== "") found.push(value);
  }
  return found;
}

function normalizeDeclaration(raw) {
  return raw.trim().toLowerCase().replace(/\s+/g, " ").replace(/;+$/, "");
}

/** All CSS text the probe can see: embedded <style> blocks plus inline style attributes. */
function cssText(source) {
  const blocks = collect(STYLE_BLOCK_PATTERN, source, (match) => match[1]);
  const inline = collect(STYLE_ATTR_PATTERN, source, (match) => match[1]);
  return [...blocks, ...inline].join("\n");
}

function layoutModeHistogram(css) {
  const histogram = Object.fromEntries(LAYOUT_MODES.map((mode) => [mode, 0]));
  for (const raw of collect(DISPLAY_PATTERN, css, (match) => normalizeDeclaration(match[1]))) {
    histogram[LAYOUT_MODES.includes(raw) ? raw : "other"] += 1;
  }
  return histogram;
}

/**
 * Extract one fingerprint from HTML source bytes.
 *
 * Every returned dimension is source-derived. None is a rendered value.
 */
export function fingerprintSource(source, label) {
  if (typeof source !== "string" || source.length === 0) {
    throw new Error(`${label}: source must be a non-empty string`);
  }
  assertSupported(source, label);

  const css = cssText(source);
  const tagHistogram = {};
  for (const tag of collect(TAG_PATTERN, source, (match) => match[1].toLowerCase())) {
    tagHistogram[tag] = (tagHistogram[tag] ?? 0) + 1;
  }

  const classTokens = new Set();
  for (const attr of collect(CLASS_ATTR_PATTERN, source, (match) => match[1])) {
    for (const token of attr.trim().split(/\s+/)) {
      if (token) classTokens.add(token.toLowerCase());
    }
  }

  const colorLiterals = new Set([
    ...collect(HEX_COLOR_PATTERN, css, (match) => match[0].toLowerCase()),
    ...collect(FUNC_COLOR_PATTERN, css, (match) => normalizeDeclaration(match[0]))
  ]);

  const spacingLiterals = new Set();
  for (const raw of collect(SPACING_PATTERN, css, (match) => normalizeDeclaration(match[1]))) {
    for (const part of raw.split(" ")) if (part) spacingLiterals.add(part);
  }

  if (Object.keys(tagHistogram).length === 0) {
    throw new Error(`${label}: no elements found; refusing to emit an empty fingerprint`);
  }

  return {
    tagHistogram,
    classTokens: [...classTokens].sort(),
    colorLiterals: [...colorLiterals].sort(),
    fontSizeLiterals: [...new Set(collect(FONT_SIZE_PATTERN, css, (m) => normalizeDeclaration(m[1])))].sort(),
    fontWeightLiterals: [...new Set(collect(FONT_WEIGHT_PATTERN, css, (m) => normalizeDeclaration(m[1])))].sort(),
    spacingLiterals: [...spacingLiterals].sort(),
    radiusLiterals: [...new Set(collect(RADIUS_PATTERN, css, (m) => normalizeDeclaration(m[1])))].sort(),
    layoutModeHistogram: layoutModeHistogram(css)
  };
}

/** Jaccard distance. Two empty sets are identical, so distance 0. */
export function jaccardDistance(left, right) {
  const a = new Set(left);
  const b = new Set(right);
  if (a.size === 0 && b.size === 0) return 0;
  let shared = 0;
  for (const value of a) if (b.has(value)) shared += 1;
  return 1 - shared / (a.size + b.size - shared);
}

/** Cosine distance over a sparse count map. Two empty maps are identical. */
export function cosineDistance(left, right) {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  if (keys.size === 0) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (const key of keys) {
    const a = left[key] ?? 0;
    const b = right[key] ?? 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm === 0 || rightNorm === 0) return leftNorm === rightNorm ? 0 : 1;
  const similarity = dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
  return Math.min(1, Math.max(0, 1 - similarity));
}

/** Per-dimension distance plus the (arbitrary) unweighted mean. */
export function fingerprintDistance(left, right) {
  const perDimension = {};
  for (const { id, kind } of DIMENSIONS) {
    perDimension[id] =
      kind === "set" ? jaccardDistance(left[id], right[id]) : cosineDistance(left[id], right[id]);
  }
  const values = Object.values(perDimension);
  return { perDimension, mean: values.reduce((sum, value) => sum + value, 0) / values.length };
}

/** Mean, min, and max pairwise distance across a corpus of fingerprints. */
export function pairwiseSummary(fingerprints) {
  if (fingerprints.length < 2) {
    throw new Error("pairwiseSummary requires at least two fingerprints");
  }
  const means = [];
  const dimensionTotals = Object.fromEntries(DIMENSIONS.map(({ id }) => [id, 0]));
  for (let i = 0; i < fingerprints.length; i += 1) {
    for (let j = i + 1; j < fingerprints.length; j += 1) {
      const { perDimension, mean } = fingerprintDistance(fingerprints[i], fingerprints[j]);
      means.push(mean);
      for (const [id, value] of Object.entries(perDimension)) dimensionTotals[id] += value;
    }
  }
  const pairCount = means.length;
  const round = (value) => Number(value.toFixed(6));
  return {
    pairCount,
    meanDistance: round(means.reduce((sum, value) => sum + value, 0) / pairCount),
    minDistance: round(Math.min(...means)),
    maxDistance: round(Math.max(...means)),
    perDimensionMean: Object.fromEntries(
      Object.entries(dimensionTotals).map(([id, total]) => [id, round(total / pairCount)])
    )
  };
}

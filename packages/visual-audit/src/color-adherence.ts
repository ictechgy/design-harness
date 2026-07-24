import {
  rgba8ColorIdentity,
  type ColorAdherencePolicy,
  type Rgba8Color
} from "@design-harness/core";
import { parseCssColor } from "./measurement-primitives.js";

const MAX_GROUPS = 5;
const MAX_SAMPLES_PER_GROUP = 5;

export type ColorPaintProperty =
  | "color"
  | "background-color"
  | "border-top-color"
  | "border-right-color"
  | "border-bottom-color"
  | "border-left-color";

export interface ColorAdherenceCandidate {
  selector: string;
  region: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  property: ColorPaintProperty;
  value: string;
}

export interface ColorAdherenceCollectionCounts {
  candidateSlotCount: number;
  ignoredSlotCount: number;
  skippedSlotCount: number;
  skippedByReason: Partial<Record<ColorAdherenceSkipReason, number>>;
}

export type ColorAdherenceSkipReason = "computed-color-too-long" | "unsupported-color";
export type ColorAdherenceIgnoreReason = "selector-exception" | "transparent";

export interface ColorAdherenceViolationGroup {
  property: ColorPaintProperty;
  unexpectedColor: Rgba8Color;
  rawComputedValues: string[];
  affectedSlotCount: number;
  selectors: string[];
  regions: ColorAdherenceCandidate["region"][];
  sampleCount: number;
  omittedSampleCount: number;
}

export interface ColorAdherenceSummary {
  policyId: "color-adherence-v1";
  allowedColors: Rgba8Color[];
  candidateSlotCount: number;
  evaluatedSlotCount: number;
  ignoredSlotCount: number;
  ignoredByReason: Partial<Record<ColorAdherenceIgnoreReason, number>>;
  skippedSlotCount: number;
  skippedByReason: Partial<Record<ColorAdherenceSkipReason, number>>;
  violatingSlotCount: number;
  distinctViolationGroupCount: number;
  emittedGroupCount: number;
  truncatedGroupCount: number;
  groups: ColorAdherenceViolationGroup[];
}

export interface ColorAdherenceAnalysisError {
  code: "evidence-count-mismatch" | "invalid-policy";
}

export type ColorAdherenceAnalysisResult =
  | { ok: true; summary: ColorAdherenceSummary }
  | { ok: false; error: ColorAdherenceAnalysisError };

export function analyzeColorAdherence(
  candidates: ColorAdherenceCandidate[],
  policy: ColorAdherencePolicy,
  counts: ColorAdherenceCollectionCounts
): ColorAdherenceAnalysisResult {
  if (
    !validCount(counts.candidateSlotCount)
    || !validCount(counts.ignoredSlotCount)
    || !validCount(counts.skippedSlotCount)
    || sumCounts(counts.skippedByReason) !== counts.skippedSlotCount
    || candidates.length + counts.ignoredSlotCount + counts.skippedSlotCount
      !== counts.candidateSlotCount
  ) {
    return { ok: false, error: { code: "evidence-count-mismatch" } };
  }
  if (
    policy.policyId !== "color-adherence-v1"
    || policy.allowedColors.length === 0
    || policy.allowedColors.some((color) => !isRgba8Color(color))
  ) {
    return { ok: false, error: { code: "invalid-policy" } };
  }

  const allowedIdentities = new Set(policy.allowedColors.map(rgba8ColorIdentity));
  const groups = new Map<string, {
    property: ColorPaintProperty;
    unexpectedColor: Rgba8Color;
    rawComputedValues: string[];
    affectedSlotCount: number;
    selectors: string[];
    regions: ColorAdherenceCandidate["region"][];
    firstObservedIndex: number;
  }>();
  const skippedByReason: Partial<Record<ColorAdherenceSkipReason, number>> = {
    ...counts.skippedByReason
  };
  const ignoredByReason: Partial<Record<ColorAdherenceIgnoreReason, number>> = {
    ...(counts.ignoredSlotCount > 0 ? { "selector-exception": counts.ignoredSlotCount } : {})
  };
  let ignoredSlotCount = counts.ignoredSlotCount;
  let evaluatedSlotCount = 0;
  let skippedSlotCount = counts.skippedSlotCount;
  let violatingSlotCount = 0;

  for (const [candidateIndex, candidate] of candidates.entries()) {
    const parsed = parseSupportedRenderedColor(candidate.value);
    if (!parsed) {
      skippedSlotCount += 1;
      increment(skippedByReason, "unsupported-color");
      continue;
    }
    const color = parsedColorToRgba8(parsed);
    if (color.alpha === 0) {
      ignoredSlotCount += 1;
      increment(ignoredByReason, "transparent");
      continue;
    }

    evaluatedSlotCount += 1;
    const identity = rgba8ColorIdentity(color);
    if (allowedIdentities.has(identity)) {
      continue;
    }

    violatingSlotCount += 1;
    const key = `${candidate.property}\u0000${identity}`;
    const existing = groups.get(key);
    if (existing) {
      existing.affectedSlotCount += 1;
      if (
        existing.rawComputedValues.length < MAX_SAMPLES_PER_GROUP
        && !existing.rawComputedValues.includes(candidate.value)
      ) {
        existing.rawComputedValues.push(candidate.value);
      }
      if (existing.selectors.length < MAX_SAMPLES_PER_GROUP) {
        existing.selectors.push(candidate.selector);
        existing.regions.push(candidate.region);
      }
      continue;
    }

    groups.set(key, {
      property: candidate.property,
      unexpectedColor: color,
      rawComputedValues: [candidate.value],
      affectedSlotCount: 1,
      selectors: [candidate.selector],
      regions: [candidate.region],
      firstObservedIndex: candidateIndex
    });
  }

  const orderedGroups = [...groups.values()].sort((left, right) => (
    right.affectedSlotCount - left.affectedSlotCount
    || left.firstObservedIndex - right.firstObservedIndex
  ));
  const emitted = orderedGroups.slice(0, MAX_GROUPS).map((group) => ({
    property: group.property,
    unexpectedColor: group.unexpectedColor,
    rawComputedValues: group.rawComputedValues,
    affectedSlotCount: group.affectedSlotCount,
    selectors: group.selectors,
    regions: group.regions,
    sampleCount: group.selectors.length,
    omittedSampleCount: group.affectedSlotCount - group.selectors.length
  }));
  const distinctViolationGroupCount = orderedGroups.length;
  const emittedGroupCount = emitted.length;

  return {
    ok: true,
    summary: {
      policyId: policy.policyId,
      allowedColors: policy.allowedColors.map((color) => ({ ...color })),
      candidateSlotCount: counts.candidateSlotCount,
      evaluatedSlotCount,
      ignoredSlotCount,
      ignoredByReason,
      skippedSlotCount,
      skippedByReason,
      violatingSlotCount,
      distinctViolationGroupCount,
      emittedGroupCount,
      truncatedGroupCount: distinctViolationGroupCount - emittedGroupCount,
      groups: emitted
    }
  };
}

function parseSupportedRenderedColor(value: string) {
  if (!/^(?:rgba?\(|color\(\s*srgb(?:\s|$))/iu.test(value.trim())) {
    return null;
  }
  return parseCssColor(value);
}

export function parsedColorToRgba8(color: {
  red: number;
  green: number;
  blue: number;
  alpha: number;
}): Rgba8Color {
  return {
    red: byte(color.red),
    green: byte(color.green),
    blue: byte(color.blue),
    alpha: byte(color.alpha * 255)
  };
}

function byte(value: number): number {
  return Math.round(Math.max(0, Math.min(255, value)));
}

function increment(
  target: Partial<Record<ColorAdherenceSkipReason | ColorAdherenceIgnoreReason, number>>,
  reason: ColorAdherenceSkipReason | ColorAdherenceIgnoreReason
): void {
  target[reason] = (target[reason] ?? 0) + 1;
}

function validCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function sumCounts(value: Record<string, number>): number {
  return Object.values(value).reduce((sum, count) => (
    validCount(count) ? sum + count : Number.NaN
  ), 0);
}

function isRgba8Color(value: Rgba8Color): boolean {
  return [value.red, value.green, value.blue, value.alpha].every((component) => (
    Number.isInteger(component) && component >= 0 && component <= 255
  ));
}

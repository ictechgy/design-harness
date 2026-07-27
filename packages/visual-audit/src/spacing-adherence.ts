import type { SpacingAdherencePolicy } from "@design-harness/core";

const MATCH_TOLERANCE_PX = 0.001;
const MAX_GROUPS = 5;
const MAX_SAMPLES_PER_GROUP = 5;

export type SpacingProperty =
  | "margin-top"
  | "margin-right"
  | "margin-bottom"
  | "margin-left"
  | "padding-top"
  | "padding-right"
  | "padding-bottom"
  | "padding-left"
  | "row-gap"
  | "column-gap";

export interface SpacingAdherenceCandidate {
  selector: string;
  region: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  property: SpacingProperty;
  valuePx: number;
}

export type SpacingAdherenceSkipReason =
  | "visually-hidden-box"
  | "auto-margin"
  | "normal-gap"
  | "typed-om-unavailable"
  | "typed-om-error"
  | "unsupported-typed-value"
  | "computed-spacing-too-long"
  | "nonfinite-computed-value"
  | "invalid-negative";

export type SpacingAdherenceIgnoreReason = "selector-exception";

export interface SpacingAdherenceCollectionCounts {
  candidateSlotCount: number;
  ignoredSlotCount: number;
  skippedSlotCount: number;
  skippedByReason: Partial<Record<SpacingAdherenceSkipReason, number>>;
}

export interface SpacingAdherenceViolationGroup {
  property: SpacingProperty;
  unexpectedValuePx: number;
  affectedSlotCount: number;
  selectors: string[];
  regions: SpacingAdherenceCandidate["region"][];
  sampleCount: number;
  omittedSampleCount: number;
}

export interface SpacingAdherenceSummary {
  policyId: "spacing-adherence-v1";
  allowedValuesPx: number[];
  rootFontSizePx: number;
  candidateSlotCount: number;
  evaluatedSlotCount: number;
  ignoredSlotCount: number;
  ignoredByReason: Partial<Record<SpacingAdherenceIgnoreReason, number>>;
  skippedSlotCount: number;
  skippedByReason: Partial<Record<SpacingAdherenceSkipReason, number>>;
  violatingSlotCount: number;
  distinctViolationGroupCount: number;
  emittedGroupCount: number;
  truncatedGroupCount: number;
  groups: SpacingAdherenceViolationGroup[];
}

export interface SpacingAdherenceAnalysisError {
  code:
    | "evidence-count-mismatch"
    | "invalid-policy"
    | "invalid-root-font-size"
    | "invalid-candidate";
}

export type SpacingAdherenceAnalysisResult =
  | { ok: true; summary: SpacingAdherenceSummary }
  | { ok: false; error: SpacingAdherenceAnalysisError };

export function analyzeSpacingAdherence(
  candidates: SpacingAdherenceCandidate[],
  policy: SpacingAdherencePolicy,
  counts: SpacingAdherenceCollectionCounts,
  rootFontSizePx: number | undefined
): SpacingAdherenceAnalysisResult {
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
  if (!isFinitePositive(rootFontSizePx)) {
    return { ok: false, error: { code: "invalid-root-font-size" } };
  }
  if (
    policy.policyId !== "spacing-adherence-v1"
    || policy.allowedValues.length === 0
    || policy.allowedValues.some((value) => (
      !Number.isFinite(value.value)
      || value.value < 0
      || (value.unit !== "px" && value.unit !== "rem")
    ))
  ) {
    return { ok: false, error: { code: "invalid-policy" } };
  }

  const allowedValuesPx = convertAllowedValues(policy, rootFontSizePx);
  if (!allowedValuesPx) {
    return { ok: false, error: { code: "invalid-policy" } };
  }
  if (candidates.some((candidate) => !isValidCandidate(candidate))) {
    return { ok: false, error: { code: "invalid-candidate" } };
  }

  const groups = new Map<string, {
    property: SpacingProperty;
    unexpectedValuePx: number;
    affectedSlotCount: number;
    selectors: string[];
    regions: SpacingAdherenceCandidate["region"][];
    firstObservedIndex: number;
  }>();
  let violatingSlotCount = 0;

  for (const [candidateIndex, candidate] of candidates.entries()) {
    const observedValuePx = canonicalNumber(candidate.valuePx);
    const membershipValuePx = isMargin(candidate.property)
      ? Math.abs(observedValuePx)
      : observedValuePx;
    if (
      withinTolerance(membershipValuePx, 0)
      || allowedValuesPx.some((allowedValuePx) => (
        withinTolerance(membershipValuePx, allowedValuePx)
      ))
    ) {
      continue;
    }

    violatingSlotCount += 1;
    const key = `${candidate.property}\u0000${String(observedValuePx)}`;
    const existing = groups.get(key);
    if (existing) {
      existing.affectedSlotCount += 1;
      if (existing.selectors.length < MAX_SAMPLES_PER_GROUP) {
        existing.selectors.push(candidate.selector);
        existing.regions.push(candidate.region);
      }
      continue;
    }

    groups.set(key, {
      property: candidate.property,
      unexpectedValuePx: observedValuePx,
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
  const emittedGroups = orderedGroups.slice(0, MAX_GROUPS).map((group) => ({
    property: group.property,
    unexpectedValuePx: group.unexpectedValuePx,
    affectedSlotCount: group.affectedSlotCount,
    selectors: group.selectors,
    regions: group.regions,
    sampleCount: group.selectors.length,
    omittedSampleCount: group.affectedSlotCount - group.selectors.length
  }));
  const distinctViolationGroupCount = orderedGroups.length;
  const emittedGroupCount = emittedGroups.length;

  return {
    ok: true,
    summary: {
      policyId: policy.policyId,
      allowedValuesPx,
      rootFontSizePx,
      candidateSlotCount: counts.candidateSlotCount,
      evaluatedSlotCount: candidates.length,
      ignoredSlotCount: counts.ignoredSlotCount,
      ignoredByReason: {
        ...(counts.ignoredSlotCount > 0
          ? { "selector-exception": counts.ignoredSlotCount }
          : {})
      },
      skippedSlotCount: counts.skippedSlotCount,
      skippedByReason: { ...counts.skippedByReason },
      violatingSlotCount,
      distinctViolationGroupCount,
      emittedGroupCount,
      truncatedGroupCount: distinctViolationGroupCount - emittedGroupCount,
      groups: emittedGroups
    }
  };
}

function convertAllowedValues(
  policy: SpacingAdherencePolicy,
  rootFontSizePx: number
): number[] | undefined {
  const allowedValuesPx: number[] = [];
  const identities = new Set<string>();

  for (const value of policy.allowedValues) {
    const converted = canonicalNumber(
      value.unit === "rem" ? value.value * rootFontSizePx : value.value
    );
    if (!Number.isFinite(converted)) {
      return undefined;
    }
    const identity = String(converted);
    if (!identities.has(identity)) {
      identities.add(identity);
      allowedValuesPx.push(converted);
    }
  }

  return allowedValuesPx;
}

function isValidCandidate(candidate: SpacingAdherenceCandidate): boolean {
  return (
    SPACING_PROPERTIES.has(candidate.property)
    && Number.isFinite(candidate.valuePx)
    && (candidate.valuePx >= 0 || isMargin(candidate.property))
  );
}

function isMargin(property: SpacingProperty): boolean {
  return property.startsWith("margin-");
}

function withinTolerance(left: number, right: number): boolean {
  const scale = Math.max(1, Math.abs(left), Math.abs(right));
  const floatingPointGuard = Number.EPSILON * scale * 4;
  return Math.abs(left - right) <= MATCH_TOLERANCE_PX + floatingPointGuard;
}

function canonicalNumber(value: number): number {
  return value === 0 ? 0 : value;
}

function isFinitePositive(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function validCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function sumCounts(value: Record<string, number>): number {
  return Object.values(value).reduce((sum, count) => (
    validCount(count) ? sum + count : Number.NaN
  ), 0);
}

const SPACING_PROPERTIES = new Set<SpacingProperty>([
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
]);

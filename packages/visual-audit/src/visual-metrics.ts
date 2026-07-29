import {
  DENSITY_COMPLEXITY_BUDGET_POLICY_ID,
  DENSITY_COMPLEXITY_METHOD_ID,
  DENSITY_TEXT_CLUSTER_METHOD_ID,
  DENSITY_VISIBLE_ELEMENT_METHOD_ID,
  PALETTE_DISCIPLINE_BUDGET_POLICY_ID,
  PALETTE_DISCIPLINE_METHOD_ID,
  TYPOGRAPHY_VARIANT_BUDGET_POLICY_ID,
  TYPOGRAPHY_VARIANT_METHOD_ID,
  type DensityComplexityBudgetPolicy,
  type PaletteDisciplineBudgetPolicy,
  type TypographyVariantBudgetPolicy
} from "@design-harness/core";
import type {
  DensityComplexityCollection,
  DensityComplexitySkipReason,
  DensityTextFragment,
  PaletteDisciplineCandidate,
  PaletteDisciplineCollectionCounts,
  PaletteDisciplineSkipReason,
  TypographyVariantCandidate,
  TypographyVariantCollectionCounts,
  TypographyVariantSkipReason,
  VisualMetricRegion
} from "./browser-measurements.js";
import {
  DensityClusterError,
  MAX_EVIDENCE_SAMPLES,
  MAX_DOM_ELEMENTS,
  MAX_PALETTE_DISCIPLINE_SLOTS,
  MAX_TEXT_FRAGMENTS,
  MAX_TEXT_NODES,
  MAX_TYPOGRAPHY_VARIANT_CANDIDATES,
  TypographyTupleNormalizationError,
  countDensityTextClusters,
  hueFamilyCoverFromRgba8,
  normalizeTypographyTuple,
  parseCssColor,
  rgba8FromParsedColor,
  rgba8Identity,
  type NormalizedTypographyTuple,
  type Rgba8,
  type TypographyTupleNormalizationErrorCode
} from "./measurement-primitives.js";

const MAX_EXAMPLES = 5;
const MAX_LOCATIONS_PER_EXAMPLE = 5;
const MAX_COMPUTED_PALETTE_COLOR_SCALARS = 256;

export type SoundMetricCoverage = "complete" | "lower-bound";

export type TypographyVariantAnalysisSkipReason =
  | TypographyVariantSkipReason
  | TypographyTupleNormalizationErrorCode;

export interface TypographyVariantLocation {
  selector: string;
  region: VisualMetricRegion;
}

export interface TypographyVariantExample {
  identity: string;
  tuple: NormalizedTypographyTuple;
  affectedElementCount: number;
  emittedLocationCount: number;
  omittedLocationCount: number;
  locations: TypographyVariantLocation[];
}

export interface TypographyVariantSummary {
  policyId: TypographyVariantBudgetPolicy["policyId"];
  methodId: TypographyVariantBudgetPolicy["methodId"];
  maxDistinctVariants: number;
  coverage: SoundMetricCoverage;
  candidateElementCount: number;
  collectedElementCount: number;
  evaluatedElementCount: number;
  ignoredElementCount: number;
  skippedElementCount: number;
  skippedByReason: Partial<Record<TypographyVariantAnalysisSkipReason, number>>;
  distinctVariantCount: number;
  emittedVariantCount: number;
  omittedVariantCount: number;
  variants: TypographyVariantExample[];
}

export interface TypographyVariantAnalysisError {
  code: "evidence-count-mismatch" | "invalid-policy" | "invalid-candidate";
}

export type TypographyVariantAnalysisResult =
  | { ok: true; summary: TypographyVariantSummary }
  | { ok: false; error: TypographyVariantAnalysisError };

export type PaletteDisciplineAnalysisSkipReason =
  | PaletteDisciplineSkipReason
  | "unsupported-color";

export type PaletteDisciplineIgnoreReason =
  | "selector-exception"
  | "transparent";

export interface PaletteColorLocation {
  selector: string;
  property: PaletteDisciplineCandidate["property"];
  region: VisualMetricRegion;
}

export interface PaletteColorExample {
  identity: string;
  color: Rgba8;
  occurrenceCount: number;
  emittedLocationCount: number;
  omittedLocationCount: number;
  locations: PaletteColorLocation[];
}

export interface PaletteDisciplineSummary {
  policyId: PaletteDisciplineBudgetPolicy["policyId"];
  methodId: PaletteDisciplineBudgetPolicy["methodId"];
  maxDistinctColors?: number;
  maxChromaticHueFamilies?: number;
  coverage: SoundMetricCoverage;
  candidateSlotCount: number;
  collectedSlotCount: number;
  evaluatedSlotCount: number;
  ignoredSlotCount: number;
  ignoredByReason: Partial<Record<PaletteDisciplineIgnoreReason, number>>;
  skippedSlotCount: number;
  skippedByReason: Partial<Record<PaletteDisciplineAnalysisSkipReason, number>>;
  distinctColorCount: number;
  emittedColorCount: number;
  omittedColorCount: number;
  colors: PaletteColorExample[];
  hueFamilyCount: number;
  hueFamilyStarts: number[];
}

export interface PaletteDisciplineAnalysisError {
  code: "evidence-count-mismatch" | "invalid-policy" | "invalid-candidate";
}

export type PaletteDisciplineAnalysisResult =
  | { ok: true; summary: PaletteDisciplineSummary }
  | { ok: false; error: PaletteDisciplineAnalysisError };

export interface DensityVisibleElementSummary {
  methodId: DensityComplexityBudgetPolicy["visibleElementMethodId"];
  maxVisibleElements: number;
  coverage: SoundMetricCoverage;
  elementUniverseCount: number;
  visibleElementCount: number;
  ignoredElementCount: number;
  ineligibleElementCount: number;
  skippedElementCount: number;
  skippedByReason: Partial<Record<DensityComplexitySkipReason, number>>;
  emittedSampleCount: number;
  omittedSampleCount: number;
  samples: Array<{ selector: string; region: VisualMetricRegion }>;
}

export interface DensityTextClusterSample {
  selector: string;
  region: VisualMetricRegion;
  fragmentCount: number;
}

export const DENSITY_TEXT_CLUSTER_LOWER_BOUND_METHOD_ID =
  "supported-flow-root-count-v1";

interface DensityTextClusterSummaryBase {
  methodId: DensityComplexityBudgetPolicy["textClusterMethodId"];
  maxTextClusters: number;
  textNodeUniverseCount: number;
  ignoredTextNodeCount: number;
  ineligibleTextNodeCount: number;
  skippedTextNodeCount: number;
  evaluatedTextNodeCount: number;
  skippedByReason: Partial<Record<DensityComplexitySkipReason, number>>;
  textFragmentCount: number;
}

export interface CompleteDensityTextClusterSummary extends DensityTextClusterSummaryBase {
  coverage: "complete";
  textClusterCount: number;
  edgeTestCount: number;
  emittedSampleCount: number;
  omittedSampleCount: number;
  samples: DensityTextClusterSample[];
}

export interface LowerBoundDensityTextClusterSummary extends DensityTextClusterSummaryBase {
  coverage: "lower-bound";
  lowerBoundMethodId: typeof DENSITY_TEXT_CLUSTER_LOWER_BOUND_METHOD_ID;
  textClusterCount: number;
  edgeTestCount: null;
  emittedSampleCount: 0;
  omittedSampleCount: number;
  samples: [];
}

export type DensityTextClusterSummary =
  | CompleteDensityTextClusterSummary
  | LowerBoundDensityTextClusterSummary;

export interface DensityComplexitySummary {
  policyId: DensityComplexityBudgetPolicy["policyId"];
  methodId: DensityComplexityBudgetPolicy["methodId"];
  visibleElementMethodId: DensityComplexityBudgetPolicy["visibleElementMethodId"];
  textClusterMethodId: DensityComplexityBudgetPolicy["textClusterMethodId"];
  maxVisibleElements?: number;
  maxTextClusters?: number;
  visibleElements?: DensityVisibleElementSummary;
  textClusters?: DensityTextClusterSummary;
}

export interface DensityComplexityAnalysisError {
  code:
    | "evidence-count-mismatch"
    | "invalid-policy"
    | "invalid-candidate"
    | "fragment-cap-exceeded"
    | "edge-cap-exceeded";
  component?: "visible-elements" | "text-clusters";
  edgeTests?: number;
}

export type DensityComplexityAnalysisResult =
  | { ok: true; summary: DensityComplexitySummary }
  | { ok: false; error: DensityComplexityAnalysisError };

export function analyzeTypographyVariants(
  candidates: readonly TypographyVariantCandidate[],
  policy: TypographyVariantBudgetPolicy,
  counts: TypographyVariantCollectionCounts
): TypographyVariantAnalysisResult {
  if (!isValidTypographyPolicy(policy)) {
    return { ok: false, error: { code: "invalid-policy" } };
  }
  if (
    !validCount(counts.candidateElementCount)
    || counts.candidateElementCount > MAX_TYPOGRAPHY_VARIANT_CANDIDATES
    || !validCount(counts.collectedElementCount)
    || !validCount(counts.ignoredElementCount)
    || !validCount(counts.skippedElementCount)
    || !reasonCountsMatch(
      counts.skippedByReason,
      TYPOGRAPHY_BROWSER_SKIP_REASONS,
      counts.skippedElementCount
    )
    || counts.collectedElementCount !== candidates.length
    || counts.candidateElementCount
      !== counts.collectedElementCount + counts.ignoredElementCount + counts.skippedElementCount
  ) {
    return { ok: false, error: { code: "evidence-count-mismatch" } };
  }
  if (candidates.some((candidate) => !isValidTypographyCandidate(candidate))) {
    return { ok: false, error: { code: "invalid-candidate" } };
  }

  const skippedByReason = copyCounts<TypographyVariantAnalysisSkipReason>(
    counts.skippedByReason
  );
  const groups = new Map<string, {
    identity: string;
    tuple: NormalizedTypographyTuple;
    affectedElementCount: number;
    locations: TypographyVariantLocation[];
  }>();
  let evaluatedElementCount = 0;
  let skippedElementCount = counts.skippedElementCount;

  for (const candidate of candidates) {
    let normalized: ReturnType<typeof normalizeTypographyTuple>;
    try {
      normalized = normalizeTypographyTuple(candidate);
    } catch (error) {
      if (!(error instanceof TypographyTupleNormalizationError)) {
        return { ok: false, error: { code: "invalid-candidate" } };
      }
      skippedElementCount += 1;
      incrementCount(skippedByReason, error.code);
      continue;
    }

    evaluatedElementCount += 1;
    const location = {
      selector: candidate.selector,
      region: cloneRegion(candidate.region)
    };
    const existing = groups.get(normalized.identity);
    if (existing) {
      existing.affectedElementCount += 1;
      existing.locations.push(location);
      continue;
    }
    groups.set(normalized.identity, {
      identity: normalized.identity,
      tuple: {
        families: [...normalized.tuple.families],
        sizeMilliPx: normalized.tuple.sizeMilliPx,
        weightMilli: normalized.tuple.weightMilli,
        style: normalized.tuple.style
      },
      affectedElementCount: 1,
      locations: [location]
    });
  }

  if (
    counts.candidateElementCount
      !== evaluatedElementCount + counts.ignoredElementCount + skippedElementCount
    || groups.size > evaluatedElementCount
  ) {
    return { ok: false, error: { code: "evidence-count-mismatch" } };
  }

  const ordered = [...groups.values()].sort((left, right) => (
    right.affectedElementCount - left.affectedElementCount
    || compareCodePoints(left.identity, right.identity)
  ));
  const variants = ordered.slice(0, MAX_EXAMPLES).map((variant) => {
    const locations = [...variant.locations].sort(compareTypographyLocations);
    const emitted = locations.slice(0, MAX_LOCATIONS_PER_EXAMPLE);
    return {
      identity: variant.identity,
      tuple: variant.tuple,
      affectedElementCount: variant.affectedElementCount,
      emittedLocationCount: emitted.length,
      omittedLocationCount: variant.affectedElementCount - emitted.length,
      locations: emitted
    };
  });

  return {
    ok: true,
    summary: {
      policyId: policy.policyId,
      methodId: policy.methodId,
      maxDistinctVariants: policy.maxDistinctVariants,
      coverage: skippedElementCount === 0 ? "complete" : "lower-bound",
      candidateElementCount: counts.candidateElementCount,
      collectedElementCount: counts.collectedElementCount,
      evaluatedElementCount,
      ignoredElementCount: counts.ignoredElementCount,
      skippedElementCount,
      skippedByReason: canonicalCounts(
        skippedByReason,
        TYPOGRAPHY_ANALYSIS_SKIP_REASONS
      ),
      distinctVariantCount: ordered.length,
      emittedVariantCount: variants.length,
      omittedVariantCount: ordered.length - variants.length,
      variants
    }
  };
}

export function analyzePaletteDiscipline(
  candidates: readonly PaletteDisciplineCandidate[],
  policy: PaletteDisciplineBudgetPolicy,
  counts: PaletteDisciplineCollectionCounts
): PaletteDisciplineAnalysisResult {
  if (!isValidPalettePolicy(policy)) {
    return { ok: false, error: { code: "invalid-policy" } };
  }
  if (
    !validCount(counts.candidateSlotCount)
    || counts.candidateSlotCount > MAX_PALETTE_DISCIPLINE_SLOTS
    || !validCount(counts.collectedSlotCount)
    || !validCount(counts.ignoredSlotCount)
    || !validCount(counts.skippedSlotCount)
    || !reasonCountsMatch(
      counts.skippedByReason,
      PALETTE_BROWSER_SKIP_REASONS,
      counts.skippedSlotCount
    )
    || counts.collectedSlotCount !== candidates.length
    || counts.candidateSlotCount
      !== counts.collectedSlotCount + counts.ignoredSlotCount + counts.skippedSlotCount
  ) {
    return { ok: false, error: { code: "evidence-count-mismatch" } };
  }
  if (candidates.some((candidate) => !isValidPaletteCandidate(candidate))) {
    return { ok: false, error: { code: "invalid-candidate" } };
  }

  const skippedByReason = copyCounts<PaletteDisciplineAnalysisSkipReason>(
    counts.skippedByReason
  );
  const ignoredByReason: Partial<Record<PaletteDisciplineIgnoreReason, number>> = {
    ...(counts.ignoredSlotCount > 0
      ? { "selector-exception": counts.ignoredSlotCount }
      : {})
  };
  const groups = new Map<string, {
    identity: string;
    color: Rgba8;
    occurrenceCount: number;
    locations: PaletteColorLocation[];
  }>();
  let evaluatedSlotCount = 0;
  let ignoredSlotCount = counts.ignoredSlotCount;
  let skippedSlotCount = counts.skippedSlotCount;

  for (const candidate of candidates) {
    if (unicodeScalarCountExceeds(
      candidate.value,
      MAX_COMPUTED_PALETTE_COLOR_SCALARS
    )) {
      skippedSlotCount += 1;
      incrementCount(skippedByReason, "computed-color-too-long");
      continue;
    }
    const parsed = parseCssColor(candidate.value);
    const color = parsed ? rgba8FromParsedColor(parsed) : null;
    if (!color) {
      skippedSlotCount += 1;
      incrementCount(skippedByReason, "unsupported-color");
      continue;
    }
    if (color.alpha === 0) {
      ignoredSlotCount += 1;
      incrementCount(ignoredByReason, "transparent");
      continue;
    }

    evaluatedSlotCount += 1;
    const identity = rgba8Identity(color);
    const location = {
      selector: candidate.selector,
      property: candidate.property,
      region: cloneRegion(candidate.region)
    };
    const existing = groups.get(identity);
    if (existing) {
      existing.occurrenceCount += 1;
      existing.locations.push(location);
      continue;
    }
    groups.set(identity, {
      identity,
      color,
      occurrenceCount: 1,
      locations: [location]
    });
  }

  if (
    counts.candidateSlotCount
      !== evaluatedSlotCount + ignoredSlotCount + skippedSlotCount
    || groups.size > evaluatedSlotCount
  ) {
    return { ok: false, error: { code: "evidence-count-mismatch" } };
  }

  const ordered = [...groups.values()].sort((left, right) => (
    right.occurrenceCount - left.occurrenceCount
    || compareRgba8(left.color, right.color)
  ));
  const colors = ordered.slice(0, MAX_EXAMPLES).map((group) => {
    const locations = [...group.locations].sort(comparePaletteLocations);
    const emitted = locations.slice(0, MAX_LOCATIONS_PER_EXAMPLE);
    return {
      identity: group.identity,
      color: { ...group.color },
      occurrenceCount: group.occurrenceCount,
      emittedLocationCount: emitted.length,
      omittedLocationCount: group.occurrenceCount - emitted.length,
      locations: emitted
    };
  });
  const hueCover = hueFamilyCoverFromRgba8(ordered.map((group) => group.color));

  return {
    ok: true,
    summary: {
      policyId: policy.policyId,
      methodId: policy.methodId,
      ...(policy.maxDistinctColors === undefined
        ? {}
        : { maxDistinctColors: policy.maxDistinctColors }),
      ...(policy.maxChromaticHueFamilies === undefined
        ? {}
        : { maxChromaticHueFamilies: policy.maxChromaticHueFamilies }),
      coverage: skippedSlotCount === 0 ? "complete" : "lower-bound",
      candidateSlotCount: counts.candidateSlotCount,
      collectedSlotCount: counts.collectedSlotCount,
      evaluatedSlotCount,
      ignoredSlotCount,
      ignoredByReason: canonicalCounts(
        ignoredByReason,
        PALETTE_IGNORE_REASONS
      ),
      skippedSlotCount,
      skippedByReason: canonicalCounts(
        skippedByReason,
        PALETTE_ANALYSIS_SKIP_REASONS
      ),
      distinctColorCount: ordered.length,
      emittedColorCount: colors.length,
      omittedColorCount: ordered.length - colors.length,
      colors,
      hueFamilyCount: hueCover.count,
      hueFamilyStarts: [...hueCover.starts]
    }
  };
}

export function analyzeDensityComplexity(
  collection: DensityComplexityCollection,
  policy: DensityComplexityBudgetPolicy
): DensityComplexityAnalysisResult {
  if (!isValidDensityPolicy(policy)) {
    return { ok: false, error: { code: "invalid-policy" } };
  }
  if (
    (policy.maxVisibleElements !== undefined) !== (collection.visibleElements !== undefined)
    || (policy.maxTextClusters !== undefined) !== (collection.textClusters !== undefined)
  ) {
    return { ok: false, error: { code: "evidence-count-mismatch" } };
  }

  let visibleElements: DensityVisibleElementSummary | undefined;
  if (collection.visibleElements && policy.maxVisibleElements !== undefined) {
    const visible = analyzeDensityVisibleElements(
      collection.visibleElements,
      policy.maxVisibleElements,
      policy.visibleElementMethodId
    );
    if (!visible.ok) {
      return { ok: false, error: visible.error };
    }
    visibleElements = visible.summary;
  }

  let textClusters: DensityTextClusterSummary | undefined;
  if (collection.textClusters && policy.maxTextClusters !== undefined) {
    const text = analyzeDensityTextClusters(
      collection.textClusters,
      policy.maxTextClusters,
      policy.textClusterMethodId
    );
    if (!text.ok) {
      return { ok: false, error: text.error };
    }
    textClusters = text.summary;
  }

  return {
    ok: true,
    summary: {
      policyId: policy.policyId,
      methodId: policy.methodId,
      visibleElementMethodId: policy.visibleElementMethodId,
      textClusterMethodId: policy.textClusterMethodId,
      ...(policy.maxVisibleElements === undefined
        ? {}
        : { maxVisibleElements: policy.maxVisibleElements }),
      ...(policy.maxTextClusters === undefined
        ? {}
        : { maxTextClusters: policy.maxTextClusters }),
      ...(visibleElements ? { visibleElements } : {}),
      ...(textClusters ? { textClusters } : {})
    }
  };
}

type DensityComponentResult<T> =
  | { ok: true; summary: T }
  | { ok: false; error: DensityComplexityAnalysisError };

function analyzeDensityVisibleElements(
  collection: NonNullable<DensityComplexityCollection["visibleElements"]>,
  maxVisibleElements: number,
  methodId: DensityComplexityBudgetPolicy["visibleElementMethodId"]
): DensityComponentResult<DensityVisibleElementSummary> {
  if (
    !validCount(collection.elementUniverseCount)
    || collection.elementUniverseCount > MAX_DOM_ELEMENTS
    || !validCount(collection.visibleElementCount)
    || !validCount(collection.ignoredElementCount)
    || !validCount(collection.ineligibleElementCount)
    || !validCount(collection.skippedElementCount)
    || !validCount(collection.omittedSampleCount)
    || !reasonCountsMatch(
      collection.skippedByReason,
      DENSITY_SKIP_REASONS,
      collection.skippedElementCount
    )
    || collection.elementUniverseCount
      !== collection.visibleElementCount
        + collection.ignoredElementCount
        + collection.ineligibleElementCount
        + collection.skippedElementCount
    || collection.samples.length > MAX_EVIDENCE_SAMPLES
    || collection.samples.length + collection.omittedSampleCount
      !== collection.visibleElementCount
    || collection.samples.length
      !== Math.min(collection.visibleElementCount, MAX_EVIDENCE_SAMPLES)
  ) {
    return {
      ok: false,
      error: { code: "evidence-count-mismatch", component: "visible-elements" }
    };
  }
  if (collection.samples.some((sample) => (
    typeof sample.selector !== "string" || !isValidRegion(sample.region)
  ))) {
    return {
      ok: false,
      error: { code: "invalid-candidate", component: "visible-elements" }
    };
  }

  const samples = collection.samples
    .map((sample) => ({ selector: sample.selector, region: cloneRegion(sample.region) }))
    .sort(compareRegionSamples);
  return {
    ok: true,
    summary: {
      methodId,
      maxVisibleElements,
      coverage: collection.skippedElementCount === 0 ? "complete" : "lower-bound",
      elementUniverseCount: collection.elementUniverseCount,
      visibleElementCount: collection.visibleElementCount,
      ignoredElementCount: collection.ignoredElementCount,
      ineligibleElementCount: collection.ineligibleElementCount,
      skippedElementCount: collection.skippedElementCount,
      skippedByReason: canonicalCounts(
        collection.skippedByReason,
        DENSITY_SKIP_REASONS
      ),
      emittedSampleCount: samples.length,
      omittedSampleCount: collection.omittedSampleCount,
      samples
    }
  };
}

function analyzeDensityTextClusters(
  collection: NonNullable<DensityComplexityCollection["textClusters"]>,
  maxTextClusters: number,
  methodId: DensityComplexityBudgetPolicy["textClusterMethodId"]
): DensityComponentResult<DensityTextClusterSummary> {
  if (
    !validCount(collection.textNodeUniverseCount)
    || collection.textNodeUniverseCount > MAX_TEXT_NODES
    || !validCount(collection.ignoredTextNodeCount)
    || !validCount(collection.ineligibleTextNodeCount)
    || !validCount(collection.skippedTextNodeCount)
    || !validCount(collection.evaluatedTextNodeCount)
    || !validCount(collection.textFragmentCount)
    || !reasonCountsMatch(
      collection.skippedByReason,
      DENSITY_SKIP_REASONS,
      collection.skippedTextNodeCount
    )
    || collection.textNodeUniverseCount
      !== collection.ignoredTextNodeCount
        + collection.ineligibleTextNodeCount
        + collection.skippedTextNodeCount
        + collection.evaluatedTextNodeCount
    || collection.textFragmentCount !== collection.fragments.length
    || collection.evaluatedTextNodeCount > collection.textFragmentCount
  ) {
    return {
      ok: false,
      error: { code: "evidence-count-mismatch", component: "text-clusters" }
    };
  }
  if (collection.fragments.length > MAX_TEXT_FRAGMENTS) {
    return {
      ok: false,
      error: { code: "fragment-cap-exceeded", component: "text-clusters", edgeTests: 0 }
    };
  }
  if (collection.fragments.some((fragment) => !isValidDensityFragment(fragment))) {
    return {
      ok: false,
      error: { code: "invalid-candidate", component: "text-clusters" }
    };
  }

  const shared = {
    methodId,
    maxTextClusters,
    textNodeUniverseCount: collection.textNodeUniverseCount,
    ignoredTextNodeCount: collection.ignoredTextNodeCount,
    ineligibleTextNodeCount: collection.ineligibleTextNodeCount,
    skippedTextNodeCount: collection.skippedTextNodeCount,
    evaluatedTextNodeCount: collection.evaluatedTextNodeCount,
    skippedByReason: canonicalCounts(
      collection.skippedByReason,
      DENSITY_SKIP_REASONS
    ),
    textFragmentCount: collection.textFragmentCount
  };
  if (collection.skippedTextNodeCount > 0) {
    const supportedFlowRootCount = new Set(
      collection.fragments.map((fragment) => fragment.rootId)
    ).size;
    return {
      ok: true,
      summary: {
        ...shared,
        coverage: "lower-bound",
        lowerBoundMethodId: DENSITY_TEXT_CLUSTER_LOWER_BOUND_METHOD_ID,
        textClusterCount: supportedFlowRootCount,
        edgeTestCount: null,
        emittedSampleCount: 0,
        omittedSampleCount: supportedFlowRootCount,
        samples: []
      }
    };
  }

  let counted: ReturnType<typeof countDensityTextClusters>;
  try {
    counted = countDensityTextClusters(collection.fragments);
  } catch (error) {
    if (!(error instanceof DensityClusterError)) {
      return {
        ok: false,
        error: { code: "invalid-candidate", component: "text-clusters" }
      };
    }
    if (error.code === "edge-cap-exceeded") {
      return {
        ok: false,
        error: {
          code: "edge-cap-exceeded",
          component: "text-clusters",
          edgeTests: error.edgeTests
        }
      };
    }
    if (error.code === "fragment-cap-exceeded") {
      return {
        ok: false,
        error: {
          code: "fragment-cap-exceeded",
          component: "text-clusters",
          edgeTests: error.edgeTests
        }
      };
    }
    return {
      ok: false,
      error: { code: "invalid-candidate", component: "text-clusters" }
    };
  }

  if (
    counted.clusterCount < 0
    || counted.clusterCount > collection.textFragmentCount
    || !validCount(counted.edgeTests)
  ) {
    return {
      ok: false,
      error: { code: "evidence-count-mismatch", component: "text-clusters" }
    };
  }

  const orderedSamples: DensityTextClusterSample[] = [];
  for (const component of counted.components) {
    const sample = densityClusterSample(component, collection.fragments);
    if (sample === undefined) {
      return {
        ok: false,
        error: { code: "evidence-count-mismatch", component: "text-clusters" }
      };
    }
    orderedSamples.push(sample);
  }
  orderedSamples.sort(compareClusterSamples);
  const samples = orderedSamples.slice(0, MAX_EVIDENCE_SAMPLES);
  return {
    ok: true,
    summary: {
      ...shared,
      coverage: "complete",
      textClusterCount: counted.clusterCount,
      edgeTestCount: counted.edgeTests,
      emittedSampleCount: samples.length,
      omittedSampleCount: counted.clusterCount - samples.length,
      samples
    }
  };
}

function densityClusterSample(
  component: readonly number[],
  fragments: readonly DensityTextFragment[]
): DensityTextClusterSample | undefined {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  const selectors: string[] = [];
  for (const index of component) {
    const fragment = fragments[index];
    left = Math.min(left, fragment.left);
    top = Math.min(top, fragment.top);
    right = Math.max(right, fragment.right);
    bottom = Math.max(bottom, fragment.bottom);
    selectors.push(fragment.selector);
  }
  selectors.sort(compareCodePoints);
  const selector = selectors[0];
  if (selector === undefined) {
    return undefined;
  }
  return {
    selector,
    region: {
      x: canonicalNumber(left),
      y: canonicalNumber(top),
      width: canonicalNumber(right - left),
      height: canonicalNumber(bottom - top)
    },
    fragmentCount: component.length
  };
}

function isValidTypographyPolicy(policy: TypographyVariantBudgetPolicy): boolean {
  return policy.policyId === TYPOGRAPHY_VARIANT_BUDGET_POLICY_ID
    && policy.methodId === TYPOGRAPHY_VARIANT_METHOD_ID
    && validBudget(policy.maxDistinctVariants, 2_000);
}

function isValidPalettePolicy(policy: PaletteDisciplineBudgetPolicy): boolean {
  return policy.policyId === PALETTE_DISCIPLINE_BUDGET_POLICY_ID
    && policy.methodId === PALETTE_DISCIPLINE_METHOD_ID
    && (policy.maxDistinctColors !== undefined
      || policy.maxChromaticHueFamilies !== undefined)
    && (policy.maxDistinctColors === undefined
      || validBudget(policy.maxDistinctColors, 5_000))
    && (policy.maxChromaticHueFamilies === undefined
      || validBudget(policy.maxChromaticHueFamilies, 12));
}

function isValidDensityPolicy(policy: DensityComplexityBudgetPolicy): boolean {
  return policy.policyId === DENSITY_COMPLEXITY_BUDGET_POLICY_ID
    && policy.methodId === DENSITY_COMPLEXITY_METHOD_ID
    && policy.visibleElementMethodId === DENSITY_VISIBLE_ELEMENT_METHOD_ID
    && policy.textClusterMethodId === DENSITY_TEXT_CLUSTER_METHOD_ID
    && (policy.maxVisibleElements !== undefined || policy.maxTextClusters !== undefined)
    && (policy.maxVisibleElements === undefined
      || validBudget(policy.maxVisibleElements, 10_000))
    && (policy.maxTextClusters === undefined
      || validBudget(policy.maxTextClusters, 20_000));
}

function isValidTypographyCandidate(candidate: TypographyVariantCandidate): boolean {
  return typeof candidate.selector === "string"
    && isValidRegion(candidate.region)
    && typeof candidate.fontFamily === "string"
    && typeof candidate.fontSize === "string"
    && typeof candidate.fontWeight === "string"
    && typeof candidate.fontStyle === "string";
}

function isValidPaletteCandidate(candidate: PaletteDisciplineCandidate): boolean {
  return typeof candidate.selector === "string"
    && isValidRegion(candidate.region)
    && PALETTE_PROPERTIES.has(candidate.property)
    && typeof candidate.value === "string";
}

function isValidDensityFragment(fragment: DensityTextFragment): boolean {
  return typeof fragment.rootId === "string"
    && fragment.rootId.length > 0
    && typeof fragment.selector === "string"
    && [fragment.left, fragment.top, fragment.right, fragment.bottom].every(Number.isFinite)
    && fragment.right > fragment.left
    && fragment.bottom > fragment.top;
}

function isValidRegion(region: VisualMetricRegion): boolean {
  return [region.x, region.y, region.width, region.height].every(Number.isFinite)
    && region.width > 0
    && region.height > 0;
}

function cloneRegion(region: VisualMetricRegion): VisualMetricRegion {
  return {
    x: canonicalNumber(region.x),
    y: canonicalNumber(region.y),
    width: canonicalNumber(region.width),
    height: canonicalNumber(region.height)
  };
}

function compareTypographyLocations(
  left: TypographyVariantLocation,
  right: TypographyVariantLocation
): number {
  return compareCodePoints(left.selector, right.selector)
    || compareRegions(left.region, right.region);
}

function comparePaletteLocations(
  left: PaletteColorLocation,
  right: PaletteColorLocation
): number {
  return compareCodePoints(left.selector, right.selector)
    || compareCodePoints(left.property, right.property)
    || compareRegions(left.region, right.region);
}

function compareRegionSamples(
  left: { selector: string; region: VisualMetricRegion },
  right: { selector: string; region: VisualMetricRegion }
): number {
  return compareRegions(left.region, right.region)
    || compareCodePoints(left.selector, right.selector);
}

function compareClusterSamples(
  left: DensityTextClusterSample,
  right: DensityTextClusterSample
): number {
  return compareRegions(left.region, right.region)
    || compareCodePoints(left.selector, right.selector);
}

function compareRegions(left: VisualMetricRegion, right: VisualMetricRegion): number {
  const leftBottom = left.y + left.height;
  const rightBottom = right.y + right.height;
  const leftRight = left.x + left.width;
  const rightRight = right.x + right.width;
  return left.y - right.y
    || left.x - right.x
    || leftBottom - rightBottom
    || leftRight - rightRight;
}

function compareRgba8(left: Rgba8, right: Rgba8): number {
  return left.red - right.red
    || left.green - right.green
    || left.blue - right.blue
    || left.alpha - right.alpha;
}

function compareCodePoints(left: string, right: string): number {
  const leftPoints = [...left].map((character) => character.codePointAt(0)!);
  const rightPoints = [...right].map((character) => character.codePointAt(0)!);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) {
      return leftPoints[index] - rightPoints[index];
    }
  }
  return leftPoints.length - rightPoints.length;
}

function validBudget(value: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && value >= 1 && value <= maximum;
}

function validCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function reasonCountsMatch(
  counts: Record<string, number>,
  allowedReasons: readonly string[],
  expected: number
): boolean {
  const allowed = new Set(allowedReasons);
  let sum = 0;
  for (const [reason, count] of Object.entries(counts)) {
    if (!allowed.has(reason) || !validCount(count)) {
      return false;
    }
    sum += count;
    if (!Number.isSafeInteger(sum)) {
      return false;
    }
  }
  return sum === expected;
}

function copyCounts<Reason extends string>(
  counts: Record<string, number>
): Partial<Record<Reason, number>> {
  return { ...counts } as Partial<Record<Reason, number>>;
}

function incrementCount<Reason extends string>(
  counts: Partial<Record<Reason, number>>,
  reason: Reason
): void {
  counts[reason] = (counts[reason] ?? 0) + 1;
}

function canonicalCounts<Reason extends string>(
  counts: Partial<Record<Reason, number>>,
  order: readonly Reason[]
): Partial<Record<Reason, number>> {
  const result: Partial<Record<Reason, number>> = {};
  for (const reason of order) {
    const count = counts[reason];
    if (count !== undefined && count > 0) {
      result[reason] = count;
    }
  }
  return result;
}

function canonicalNumber(value: number): number {
  return value === 0 ? 0 : value;
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

const TYPOGRAPHY_BROWSER_SKIP_REASONS = [
  "font-family-too-long"
] as const satisfies readonly TypographyVariantSkipReason[];

const TYPOGRAPHY_ANALYSIS_SKIP_REASONS = [
  "font-family-too-long",
  "invalid-font-family",
  "invalid-font-size",
  "invalid-font-weight",
  "invalid-font-style"
] as const satisfies readonly TypographyVariantAnalysisSkipReason[];

const PALETTE_BROWSER_SKIP_REASONS = [
  "computed-color-too-long"
] as const satisfies readonly PaletteDisciplineSkipReason[];

const PALETTE_ANALYSIS_SKIP_REASONS = [
  "computed-color-too-long",
  "unsupported-color"
] as const satisfies readonly PaletteDisciplineAnalysisSkipReason[];

const PALETTE_IGNORE_REASONS = [
  "selector-exception",
  "transparent"
] as const satisfies readonly PaletteDisciplineIgnoreReason[];

const DENSITY_SKIP_REASONS = [
  "unsupported-clip-or-mask"
] as const satisfies readonly DensityComplexitySkipReason[];

const PALETTE_PROPERTIES = new Set<PaletteDisciplineCandidate["property"]>([
  "color",
  "background-color",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color"
]);

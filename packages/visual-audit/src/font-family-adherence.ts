import {
  fontFamilyComparisonIdentity,
  type FontFamilyAdherencePolicy
} from "@design-harness/core";
import {
  FontFamilyParseError,
  MAX_FONT_FAMILY_DIAGNOSTIC_SCALARS,
  fontFamilyDiagnosticValue,
  unexpectedFontFamilies
} from "./font-family.js";
import type {
  FontFamilyAdherenceDisplayFamily,
  FontFamilyAdherenceStack,
  FontFamilyAdherenceSummary,
  TextInventoryItem
} from "./checks.js";

const MAX_STACK_FINDINGS = 5;
const MAX_STACK_SAMPLES = 5;

export interface FontFamilyAdherenceCounts {
  evaluatedElementCount: number;
  ignoredElementCount: number;
}

export interface FontFamilyAdherenceAnalysisError {
  code: "evidence-count-mismatch" | "unparsable-computed-family";
  elementIndex?: number;
  parserCode?: string;
}

export type FontFamilyAdherenceAnalysisResult =
  | { ok: true; summary: FontFamilyAdherenceSummary }
  | { ok: false; error: FontFamilyAdherenceAnalysisError };

export function analyzeFontFamilyAdherence(
  items: TextInventoryItem[],
  policy: FontFamilyAdherencePolicy,
  counts: FontFamilyAdherenceCounts
): FontFamilyAdherenceAnalysisResult {
  const capturedItems = items.filter((item) => item.fontFamily !== undefined);
  if (
    capturedItems.length !== counts.evaluatedElementCount
    || items.length !== counts.evaluatedElementCount + counts.ignoredElementCount
  ) {
    return { ok: false, error: { code: "evidence-count-mismatch" } };
  }

  const groups = new Map<string, {
    rawStack: string;
    unexpectedFamilies: FontFamilyAdherenceDisplayFamily[];
    affectedElementCount: number;
    selectors: string[];
    regions: FontFamilyAdherenceStack["regions"];
    firstObservedIndex: number;
  }>();
  let violatingElementCount = 0;

  for (const [elementIndex, item] of items.entries()) {
    if (item.fontFamily === undefined) {
      continue;
    }

    let unexpected;
    try {
      unexpected = unexpectedFontFamilies(item.fontFamily, policy);
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "unparsable-computed-family",
          elementIndex,
          ...(error instanceof FontFamilyParseError ? { parserCode: error.code } : {})
        }
      };
    }
    if (unexpected.length === 0) {
      continue;
    }

    violatingElementCount += 1;
    const existing = groups.get(item.fontFamily);
    if (existing) {
      existing.affectedElementCount += 1;
      if (existing.selectors.length < MAX_STACK_SAMPLES) {
        existing.selectors.push(fontFamilyDiagnosticValue(item.selector));
        existing.regions.push(item.region);
      }
      continue;
    }

    const uniqueUnexpected = new Map<string, FontFamilyAdherenceDisplayFamily>();
    for (const family of unexpected) {
      const key = fontFamilyComparisonIdentity(family.value, family.kind);
      if (!uniqueUnexpected.has(key)) {
        uniqueUnexpected.set(key, displayFamily(family));
      }
    }
    groups.set(item.fontFamily, {
      rawStack: item.fontFamily,
      unexpectedFamilies: [...uniqueUnexpected.values()],
      affectedElementCount: 1,
      selectors: [fontFamilyDiagnosticValue(item.selector)],
      regions: [item.region],
      firstObservedIndex: elementIndex
    });
  }

  const orderedGroups = [...groups.values()].sort((left, right) => (
    right.affectedElementCount - left.affectedElementCount
    || left.firstObservedIndex - right.firstObservedIndex
  ));
  const stacks = orderedGroups.slice(0, MAX_STACK_FINDINGS).map((group) => ({
    rawStack: group.rawStack,
    unexpectedFamilies: group.unexpectedFamilies,
    affectedElementCount: group.affectedElementCount,
    selectors: group.selectors,
    regions: group.regions
  }));

  return {
    ok: true,
    summary: {
      policyId: policy.policyId,
      allowedFamilies: policy.allowedFamilies.map(displayFamily),
      evaluatedElementCount: counts.evaluatedElementCount,
      ignoredElementCount: counts.ignoredElementCount,
      violatingElementCount,
      distinctViolationStackCount: orderedGroups.length,
      emittedStackCount: stacks.length,
      truncated: orderedGroups.length > stacks.length,
      stacks
    }
  };
}

function displayFamily(family: FontFamilyAdherenceDisplayFamily): FontFamilyAdherenceDisplayFamily {
  const truncated = [...family.value].length > MAX_FONT_FAMILY_DIAGNOSTIC_SCALARS;
  return {
    value: fontFamilyDiagnosticValue(family.value),
    kind: family.kind,
    ...(truncated ? { truncated: true } : {})
  };
}

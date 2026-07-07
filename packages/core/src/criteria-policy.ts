import { CRITERIA, CRITERION_SOURCES } from "./criteria.js";
import type {
  Criterion,
  CriterionSource,
  FindingDeterminism,
  FindingResultKind,
  SourceStrength
} from "./types.js";

/**
 * Criterion-level policy matrix (ADR-001). `integrity.ts` blocks
 * heuristic/subjective failures on individual findings; this module blocks
 * disallowed sourceStrength x determinism x resultKind combinations at the
 * registry level, before any finding exists.
 *
 * Each cell is the MAXIMUM resultKind a criterion may declare for that
 * sourceStrength and determinism. Downgrading is always allowed (when unsure,
 * downgrade). A missing cell means the determinism itself is disallowed for
 * that sourceStrength: research-grade and philosophical criteria may never
 * declare deterministic computation as criterion determinism, because
 * computation determinism never upgrades criterion strength.
 */
export const RESULT_KIND_CEILING: Record<SourceStrength, Partial<Record<FindingDeterminism, FindingResultKind>>> = {
  "official-testable": { deterministic: "failure", heuristic: "risk", subjective: "needs-review" },
  "project-contract": { deterministic: "risk", heuristic: "risk", subjective: "needs-review" },
  "official-pattern": { deterministic: "risk", heuristic: "risk", subjective: "needs-review" },
  "industry-heuristic": { deterministic: "risk", heuristic: "risk", subjective: "needs-review" },
  "research-emerging": { heuristic: "risk", subjective: "needs-review" },
  philosophical: { subjective: "needs-review" }
};

const RESULT_KIND_RANK: Record<FindingResultKind, number> = {
  "needs-review": 0,
  risk: 1,
  failure: 2
};

/**
 * Ladder for "the declared sourceStrength must be backed by at least one
 * referenced source of equal or greater strength". `project-contract` is not
 * on the ladder: a project's own declared config neither backs nor borrows
 * official strength, so it must be matched exactly.
 */
const OFFICIAL_STRENGTH_RANK: Partial<Record<SourceStrength, number>> = {
  "official-testable": 4,
  "official-pattern": 3,
  "industry-heuristic": 2,
  "research-emerging": 1,
  philosophical: 0
};

const WCAG_SC_ID_PATTERN = /^\d+\.\d+\.\d+$/;

export interface CriteriaPolicyIssue {
  path: string;
  message: string;
}

export interface CriteriaPolicyResult {
  valid: boolean;
  issues: CriteriaPolicyIssue[];
}

export function validateCriteriaPolicy(criteria: Criterion[], sources: CriterionSource[]): CriteriaPolicyResult {
  const issues: CriteriaPolicyIssue[] = [];
  const sourcesById = new Map(sources.map((source) => [source.id, source]));
  const criteriaById = new Map(criteria.map((criterion) => [criterion.id, criterion]));

  for (const criterion of criteria) {
    const path = `criterion.${criterion.id}`;

    const ceiling = RESULT_KIND_CEILING[criterion.sourceStrength]?.[criterion.determinism];
    if (!ceiling) {
      issues.push({
        path,
        message: `determinism "${criterion.determinism}" is not allowed for sourceStrength "${criterion.sourceStrength}"`
      });
    } else if (RESULT_KIND_RANK[criterion.resultKind] > RESULT_KIND_RANK[ceiling]) {
      issues.push({
        path,
        message:
          `resultKind "${criterion.resultKind}" exceeds the "${ceiling}" ceiling for ` +
          `sourceStrength "${criterion.sourceStrength}" + determinism "${criterion.determinism}"`
      });
    }

    if (criterion.runtime === "model-judged" && criterion.determinism !== "subjective") {
      issues.push({
        path,
        message: `runtime "model-judged" requires determinism "subjective", got "${criterion.determinism}"`
      });
    }

    const referencedSources = criterion.sourceRefs.map((sourceRef) => {
      const source = sourcesById.get(sourceRef);
      if (!source) {
        issues.push({ path, message: `references unknown source "${sourceRef}"` });
      }
      return source;
    });

    const declaredRank = OFFICIAL_STRENGTH_RANK[criterion.sourceStrength];
    const backed =
      declaredRank === undefined
        ? referencedSources.some((source) => source?.strength === criterion.sourceStrength)
        : referencedSources.some((source) => {
            const sourceRank = source ? OFFICIAL_STRENGTH_RANK[source.strength] : undefined;
            return sourceRank !== undefined && sourceRank >= declaredRank;
          });
    if (!backed) {
      issues.push({
        path,
        message: `sourceStrength "${criterion.sourceStrength}" is not backed by any referenced source of equal or greater strength`
      });
    }
  }

  for (const source of sources) {
    if (!source.clausesByCriterion) {
      continue;
    }
    const sourcePath = `source.${source.id}`;

    for (const [criterionId, clauses] of Object.entries(source.clausesByCriterion)) {
      const criterion = criteriaById.get(criterionId);
      if (!criterion) {
        issues.push({ path: sourcePath, message: `clausesByCriterion references unknown criterion "${criterionId}"` });
        continue;
      }
      if (!criterion.sourceRefs.includes(source.id)) {
        issues.push({
          path: sourcePath,
          message: `clausesByCriterion maps criterion "${criterionId}" which does not reference this source`
        });
      }
      if (clauses.length === 0 || clauses.some((clause) => clause.trim() === "")) {
        issues.push({ path: sourcePath, message: `clauses for criterion "${criterionId}" must be non-empty` });
      }
      if (source.id === "wcag-2-2") {
        for (const clause of clauses) {
          if (!WCAG_SC_ID_PATTERN.test(clause)) {
            issues.push({
              path: sourcePath,
              message: `clause "${clause}" for criterion "${criterionId}" is not a WCAG success-criterion id (expected e.g. "1.4.3")`
            });
          }
        }
      }
    }

    // Clause maps exist so standard remaps stay mechanical: once a source
    // ships one, every criterion citing that source must be mapped.
    for (const criterion of criteria) {
      if (!criterion.sourceRefs.includes(source.id)) {
        continue;
      }
      // The empty-array case is already reported per entry above.
      if (!source.clausesByCriterion[criterion.id]) {
        issues.push({
          path: `criterion.${criterion.id}`,
          message: `references source "${source.id}" but has no entry in its clausesByCriterion map`
        });
      }
    }
  }

  return {
    valid: issues.length === 0,
    issues
  };
}

export function validateRegistryCriteriaPolicy(): CriteriaPolicyResult {
  return validateCriteriaPolicy(CRITERIA, CRITERION_SOURCES);
}

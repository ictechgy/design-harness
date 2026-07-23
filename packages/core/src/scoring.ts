import type { AdvisoryScore, AdvisoryScoreV2, Confidence, Finding, Severity } from "./types.js";

const SCORING_FORMULA_VERSION: AdvisoryScoreV2["formulaVersion"] = "epistemic-criterion-max-v2";

const SEVERITY_POINTS: Record<Severity, number> = {
  low: 4,
  medium: 10,
  high: 20,
  critical: 35
};

const CONFIDENCE_WEIGHT: Record<Confidence, number> = {
  low: 0.5,
  medium: 0.75,
  high: 1
};

interface WeightedFinding {
  finding: Finding;
  points: number;
  epistemicWeight: number;
}

type ScoreGroupKind = "criterion" | "legacy check";

interface ScoreGroup {
  key: string;
  kind: ScoreGroupKind;
  members: WeightedFinding[];
}

export function scoreFindings(findings: readonly Finding[]): AdvisoryScoreV2 {
  const groups = new Map<string, ScoreGroup>();

  for (const finding of findings) {
    const epistemicWeight = epistemicWeightForFinding(finding);
    if (epistemicWeight === 0) {
      continue;
    }

    const points = round(SEVERITY_POINTS[finding.severity] * CONFIDENCE_WEIGHT[finding.confidence] * epistemicWeight);
    const { key, kind } = scoreGroupIdentity(finding);
    const identity = JSON.stringify([kind, key]);
    const group = groups.get(identity) ?? { key, kind, members: [] };
    group.members.push({ finding, points, epistemicWeight });
    groups.set(identity, group);
  }

  const deductions = [...groups.values()]
    .sort((left, right) => (
      compareUtf16CodeUnits(left.key, right.key)
      || compareUtf16CodeUnits(left.kind, right.kind)
    ))
    .map(({ key: groupKey, kind: groupKind, members }) => {
      const sortedMembers = [...members].sort((left, right) => compareUtf16CodeUnits(left.finding.id, right.finding.id));
      const representative = sortedMembers.reduce((maximum, candidate) => (
        candidate.points > maximum.points ? candidate : maximum
      ));

      return {
        findingId: representative.finding.id,
        findingIds: sortedMembers.map(({ finding }) => finding.id),
        viewports: [...new Set(members.map(({ finding }) => finding.viewport))].sort(compareUtf16CodeUnits),
        points: representative.points,
        reason: `Maximum scoreable occurrence for ${groupKind} ${groupKey} across ${members.length} ${pluralize(members.length, "occurrence")}; ${deductionReason(representative.finding, representative.epistemicWeight)}`
      };
    });

  const totalDeduction = round(deductions.reduce((sum, deduction) => sum + deduction.points, 0));
  const value = Math.max(0, round(100 - totalDeduction));

  return {
    formulaVersion: SCORING_FORMULA_VERSION,
    value,
    max: 100,
    band: scoreBand(value),
    deductions,
    totalDeduction,
    saturated: totalDeduction > 100,
    explanation: "Advisory score starts at 100 and subtracts the maximum scoreable finding once per criterion (or legacy check name), weighted by severity, confidence, and evidence tier. Needs-review findings are score-exempt and omitted, as are other zero-weight findings. This formula is not directly comparable with epistemic-weight-v1. It is not an objective design-quality grade."
  };
}

/**
 * A one-line verdict for the advisory score.
 *
 * Keyed on the actual finding composition, not the band alone: the band is a score threshold that
 * heuristic risks also pull down (weight 0.25), so inferring "deterministic" from the band would let a
 * heuristic-only audit claim "deterministic findings" it does not have. This function never names a
 * determinism class or result kind the findings do not contain — that is HARD RULE 1 applied to report copy.
 */
export function verdictForScore(score: AdvisoryScore, findings: Finding[] = []): string {
  const deterministicFailures = findings.filter(
    (finding) => finding.determinism === "deterministic" && finding.resultKind === "failure"
  ).length;
  const deterministicRisks = findings.filter(
    (finding) => finding.determinism === "deterministic" && finding.resultKind === "risk"
  ).length;
  const heuristicRisks = findings.filter(
    (finding) => finding.determinism === "heuristic" && finding.resultKind === "risk"
  ).length;

  if (deterministicFailures > 0) {
    return `Blocked by ${deterministicFailures} deterministic ${pluralize(deterministicFailures, "failure")}.`;
  }
  if (score.band === "strong") {
    return "No deterministic failures in the captured scope.";
  }

  // usable / needs-work / blocked with no deterministic failures: name what actually drove the score,
  // never asserting a class that is absent.
  const drivers: string[] = [];
  if (deterministicRisks > 0) {
    drivers.push(`${deterministicRisks} deterministic ${pluralize(deterministicRisks, "risk")}`);
  }
  if (heuristicRisks > 0) {
    drivers.push(`${heuristicRisks} heuristic ${pluralize(heuristicRisks, "risk")}`);
  }
  const driverText = drivers.length > 0 ? drivers.join(" and ") : "advisory deductions";
  const prefix = score.band === "usable" ? "Usable with" : "Below the advisory threshold on";
  return `${prefix} ${driverText}.`;
}

function pluralize(count: number, noun: string): string {
  return count === 1 ? noun : `${noun}s`;
}

function scoreBand(value: number): AdvisoryScore["band"] {
  if (value >= 90) {
    return "strong";
  }
  if (value >= 75) {
    return "usable";
  }
  if (value >= 60) {
    return "needs-work";
  }
  return "blocked";
}

function epistemicWeightForFinding(finding: Finding): number {
  if (finding.resultKind === "needs-review") {
    return 0;
  }

  if (finding.determinism === "deterministic" && finding.resultKind === "failure") {
    return 1;
  }

  if (finding.determinism === "deterministic" && finding.resultKind === "risk") {
    return 0.6;
  }

  if (finding.determinism === "heuristic" && finding.resultKind === "risk") {
    return 0.25;
  }

  if (finding.determinism === "subjective") {
    return 0;
  }

  return 0.25;
}

function scoreGroupIdentity(finding: Finding): { key: string; kind: ScoreGroupKind } {
  return finding.criterionId === undefined
    ? { key: finding.checkName, kind: "legacy check" }
    : { key: finding.criterionId, kind: "criterion" };
}

function compareUtf16CodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deductionReason(finding: Finding, epistemicWeight: number): string {
  const base = `${finding.severity} ${finding.category} finding with ${finding.confidence} confidence`;
  if (!finding.determinism || !finding.resultKind) {
    return `${base}; legacy/unclassified score weight ${epistemicWeight}`;
  }

  if (finding.resultKind === "needs-review") {
    return `${base}; ${finding.determinism} needs-review finding is score-exempt`;
  }

  return `${base}; ${finding.determinism} ${finding.resultKind} score weight ${epistemicWeight}`;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

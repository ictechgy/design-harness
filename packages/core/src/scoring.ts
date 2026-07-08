import type { AdvisoryScore, Confidence, Finding, Severity } from "./types.js";

const SCORING_FORMULA_VERSION: AdvisoryScore["formulaVersion"] = "epistemic-weight-v1";

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

export function scoreFindings(findings: Finding[]): AdvisoryScore {
  const deductions = findings.map((finding) => {
    const epistemicWeight = epistemicWeightForFinding(finding);
    const points = round(SEVERITY_POINTS[finding.severity] * CONFIDENCE_WEIGHT[finding.confidence] * epistemicWeight);
    return {
      findingId: finding.id,
      points,
      reason: deductionReason(finding, epistemicWeight)
    };
  });

  const totalDeduction = deductions.reduce((sum, deduction) => sum + deduction.points, 0);
  const value = Math.max(0, round(100 - totalDeduction));

  return {
    formulaVersion: SCORING_FORMULA_VERSION,
    value,
    max: 100,
    band: scoreBand(value),
    deductions,
    explanation: "Advisory score starts at 100 and subtracts finding deductions by severity, confidence, and evidence-tier weight. Needs-review findings are score-exempt. It is not an objective design-quality grade."
  };
}

export function verdictForScore(score: AdvisoryScore): string {
  switch (score.band) {
    case "strong":
      return "No blocking deterministic findings.";
    case "usable":
      return "Usable with issues worth addressing.";
    case "needs-work":
      return "Needs revision before relying on this UI.";
    case "blocked":
      return "Blocked by high-risk deterministic findings.";
  }
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

  return 1;
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

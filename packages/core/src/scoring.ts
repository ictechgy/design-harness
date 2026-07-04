import type { AdvisoryScore, Confidence, Finding, Severity } from "./types.js";

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
    const points = round(SEVERITY_POINTS[finding.severity] * CONFIDENCE_WEIGHT[finding.confidence]);
    return {
      findingId: finding.id,
      points,
      reason: `${finding.severity} ${finding.category} finding with ${finding.confidence} confidence`
    };
  });

  const totalDeduction = deductions.reduce((sum, deduction) => sum + deduction.points, 0);
  const value = Math.max(0, round(100 - totalDeduction));

  return {
    value,
    max: 100,
    band: scoreBand(value),
    deductions,
    explanation: "Advisory score starts at 100 and subtracts deterministic finding deductions by severity and confidence. It is not an objective design-quality grade."
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

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

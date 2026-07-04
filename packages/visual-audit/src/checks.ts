import type { Finding, RubricCategory, Severity } from "@design-harness/core";

export interface ElementSample {
  selector: string;
  text?: string;
  region?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface ContrastRiskSample extends ElementSample {
  ratio: number;
  requiredRatio: number;
  color: string;
  backgroundColor: string;
}

export interface ViewportMeasurements {
  viewport: string;
  viewportWidth: number;
  viewportHeight: number;
  documentScrollWidth: number;
  bodyScrollWidth: number;
  textLength: number;
  meaningfulElementCount: number;
  clippedText: ElementSample[];
  contrastRisks: ContrastRiskSample[];
}

export function findingsFromMeasurements(
  measurements: ViewportMeasurements,
  evidenceRefs: string[]
): Finding[] {
  const findings: Finding[] = [];

  if (isLikelyBlank(measurements)) {
    findings.push(createFinding({
      id: `finding-${measurements.viewport}-blank-render`,
      category: "layout",
      severity: "critical",
      viewport: measurements.viewport,
      evidenceRefs,
      problem: "The page appears to have rendered with no meaningful visible content.",
      recommendation: "Check client-side errors, loading states, and root layout rendering before evaluating visual quality.",
      checkName: "blank-render"
    }));
  }

  if (hasHorizontalOverflow(measurements)) {
    findings.push(createFinding({
      id: `finding-${measurements.viewport}-horizontal-overflow`,
      category: "responsiveness",
      severity: "medium",
      viewport: measurements.viewport,
      evidenceRefs,
      problem: `The document width (${measurements.documentScrollWidth}px) exceeds the ${measurements.viewportWidth}px viewport.`,
      recommendation: "Constrain wide content, tables, media, or fixed-width containers so the page does not require horizontal scrolling.",
      checkName: "horizontal-overflow"
    }));
  }

  for (const [index, sample] of measurements.clippedText.slice(0, 5).entries()) {
    findings.push(createFinding({
      id: `finding-${measurements.viewport}-text-clipping-${index + 1}`,
      category: "visual-polish",
      severity: "medium",
      viewport: measurements.viewport,
      selector: sample.selector,
      region: sample.region,
      evidenceRefs,
      problem: `Text may be clipped in ${sample.selector}.`,
      recommendation: "Allow the container to grow, wrap text, reduce copy length, or adjust overflow styling.",
      checkName: "text-clipping"
    }));
  }

  for (const [index, sample] of measurements.contrastRisks.slice(0, 5).entries()) {
    findings.push(createFinding({
      id: `finding-${measurements.viewport}-contrast-risk-${index + 1}`,
      category: "accessibility",
      severity: "medium",
      viewport: measurements.viewport,
      selector: sample.selector,
      region: sample.region,
      evidenceRefs,
      problem: `DOM-computed text contrast may be low in ${sample.selector} (${sample.ratio.toFixed(2)}:1, target ${sample.requiredRatio}:1).`,
      recommendation: "Increase foreground/background contrast or adjust font size and weight for readable text.",
      checkName: "dom-contrast-risk"
    }));
  }

  return findings;
}

export function createRenderFailureFinding(input: {
  id: string;
  viewport: string;
  evidenceRefs: string[];
  problem: string;
  recommendation?: string;
}): Finding {
  return createFinding({
    id: input.id,
    category: "layout",
    severity: "critical",
    viewport: input.viewport,
    evidenceRefs: input.evidenceRefs,
    problem: input.problem,
    recommendation:
      input.recommendation ??
      "Fix navigation, render, or capture failures before relying on visual audit output.",
    checkName: "render-failure"
  });
}

function createFinding(input: {
  id: string;
  category: RubricCategory;
  severity: Severity;
  viewport: string;
  selector?: string;
  region?: Finding["region"];
  evidenceRefs: string[];
  problem: string;
  recommendation: string;
  checkName: string;
}): Finding {
  return {
    ...input,
    confidence: input.checkName === "blank-render" || input.checkName === "render-failure" ? "high" : "medium"
  };
}

function isLikelyBlank(measurements: ViewportMeasurements): boolean {
  return measurements.textLength === 0 && measurements.meaningfulElementCount === 0;
}

function hasHorizontalOverflow(measurements: ViewportMeasurements): boolean {
  const widestDocument = Math.max(measurements.documentScrollWidth, measurements.bodyScrollWidth);
  return widestDocument > measurements.viewportWidth + 2;
}

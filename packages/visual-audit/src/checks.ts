import {
  findingMetadataForCheck,
  type AllowedFontFamily,
  type Confidence,
  type CopySurfaceResolution,
  type Finding,
  type FindingObservation,
  type RubricCategory,
  type Severity
} from "@design-harness/core";
import {
  assertFindingCoverageIntegrity,
  type FindingCoverage
} from "./finding-coverage.js";

export type { FindingCoverage, FindingCoverageEntry } from "./finding-coverage.js";

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

/** How many elements the contrast check actually scored, and why the rest were skipped. */
export interface ContrastCoverage {
  evaluatedElementCount: number;
  skippedElementCount: number;
  skippedByReason: Record<string, number>;
}

export interface ContrastRiskSample extends ElementSample {
  ratio: number;
  requiredRatio: number;
  color: string;
  backgroundColor: string;
}

export interface HeadingIssueSample extends ElementSample {
  level: number;
  issue: "empty-heading" | "heading-level-skip" | "duplicate-h1";
  previousLevel?: number;
}

export interface RepeatedLabelSample {
  label: string;
  count: number;
  selectors: string[];
}

export interface RepeatedVisualWeightSample {
  count: number;
  selectors: string[];
  averageArea: number;
  areaVariation: number;
}

export interface SaturatedColorNoiseSample {
  count: number;
  hueBucketCount: number;
  hueBuckets: number[];
  selectors: string[];
}

export interface ChecklistStateVisibilitySample {
  reason: "inconsistent-checked-styles" | "checked-unchecked-styles-too-similar";
  checkedCount: number;
  uncheckedCount: number;
  selectors: string[];
}

export interface LineLengthSample extends ElementSample {
  estimatedCharactersPerLine: number;
}

export interface TextInventoryItem {
  selector: string;
  text: string;
  truncated?: true;
  region: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  fontSize: number;
  fontWeight: string;
  nearestLang: string;
  tag: string;
  role: string;
  accessibleName: string;
  copySurface?: CopySurfaceResolution;
  fontFamily?: string;
}

export interface FontFamilyAdherenceDisplayFamily extends AllowedFontFamily {
  truncated?: true;
}

export interface FontFamilyAdherenceStack {
  rawStack: string;
  unexpectedFamilies: FontFamilyAdherenceDisplayFamily[];
  affectedElementCount: number;
  selectors: string[];
  regions: Array<NonNullable<ElementSample["region"]>>;
}

export interface FontFamilyAdherenceSummary {
  policyId: "font-family-adherence-v1";
  allowedFamilies: FontFamilyAdherenceDisplayFamily[];
  evaluatedElementCount: number;
  ignoredElementCount: number;
  violatingElementCount: number;
  distinctViolationStackCount: number;
  emittedStackCount: number;
  truncated: boolean;
  stacks: FontFamilyAdherenceStack[];
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
  /** Per-viewport contrast evaluation coverage. Absent on measurements built before v0.5c. */
  contrastCoverage?: ContrastCoverage;
  missingAccessibleNames: ElementSample[];
  missingFormLabels: ElementSample[];
  missingImageAlt: ElementSample[];
  headingIssues: HeadingIssueSample[];
  pageLangMissing: boolean;
  missingMainLandmark: boolean;
  repeatedLabels: RepeatedLabelSample[];
  repeatedVisualWeightRisks: RepeatedVisualWeightSample[];
  saturatedColorNoiseRisks: SaturatedColorNoiseSample[];
  checklistStateVisibilityRisks: ChecklistStateVisibilitySample[];
  fixedWidthRisks: ElementSample[];
  stickyObstructionRisks: ElementSample[];
  excessiveLineLength: LineLengthSample[];
  tapTargetRisks: ElementSample[];
  formErrorAssociationRisks: ElementSample[];
  colorOnlyStateRisks: ElementSample[];
  disabledWithoutExplanation: ElementSample[];
  statusLiveRegionRisks: ElementSample[];
  modalFocusRisks: ElementSample[];
  customControlSemanticsRisks: ElementSample[];
  movingContentControlRisks: ElementSample[];
  textInventory: TextInventoryItem[];
  fontFamilyAdherence?: FontFamilyAdherenceSummary;
  findingCoverage?: FindingCoverage;
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
      checkName: "blank-render",
      observed: {
        textLength: measurements.textLength,
        meaningfulElementCount: measurements.meaningfulElementCount
      },
      expected: "Meaningful visible content is present."
    }));
    assertFindingCoverageIntegrity(measurements.findingCoverage, measurements.viewport, findings);
    return findings;
  }

  const fontFamilyAdherence = measurements.fontFamilyAdherence;
  if (fontFamilyAdherence) {
    for (const [index, stack] of fontFamilyAdherence.stacks.entries()) {
      findings.push(createFinding({
        id: `finding-${measurements.viewport}-unapproved-font-family-${index + 1}`,
        category: "visual-polish",
        severity: "low",
        viewport: measurements.viewport,
        selector: stack.selectors[0],
        region: stack.regions[0],
        evidenceRefs,
        problem: `The computed font-family list for ${stack.affectedElementCount} visible text ${stack.affectedElementCount === 1 ? "element contains" : "elements contain"} names outside the configured project guide.`,
        recommendation: "Use the declared generation tokens, add intentional runtime families under audit.fontFamily.additionalAllowedFamilies, or reserve selector exceptions for third-party content.",
        checkName: "unapproved-font-family",
        observed: {
          rawComputedStack: stack.rawStack,
          unexpectedFamilies: stack.unexpectedFamilies,
          affectedElementCount: stack.affectedElementCount,
          selectors: stack.selectors,
          regions: stack.regions,
          policyId: fontFamilyAdherence.policyId
        },
        expected: {
          allowedFamilies: fontFamilyAdherence.allowedFamilies,
          comparison: "Every computed list member is declared by the explicit project guide."
        }
      }));
    }
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
      checkName: "horizontal-overflow",
      observed: {
        documentScrollWidth: measurements.documentScrollWidth,
        bodyScrollWidth: measurements.bodyScrollWidth,
        viewportWidth: measurements.viewportWidth
      },
      expected: "Document and body scroll widths stay within the viewport width."
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
      checkName: "text-clipping",
      observed: sample.text ? { text: sample.text, region: sample.region } : sample.region ?? sample.selector,
      expected: "Visible text fits within its container without clipping."
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
      checkName: "dom-contrast-risk",
      observed: {
        ratio: Number(sample.ratio.toFixed(2)),
        color: sample.color,
        backgroundColor: sample.backgroundColor
      },
      expected: {
        ratio: sample.requiredRatio
      }
    }));
  }

  for (const [index, sample] of measurements.missingAccessibleNames.slice(0, 5).entries()) {
    findings.push(createFinding({
      id: `finding-${measurements.viewport}-missing-accessible-name-${index + 1}`,
      category: "accessibility",
      severity: "medium",
      viewport: measurements.viewport,
      selector: sample.selector,
      region: sample.region,
      evidenceRefs,
      problem: `Interactive element ${sample.selector} may not expose a usable accessible name.`,
      recommendation: "Add visible text, aria-label, aria-labelledby, or use a native control with a clear label.",
      checkName: "missing-accessible-name",
      observed: sample.text ? { text: sample.text, region: sample.region } : sample.region ?? sample.selector,
      expected: "Interactive controls expose a non-empty accessible name."
    }));
  }

  for (const [index, sample] of measurements.missingFormLabels.slice(0, 5).entries()) {
    findings.push(createFinding({
      id: `finding-${measurements.viewport}-missing-form-label-${index + 1}`,
      category: "accessibility",
      severity: "medium",
      viewport: measurements.viewport,
      selector: sample.selector,
      region: sample.region,
      evidenceRefs,
      problem: `Form control ${sample.selector} may not have a programmatic label.`,
      recommendation: "Associate the control with a visible label, aria-label, or aria-labelledby.",
      checkName: "missing-form-label",
      observed: sample.region ?? sample.selector,
      expected: "Form controls have programmatic labels."
    }));
  }

  for (const [index, sample] of measurements.missingImageAlt.slice(0, 5).entries()) {
    findings.push(createFinding({
      id: `finding-${measurements.viewport}-missing-image-alt-${index + 1}`,
      category: "accessibility",
      severity: "medium",
      viewport: measurements.viewport,
      selector: sample.selector,
      region: sample.region,
      evidenceRefs,
      problem: `Image ${sample.selector} does not declare alt text or an intentional decorative alt attribute.`,
      recommendation: "Add meaningful alt text for informative images, or use alt=\"\" for decorative images.",
      checkName: "missing-image-alt",
      observed: sample.region ?? sample.selector,
      expected: "Informative images provide text alternatives or decorative images are explicitly marked."
    }));
  }

  for (const [index, sample] of measurements.headingIssues.slice(0, 5).entries()) {
    findings.push(createFinding({
      id: `finding-${measurements.viewport}-${sample.issue}-${index + 1}`,
      category: "hierarchy",
      severity: sample.issue === "duplicate-h1" ? "low" : "medium",
      viewport: measurements.viewport,
      selector: sample.selector,
      region: sample.region,
      evidenceRefs,
      problem: headingProblem(sample),
      recommendation: "Use headings to describe page and section structure in a clear order.",
      checkName: sample.issue,
      observed: {
        level: sample.level,
        previousLevel: sample.previousLevel,
        text: sample.text
      },
      expected: "Heading levels progress clearly without empty headings or ambiguous top-level structure."
    }));
  }

  if (measurements.pageLangMissing) {
    findings.push(createFinding({
      id: `finding-${measurements.viewport}-page-lang-missing`,
      category: "accessibility",
      severity: "high",
      viewport: measurements.viewport,
      selector: "html",
      evidenceRefs,
      problem: "The html element does not declare a non-empty lang attribute, so assistive technology cannot determine the page language.",
      recommendation: "Add a valid lang attribute to the html element, for example <html lang=\"ko\"> or <html lang=\"en\">.",
      checkName: "page-lang-missing",
      observed: false,
      expected: "The html element declares a non-empty lang attribute."
    }));
  }

  if (measurements.missingMainLandmark) {
    findings.push(createFinding({
      id: `finding-${measurements.viewport}-missing-main-landmark`,
      category: "hierarchy",
      severity: "medium",
      viewport: measurements.viewport,
      selector: "body",
      evidenceRefs,
      problem: "The page does not expose a main landmark in the captured DOM.",
      recommendation: "Wrap primary page content in a <main> element or role=\"main\" landmark.",
      checkName: "missing-main-landmark",
      observed: false,
      expected: "A main landmark is present."
    }));
  }

  for (const [index, sample] of measurements.repeatedLabels.slice(0, 5).entries()) {
    findings.push(createFinding({
      id: `finding-${measurements.viewport}-ambiguous-repeated-label-${index + 1}`,
      category: "task-fit",
      severity: "low",
      confidence: "low",
      viewport: measurements.viewport,
      evidenceRefs,
      problem: `The label "${sample.label}" is reused by ${sample.count} interactive elements, which may be ambiguous.`,
      recommendation: "Make repeated action labels more specific with visible text or accessible-name context.",
      checkName: "ambiguous-repeated-label",
      observed: {
        label: sample.label,
        count: sample.count,
        selectors: sample.selectors
      },
      expected: "Repeated interactive labels are specific enough to distinguish actions."
    }));
  }

  for (const [index, sample] of measurements.repeatedVisualWeightRisks.slice(0, 3).entries()) {
    findings.push(createFinding({
      id: `finding-${measurements.viewport}-repeated-visual-weight-risk-${index + 1}`,
      category: "hierarchy",
      severity: "low",
      confidence: "low",
      viewport: measurements.viewport,
      evidenceRefs,
      problem: `${sample.count} similarly sized content panels may be competing with the same visual weight.`,
      recommendation: "Create a clearer primary/secondary scan path by grouping secondary panels, enlarging the primary region, or reducing repeated equal-weight modules.",
      checkName: "repeated-visual-weight-risk",
      observed: {
        count: sample.count,
        selectors: sample.selectors,
        averageArea: sample.averageArea,
        areaVariation: sample.areaVariation
      },
      expected: "Repeated panels either communicate intentional equal priority or provide clear visual hierarchy."
    }));
  }

  for (const [index, sample] of measurements.saturatedColorNoiseRisks.slice(0, 3).entries()) {
    findings.push(createFinding({
      id: `finding-${measurements.viewport}-saturated-color-noise-risk-${index + 1}`,
      category: "hierarchy",
      severity: "low",
      confidence: "low",
      viewport: measurements.viewport,
      evidenceRefs,
      problem: `${sample.count} saturated color regions across ${sample.hueBucketCount} hue groups may be competing for attention.`,
      recommendation: "Reserve saturated colors for stable status, brand, or primary-action meaning; reduce decorative color variety where it weakens scan priority.",
      checkName: "saturated-color-noise-risk",
      observed: {
        count: sample.count,
        hueBucketCount: sample.hueBucketCount,
        hueBuckets: sample.hueBuckets,
        selectors: sample.selectors
      },
      expected: "Saturated color is used sparingly and maps to clear priority, grouping, or status meaning."
    }));
  }

  for (const [index, sample] of measurements.checklistStateVisibilityRisks.slice(0, 3).entries()) {
    findings.push(createFinding({
      id: `finding-${measurements.viewport}-checklist-state-visibility-risk-${index + 1}`,
      category: "interaction",
      severity: "low",
      confidence: "low",
      viewport: measurements.viewport,
      evidenceRefs,
      problem: checklistStateProblem(sample),
      recommendation: "Make checked, active, and inactive checklist states visually consistent and distinct through stable color, icon, text, or row treatment.",
      checkName: "checklist-state-visibility-risk",
      observed: {
        reason: sample.reason,
        checkedCount: sample.checkedCount,
        uncheckedCount: sample.uncheckedCount,
        selectors: sample.selectors
      },
      expected: "Checklist state treatment makes completed/current/inactive items easy to distinguish."
    }));
  }

  for (const [index, sample] of measurements.fixedWidthRisks.slice(0, 5).entries()) {
    findings.push(createFinding({
      id: `finding-${measurements.viewport}-fixed-width-risk-${index + 1}`,
      category: "responsiveness",
      severity: "low",
      confidence: "low",
      viewport: measurements.viewport,
      selector: sample.selector,
      region: sample.region,
      evidenceRefs,
      problem: `Element ${sample.selector} appears wider than the viewport and may create brittle responsive behavior.`,
      recommendation: "Use responsive max-width, flexible grid/flex sizing, or container-relative units instead of brittle wide sizing.",
      checkName: "fixed-width-risk",
      observed: sample.region ?? sample.selector,
      expected: "Layout-critical elements adapt to the viewport without brittle wide sizing."
    }));
  }

  for (const [index, sample] of measurements.stickyObstructionRisks.slice(0, 5).entries()) {
    findings.push(createFinding({
      id: `finding-${measurements.viewport}-sticky-obstruction-risk-${index + 1}`,
      category: "responsiveness",
      severity: "low",
      confidence: "low",
      viewport: measurements.viewport,
      selector: sample.selector,
      region: sample.region,
      evidenceRefs,
      problem: `Sticky or fixed element ${sample.selector} may obscure too much of the viewport.`,
      recommendation: "Reduce sticky/fixed element size, reserve space in layout, or avoid covering primary content.",
      checkName: "sticky-obstruction-risk",
      observed: sample.region ?? sample.selector,
      expected: "Sticky and fixed elements leave enough visible space for primary content."
    }));
  }

  for (const [index, sample] of measurements.excessiveLineLength.slice(0, 5).entries()) {
    findings.push(createFinding({
      id: `finding-${measurements.viewport}-excessive-line-length-${index + 1}`,
      category: "visual-polish",
      severity: "low",
      confidence: "low",
      viewport: measurements.viewport,
      selector: sample.selector,
      region: sample.region,
      evidenceRefs,
      problem: `Text in ${sample.selector} may be hard to scan at about ${sample.estimatedCharactersPerLine} characters per line.`,
      recommendation: "Constrain reading width or split dense content into a more readable layout.",
      checkName: "excessive-line-length",
      observed: {
        estimatedCharactersPerLine: sample.estimatedCharactersPerLine,
        region: sample.region
      },
      expected: "Reading-heavy text stays within a comfortable line length."
    }));
  }

  for (const [index, sample] of measurements.tapTargetRisks.slice(0, 5).entries()) {
    findings.push(createFinding({
      id: `finding-${measurements.viewport}-tap-target-risk-${index + 1}`,
      category: "accessibility",
      severity: "medium",
      viewport: measurements.viewport,
      selector: sample.selector,
      region: sample.region,
      evidenceRefs,
      problem: `Interactive target ${sample.selector} appears smaller than the configured minimum target size.`,
      recommendation: "Increase the control hit area or spacing so the target is easier to activate.",
      checkName: "tap-target-risk",
      observed: sample.region ?? sample.selector,
      expected: "Interactive targets are at least 24 by 24 CSS pixels unless an exception applies."
    }));
  }

  for (const [index, sample] of measurements.formErrorAssociationRisks.slice(0, 5).entries()) {
    findings.push(createFinding({
      id: `finding-${measurements.viewport}-form-error-association-risk-${index + 1}`,
      category: "accessibility",
      severity: "medium",
      viewport: measurements.viewport,
      selector: sample.selector,
      region: sample.region,
      evidenceRefs,
      problem: `Invalid form control ${sample.selector} may not be associated with error text.`,
      recommendation: "Connect invalid controls to visible error messages with aria-describedby, aria-errormessage, or equivalent labeling.",
      checkName: "form-error-association-risk",
      observed: sample.region ?? sample.selector,
      expected: "Invalid form controls expose associated error guidance."
    }));
  }

  for (const [index, sample] of measurements.colorOnlyStateRisks.slice(0, 5).entries()) {
    findings.push(createFinding({
      id: `finding-${measurements.viewport}-color-only-state-risk-${index + 1}`,
      category: "accessibility",
      severity: "low",
      confidence: "low",
      viewport: measurements.viewport,
      selector: sample.selector,
      region: sample.region,
      evidenceRefs,
      problem: `State indicator ${sample.selector} may rely on color or decoration without text or programmatic state.`,
      recommendation: "Add visible state text, accessible names, or programmatic state so color is not the only cue.",
      checkName: "color-only-state-risk",
      observed: sample.region ?? sample.selector,
      expected: "State is communicated with more than color alone."
    }));
  }

  for (const [index, sample] of measurements.disabledWithoutExplanation.slice(0, 5).entries()) {
    findings.push(createFinding({
      id: `finding-${measurements.viewport}-disabled-without-explanation-${index + 1}`,
      category: "interaction",
      severity: "low",
      confidence: "low",
      viewport: measurements.viewport,
      selector: sample.selector,
      region: sample.region,
      evidenceRefs,
      problem: `Disabled control ${sample.selector} may not explain why the action is unavailable.`,
      recommendation: "Provide nearby explanatory text, tooltip content, or validation guidance for disabled controls.",
      checkName: "disabled-without-explanation",
      observed: sample.text ? { text: sample.text, region: sample.region } : sample.region ?? sample.selector,
      expected: "Disabled controls include enough context to understand the blocked action."
    }));
  }

  for (const [index, sample] of measurements.statusLiveRegionRisks.slice(0, 5).entries()) {
    findings.push(createFinding({
      id: `finding-${measurements.viewport}-status-live-region-risk-${index + 1}`,
      category: "interaction",
      severity: "low",
      confidence: "low",
      viewport: measurements.viewport,
      selector: sample.selector,
      region: sample.region,
      evidenceRefs,
      problem: `Dynamic status text in ${sample.selector} may not be exposed as a status, alert, progressbar, or live region.`,
      recommendation: "Use visible status text plus role=\"status\", role=\"alert\", progressbar, or aria-live where dynamic updates occur.",
      checkName: "status-live-region-risk",
      observed: sample.text ? { text: sample.text, region: sample.region } : sample.region ?? sample.selector,
      expected: "Dynamic status feedback is visibly and programmatically perceivable."
    }));
  }

  for (const [index, sample] of measurements.modalFocusRisks.slice(0, 5).entries()) {
    findings.push(createFinding({
      id: `finding-${measurements.viewport}-modal-focus-risk-${index + 1}`,
      category: "interaction",
      severity: "medium",
      viewport: measurements.viewport,
      selector: sample.selector,
      region: sample.region,
      evidenceRefs,
      problem: `Dialog ${sample.selector} may not expose complete modal or focus structure.`,
      recommendation: "Use native dialog semantics, aria-modal for modal dialogs, and focusable close/action controls.",
      checkName: "modal-focus-risk",
      observed: sample.text ? { text: sample.text, region: sample.region } : sample.region ?? sample.selector,
      expected: "Visible dialogs expose modal semantics and focusable controls."
    }));
  }

  for (const [index, sample] of measurements.customControlSemanticsRisks.slice(0, 5).entries()) {
    findings.push(createFinding({
      id: `finding-${measurements.viewport}-custom-control-semantics-risk-${index + 1}`,
      category: "accessibility",
      severity: "medium",
      viewport: measurements.viewport,
      selector: sample.selector,
      region: sample.region,
      evidenceRefs,
      problem: `Custom interactive element ${sample.selector} may not expose native control semantics.`,
      recommendation: "Prefer native controls, or add role, keyboard focus, keyboard handlers, and accessible naming for custom controls.",
      checkName: "custom-control-semantics-risk",
      observed: sample.text ? { text: sample.text, region: sample.region } : sample.region ?? sample.selector,
      expected: "Custom controls expose names, roles, focusability, and keyboard behavior."
    }));
  }

  for (const [index, sample] of measurements.movingContentControlRisks.slice(0, 5).entries()) {
    findings.push(createFinding({
      id: `finding-${measurements.viewport}-moving-content-control-risk-${index + 1}`,
      category: "accessibility",
      severity: "low",
      confidence: "low",
      viewport: measurements.viewport,
      selector: sample.selector,
      region: sample.region,
      evidenceRefs,
      problem: `Moving or autoplaying content ${sample.selector} may not provide visible pause, stop, hide, or control affordances.`,
      recommendation: "Provide pause/stop/hide controls for moving content or avoid non-essential motion.",
      checkName: "moving-content-control-risk",
      observed: sample.text ? { text: sample.text, region: sample.region } : sample.region ?? sample.selector,
      expected: "Moving or autoplaying content has user controls."
    }));
  }

  assertFindingCoverageIntegrity(measurements.findingCoverage, measurements.viewport, findings);
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
    checkName: "render-failure",
    observed: input.problem,
    expected: "The page can be navigated and rendered before audit checks run."
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
  observed?: FindingObservation;
  expected?: FindingObservation;
  confidence?: Confidence;
}): Finding {
  const metadata = findingMetadataForCheck(input.checkName);
  return {
    ...input,
    ...metadata,
    confidence: input.confidence ?? metadata?.confidence ?? (input.checkName === "blank-render" || input.checkName === "render-failure" ? "high" : "medium")
  };
}

function isLikelyBlank(measurements: ViewportMeasurements): boolean {
  return measurements.textLength === 0 && measurements.meaningfulElementCount === 0;
}

function hasHorizontalOverflow(measurements: ViewportMeasurements): boolean {
  const widestDocument = Math.max(measurements.documentScrollWidth, measurements.bodyScrollWidth);
  return widestDocument > measurements.viewportWidth + 2;
}

function headingProblem(sample: HeadingIssueSample): string {
  switch (sample.issue) {
    case "empty-heading":
      return `Heading ${sample.selector} is empty.`;
    case "heading-level-skip":
      return `Heading ${sample.selector} jumps from level ${sample.previousLevel} to level ${sample.level}.`;
    case "duplicate-h1":
      return `Additional H1 ${sample.selector} may make the page top-level structure ambiguous.`;
  }
}

function checklistStateProblem(sample: ChecklistStateVisibilitySample): string {
  if (sample.reason === "inconsistent-checked-styles") {
    return `${sample.checkedCount} checked checklist items use inconsistent visual treatment, which may weaken completion-state meaning.`;
  }

  return "Checked and unchecked checklist items use very similar visual treatment, which may make progress state hard to scan.";
}

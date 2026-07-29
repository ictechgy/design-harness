import { describe, expect, it } from "vitest";
import {
  createRenderFailureFinding,
  findingsFromMeasurements,
  type FindingCoverage,
  type ViewportMeasurements
} from "./checks.js";
import { FINDING_COVERAGE_CHECK_NAMES } from "./finding-coverage.js";
import type {
  CompleteDensityTextClusterSummary,
  DensityComplexitySummary,
  PaletteDisciplineSummary,
  TypographyVariantSummary
} from "./visual-metrics.js";

const baseMeasurements: ViewportMeasurements = {
  viewport: "desktop",
  viewportWidth: 1440,
  viewportHeight: 900,
  documentScrollWidth: 1440,
  bodyScrollWidth: 1440,
  textLength: 120,
  meaningfulElementCount: 4,
  clippedText: [],
  contrastRisks: [],
  missingAccessibleNames: [],
  missingFormLabels: [],
  missingImageAlt: [],
  headingIssues: [],
  pageLangMissing: false,
  missingMainLandmark: false,
  repeatedLabels: [],
  repeatedVisualWeightRisks: [],
  saturatedColorNoiseRisks: [],
  checklistStateVisibilityRisks: [],
  fixedWidthRisks: [],
  stickyObstructionRisks: [],
  excessiveLineLength: [],
  koreanLineBreakRisks: [],
  tapTargetRisks: [],
  formErrorAssociationRisks: [],
  colorOnlyStateRisks: [],
  disabledWithoutExplanation: [],
  statusLiveRegionRisks: [],
  modalFocusRisks: [],
  customControlSemanticsRisks: [],
  movingContentControlRisks: [],
  textInventory: []
};

describe("findingsFromMeasurements", () => {
  it("flags a missing page lang declaration as a deterministic failure", () => {
    const findings = findingsFromMeasurements(
      { ...baseMeasurements, pageLangMissing: true },
      ["screenshot-desktop", "measurement-desktop"]
    );
    const finding = findings.find((candidate) => candidate.checkName === "page-lang-missing");
    expect(finding).toBeDefined();
    expect(finding?.criterionId).toBe("a11y.language.page-lang");
    expect(finding?.determinism).toBe("deterministic");
    expect(finding?.resultKind).toBe("failure");
    expect(findings.filter((candidate) => candidate.checkName === "page-lang-missing")).toHaveLength(1);
  });

  it("stays silent when the page declares a lang attribute", () => {
    const findings = findingsFromMeasurements(baseMeasurements, ["screenshot-desktop"]);
    expect(findings.some((candidate) => candidate.checkName === "page-lang-missing")).toBe(false);
  });

  it("emits bounded deterministic project-contract risks from font stack summaries", () => {
    const findings = findingsFromMeasurements({
      ...baseMeasurements,
      fontFamilyAdherence: {
        policyId: "font-family-adherence-v1",
        allowedFamilies: [
          { value: "Inter", kind: "named" },
          { value: "sans-serif", kind: "generic" }
        ],
        evaluatedElementCount: 3,
        ignoredElementCount: 1,
        violatingElementCount: 2,
        distinctViolationStackCount: 1,
        emittedStackCount: 1,
        truncated: false,
        stacks: [{
          rawStack: '"Other", sans-serif',
          unexpectedFamilies: [{ value: "Other", kind: "named" }],
          affectedElementCount: 2,
          selectors: ["#first", "#second"],
          regions: [
            { x: 10, y: 20, width: 200, height: 24 },
            { x: 10, y: 50, width: 200, height: 24 }
          ]
        }]
      }
    }, ["measurement-desktop", "text-inventory-desktop"]);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      id: "finding-desktop-unapproved-font-family-1",
      checkName: "unapproved-font-family",
      criterionId: "visual.font-family.project-contract",
      severity: "low",
      confidence: "high",
      determinism: "deterministic",
      resultKind: "risk",
      humanReviewRecommended: false,
      selector: "#first",
      evidenceRefs: ["measurement-desktop", "text-inventory-desktop"]
    });
    expect(findings[0]?.problem).toContain("computed font-family list");
    expect(findings[0]?.problem).not.toMatch(/rendered with|font face|uses an actual/iu);
    expect(findings[0]?.recommendation).toContain("audit.fontFamily.additionalAllowedFamilies");
    expect(findings[0]?.recommendation).toContain("third-party content");
  });

  it("emits bounded deterministic project-contract risks from off-palette groups", () => {
    const findings = findingsFromMeasurements({
      ...baseMeasurements,
      colorAdherence: {
        policyId: "color-adherence-v1",
        allowedColors: [
          { red: 20, green: 20, blue: 26, alpha: 255 },
          { red: 255, green: 255, blue: 255, alpha: 255 }
        ],
        candidateSlotCount: 5,
        evaluatedSlotCount: 3,
        ignoredSlotCount: 1,
        ignoredByReason: { "selector-exception": 1 },
        skippedSlotCount: 1,
        skippedByReason: { "unsupported-color": 1 },
        violatingSlotCount: 2,
        distinctViolationGroupCount: 1,
        emittedGroupCount: 1,
        truncatedGroupCount: 0,
        groups: [{
          property: "border-right-color",
          unexpectedColor: { red: 192, green: 38, blue: 211, alpha: 255 },
          rawComputedValues: ["rgb(192, 38, 211)"],
          affectedSlotCount: 2,
          selectors: ["#first", "#second"],
          regions: [
            { x: 10, y: 20, width: 200, height: 24 },
            { x: 10, y: 50, width: 200, height: 24 }
          ],
          sampleCount: 2,
          omittedSampleCount: 0
        }]
      }
    }, ["measurement-desktop"]);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      id: "finding-desktop-off-palette-color-1",
      checkName: "off-palette-color",
      criterionId: "visual.color.project-contract",
      category: "visual-polish",
      severity: "low",
      confidence: "high",
      determinism: "deterministic",
      resultKind: "risk",
      humanReviewRecommended: false,
      selector: "#first",
      evidenceRefs: ["measurement-desktop"]
    });
    expect(findings[0]?.problem).toContain("rendered border-right-color value");
    expect(findings[0]?.problem).not.toMatch(/good design|uses? (a )?token in (the )?source/iu);
    expect(findings[0]?.recommendation).toContain("audit.color.ignoreSelectors");
  });

  it("emits bounded deterministic project-contract risks from off-scale spacing groups", () => {
    const findings = findingsFromMeasurements({
      ...baseMeasurements,
      spacingAdherence: {
        policyId: "spacing-adherence-v1",
        allowedValuesPx: [4, 8, 16, 24],
        rootFontSizePx: 16,
        candidateSlotCount: 12,
        evaluatedSlotCount: 10,
        ignoredSlotCount: 1,
        ignoredByReason: { "selector-exception": 1 },
        skippedSlotCount: 1,
        skippedByReason: { "auto-margin": 1 },
        violatingSlotCount: 2,
        distinctViolationGroupCount: 1,
        emittedGroupCount: 1,
        truncatedGroupCount: 0,
        groups: [{
          property: "margin-right",
          unexpectedValuePx: 12,
          affectedSlotCount: 2,
          selectors: ["#first", "#second"],
          regions: [
            { x: 10, y: 20, width: 200, height: 24 },
            { x: 10, y: 50, width: 200, height: 24 }
          ],
          sampleCount: 2,
          omittedSampleCount: 0
        }]
      }
    }, ["measurement-desktop"]);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      id: "finding-desktop-off-scale-spacing-1",
      checkName: "off-scale-spacing",
      criterionId: "visual.spacing.project-contract",
      category: "visual-polish",
      severity: "low",
      confidence: "high",
      determinism: "deterministic",
      resultKind: "risk",
      humanReviewRecommended: false,
      selector: "#first",
      evidenceRefs: ["measurement-desktop"]
    });
    expect(findings[0]?.problem).toContain("rendered margin-right value");
    expect(findings[0]?.problem).not.toMatch(/good design|uses? (a )?token in (the )?source/iu);
    expect(findings[0]?.recommendation).toContain("audit.spacing.ignoreSelectors");
  });

  it("emits one low-confidence heuristic risk for a sound typography lower-bound overage", () => {
    const summary = typographyVariantSummary();
    const findings = findingsFromMeasurements({
      ...baseMeasurements,
      typographyVariants: summary,
      findingCoverage: coverageFor("desktop")
    }, ["measurement-desktop"]);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      id: "finding-desktop-typography-variant-count-budget",
      checkName: "typography-variant-count-budget",
      criterionId: "typography.variant-count.budget",
      category: "visual-polish",
      severity: "low",
      confidence: "low",
      determinism: "heuristic",
      resultKind: "risk",
      humanReviewRecommended: true,
      evidenceRefs: ["measurement-desktop"]
    });
    expect(findings[0]?.problem).toContain("explicit project-configured maximum");
    expect(findings[0]?.problem).toContain("heuristic budget signal");
    expect(findings[0]?.problem).not.toMatch(/bad design|failure|universally correct/iu);
    expect(findings[0]?.observed).toMatchObject({
      policyId: "typography-variant-budget-v1",
      methodId: "rendered-typography-variants-v1",
      maxDistinctVariants: 1,
      coverage: "lower-bound",
      distinctVariantCount: 2,
      skippedByReason: { "font-family-too-long": 1 },
      emittedVariantCount: 2,
      omittedVariantCount: 0,
      variants: summary.variants,
      overages: [{
        component: "distinctVariantCount",
        observedCount: 2,
        configuredMaximum: 1,
        excess: 1,
        coverage: "lower-bound"
      }]
    });
  });

  it("combines both palette component overages into one advisory finding", () => {
    const summary = paletteDisciplineSummary();
    const findings = findingsFromMeasurements({
      ...baseMeasurements,
      paletteDiscipline: summary
    }, ["measurement-desktop"]);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      id: "finding-desktop-palette-count-discipline",
      checkName: "palette-count-discipline",
      criterionId: "color.palette.count-discipline",
      category: "visual-polish",
      severity: "low",
      confidence: "low",
      determinism: "heuristic",
      resultKind: "risk",
      humanReviewRecommended: true
    });
    expect(findings[0]?.observed).toMatchObject({
      policyId: "palette-discipline-budget-v1",
      methodId: "rendered-rgba8-oklch-cover30-v1",
      maxDistinctColors: 1,
      maxChromaticHueFamilies: 1,
      coverage: "complete",
      distinctColorCount: 2,
      hueFamilyCount: 2,
      colors: summary.colors,
      hueFamilyStarts: summary.hueFamilyStarts,
      overages: [{
        component: "distinctColorCount",
        observedCount: 2,
        configuredMaximum: 1,
        excess: 1,
        coverage: "complete"
      }, {
        component: "hueFamilyCount",
        observedCount: 2,
        configuredMaximum: 1,
        excess: 1,
        coverage: "complete"
      }]
    });
  });

  it("keeps a non-exceeding text-cluster lower bound out of a combined density overage", () => {
    const summary = densityComplexitySummary();
    const findings = findingsFromMeasurements({
      ...baseMeasurements,
      densityComplexity: summary
    }, ["measurement-desktop"]);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      id: "finding-desktop-density-complexity-budget",
      checkName: "density-complexity-budget",
      criterionId: "layout.density.complexity-budget",
      category: "layout",
      severity: "low",
      confidence: "low",
      determinism: "heuristic",
      resultKind: "risk",
      humanReviewRecommended: true
    });
    expect(findings[0]?.observed).toMatchObject({
      policyId: "density-complexity-budget-v1",
      methodId: "viewport-dom-density-v1",
      visibleElementMethodId: "visible-content-elements-v1",
      textClusterMethodId: "text-flow-connectivity-v1",
      maxVisibleElements: 1,
      maxTextClusters: 1,
      visibleElements: {
        coverage: "lower-bound",
        visibleElementCount: 2,
        skippedByReason: { "unsupported-clip-or-mask": 1 },
        samples: summary.visibleElements?.samples,
        omittedSampleCount: 0
      },
      textClusters: {
        coverage: "lower-bound",
        lowerBoundMethodId: "supported-flow-root-count-v1",
        textClusterCount: 1,
        skippedByReason: { "unsupported-clip-or-mask": 1 },
        samples: [],
        omittedSampleCount: 1
      },
      overages: [{
        component: "visibleElementCount",
        observedCount: 2,
        configuredMaximum: 1,
        excess: 1,
        coverage: "lower-bound"
      }]
    });
  });

  it("combines sound visible-element and text-cluster lower-bound overages", () => {
    const summary = densityComplexitySummary({
      textClusters: {
        ...densityComplexitySummary().textClusters!,
        textNodeUniverseCount: 3,
        evaluatedTextNodeCount: 2,
        textFragmentCount: 2,
        textClusterCount: 2,
        omittedSampleCount: 2
      }
    });
    const findings = findingsFromMeasurements({
      ...baseMeasurements,
      densityComplexity: summary
    }, ["measurement-desktop"]);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      checkName: "density-complexity-budget",
      determinism: "heuristic",
      resultKind: "risk",
      severity: "low",
      confidence: "low",
      observed: {
        overages: [{
          component: "visibleElementCount",
          observedCount: 2,
          configuredMaximum: 1,
          excess: 1,
          coverage: "lower-bound"
        }, {
          component: "textClusterCount",
          observedCount: 2,
          configuredMaximum: 1,
          excess: 1,
          coverage: "lower-bound"
        }]
      }
    });
  });

  it("combines sound visible-element and complete text-cluster overages into one density finding", () => {
    const summary = densityComplexitySummary({
      textClusters: completeDensityTextClusterSummary()
    });
    const findings = findingsFromMeasurements({
      ...baseMeasurements,
      densityComplexity: summary
    }, ["measurement-desktop"]);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.checkName).toBe("density-complexity-budget");
    expect(findings[0]?.observed).toMatchObject({
      textClusters: {
        coverage: "complete",
        textClusterCount: 2,
        edgeTestCount: 1,
        samples: summary.textClusters?.samples,
        omittedSampleCount: 0
      },
      overages: [{
        component: "visibleElementCount",
        observedCount: 2,
        configuredMaximum: 1,
        excess: 1,
        coverage: "lower-bound"
      }, {
        component: "textClusterCount",
        observedCount: 2,
        configuredMaximum: 1,
        excess: 1,
        coverage: "complete"
      }]
    });
  });

  it("emits no budget finding for equality, a non-exceeding lower bound, or absent summaries", () => {
    const equalityFindings = findingsFromMeasurements({
      ...baseMeasurements,
      typographyVariants: typographyVariantSummary({ maxDistinctVariants: 2 }),
      paletteDiscipline: paletteDisciplineSummary({
        maxDistinctColors: 2,
        maxChromaticHueFamilies: 2
      }),
      densityComplexity: densityComplexitySummary({
        maxVisibleElements: 2,
        maxTextClusters: 2,
        visibleElements: {
          ...densityComplexitySummary().visibleElements!,
          maxVisibleElements: 2
        },
        textClusters: completeDensityTextClusterSummary({ maxTextClusters: 2 })
      })
    }, ["measurement-desktop"]);
    const nonExceedingLowerBound = findingsFromMeasurements({
      ...baseMeasurements,
      typographyVariants: typographyVariantSummary({ maxDistinctVariants: 3 })
    }, ["measurement-desktop"]);
    const absentSummaries = findingsFromMeasurements(baseMeasurements, ["measurement-desktop"]);

    expect(equalityFindings).toEqual([]);
    expect(nonExceedingLowerBound).toEqual([]);
    expect(absentSummaries).toEqual([]);
  });

  it("does not treat equality on a partial text-cluster lower bound as a pass or overage", () => {
    const summary = densityComplexitySummary();
    const findings = findingsFromMeasurements({
      ...baseMeasurements,
      densityComplexity: {
        ...summary,
        maxVisibleElements: undefined,
        visibleElements: undefined
      }
    }, ["measurement-desktop"]);

    expect(findings).toEqual([]);
  });

  it("detects likely blank renders", () => {
    const findings = findingsFromMeasurements(
      {
        ...baseMeasurements,
        textLength: 0,
        meaningfulElementCount: 0,
        missingMainLandmark: true,
        paletteDiscipline: paletteDisciplineSummary()
      },
      ["screenshot-desktop", "measurement-desktop"]
    );
    expect(findings.some((finding) => finding.checkName === "blank-render")).toBe(true);
    expect(findings).toHaveLength(1);
  });

  it("detects horizontal overflow", () => {
    const findings = findingsFromMeasurements(
      { ...baseMeasurements, documentScrollWidth: 1500 },
      ["screenshot-desktop", "measurement-desktop"]
    );
    expect(findings.some((finding) => finding.checkName === "horizontal-overflow")).toBe(true);
  });

  it("limits clipping and contrast samples", () => {
    const clippedText = Array.from({ length: 8 }, (_, index) => ({ selector: `.clip-${index}` }));
    const contrastRisks = Array.from({ length: 8 }, (_, index) => ({
      selector: `.contrast-${index}`,
      ratio: 2,
      requiredRatio: 4.5,
      color: "rgb(120, 120, 120)",
      backgroundColor: "rgb(255, 255, 255)"
    }));
    const findings = findingsFromMeasurements(
      { ...baseMeasurements, clippedText, contrastRisks },
      ["screenshot-desktop", "measurement-desktop"]
    );
    expect(findings.filter((finding) => finding.checkName === "text-clipping")).toHaveLength(5);
    expect(findings.filter((finding) => finding.checkName === "dom-contrast-risk")).toHaveLength(5);
  });

  it("creates render-failure findings with evidence", () => {
    const finding = createRenderFailureFinding({
      id: "finding-desktop-render-failure",
      viewport: "desktop",
      evidenceRefs: ["navigation-error-desktop"],
      problem: "Navigation failed."
    });
    expect(finding.severity).toBe("critical");
    expect(finding.confidence).toBe("high");
    expect(finding.evidenceRefs).toEqual(["navigation-error-desktop"]);
  });

  it("emits semantic accessibility and hierarchy risks", () => {
    const findings = findingsFromMeasurements(
      {
        ...baseMeasurements,
        missingAccessibleNames: [{ selector: "button.icon" }],
        missingFormLabels: [{ selector: "#email" }],
        missingImageAlt: [{ selector: "img.hero" }],
        headingIssues: [{ selector: "h3", level: 3, previousLevel: 1, issue: "heading-level-skip" }],
        missingMainLandmark: true,
        repeatedLabels: [{ label: "view", count: 3, selectors: ["button:nth-of-type(1)", "button:nth-of-type(2)", "button:nth-of-type(3)"] }]
      },
      ["screenshot-desktop", "measurement-desktop"]
    );

    expect(findings.map((finding) => finding.checkName)).toEqual(expect.arrayContaining([
      "missing-accessible-name",
      "missing-form-label",
      "missing-image-alt",
      "heading-level-skip",
      "missing-main-landmark",
      "ambiguous-repeated-label"
    ]));
    expect(findings.find((finding) => finding.checkName === "ambiguous-repeated-label")).toMatchObject({
      determinism: "heuristic",
      resultKind: "needs-review",
      confidence: "low",
      humanReviewRecommended: true
    });
  });

  it("emits responsive readability and target-size risks with low-confidence heuristics", () => {
    const findings = findingsFromMeasurements(
      {
        ...baseMeasurements,
        fixedWidthRisks: [{ selector: ".wide-panel", region: { x: 0, y: 0, width: 390, height: 200 } }],
        stickyObstructionRisks: [{ selector: ".sticky-banner", region: { x: 0, y: 0, width: 390, height: 220 } }],
        excessiveLineLength: [{ selector: "p.lede", estimatedCharactersPerLine: 112, region: { x: 0, y: 0, width: 900, height: 160 } }],
        tapTargetRisks: [{ selector: "button.tiny", region: { x: 12, y: 12, width: 18, height: 18 } }]
      },
      ["screenshot-desktop", "measurement-desktop"]
    );

    expect(findings.map((finding) => finding.checkName)).toEqual(expect.arrayContaining([
      "fixed-width-risk",
      "sticky-obstruction-risk",
      "excessive-line-length",
      "tap-target-risk"
    ]));
    expect(findings.find((finding) => finding.checkName === "fixed-width-risk")).toMatchObject({
      determinism: "heuristic",
      confidence: "low",
      resultKind: "risk",
      humanReviewRecommended: true
    });
    expect(findings.find((finding) => finding.checkName === "tap-target-risk")).toMatchObject({
      determinism: "deterministic",
      resultKind: "risk"
    });
  });

  it("reports Korean text that breaks inside words, at deterministic risk", () => {
    const findings = findingsFromMeasurements(
      {
        ...baseMeasurements,
        koreanLineBreakRisks: [{
          selector: "main > p",
          wordBreak: "break-all",
          region: { x: 0, y: 0, width: 544, height: 96 }
        }]
      },
      ["screenshot-desktop", "measurement-desktop"]
    );

    const finding = findings.find((entry) => entry.checkName === "korean-line-break-risk");
    expect(finding).toMatchObject({
      category: "content",
      criterionId: "content.korean-line-break.word-break",
      determinism: "deterministic",
      resultKind: "risk",
      confidence: "high",
      severity: "medium",
      selector: "main > p",
      observed: { wordBreak: "break-all" }
    });
    // The remediation has to name keep-all, otherwise the finding states a problem
    // without the one property value that resolves it.
    expect(finding?.recommendation).toContain("keep-all");
  });

  it("stays silent when no Korean block computes character-level breaking", () => {
    const findings = findingsFromMeasurements(
      { ...baseMeasurements, koreanLineBreakRisks: [] },
      ["screenshot-desktop", "measurement-desktop"]
    );

    expect(findings.some((entry) => entry.checkName === "korean-line-break-risk")).toBe(false);
  });

  it("emits reference-derived hierarchy review prompts for repeated visual weight", () => {
    const findings = findingsFromMeasurements(
      {
        ...baseMeasurements,
        repeatedVisualWeightRisks: [{
          count: 6,
          selectors: [".card-1", ".card-2", ".card-3", ".card-4", ".card-5", ".card-6"],
          averageArea: 27_500,
          areaVariation: 0.04
        }]
      },
      ["screenshot-desktop", "measurement-desktop"]
    );

    expect(findings.find((finding) => finding.checkName === "repeated-visual-weight-risk")).toMatchObject({
      criterionId: "hierarchy.visual-weight.priority-risk",
      determinism: "heuristic",
      resultKind: "needs-review",
      confidence: "low",
      humanReviewRecommended: true
    });
  });

  it("emits reference-derived color and checklist state review prompts", () => {
    const findings = findingsFromMeasurements(
      {
        ...baseMeasurements,
        saturatedColorNoiseRisks: [{
          count: 9,
          hueBucketCount: 5,
          hueBuckets: [0, 60, 120, 210, 300],
          selectors: [".red", ".yellow", ".green", ".blue", ".purple"]
        }],
        checklistStateVisibilityRisks: [{
          reason: "inconsistent-checked-styles",
          checkedCount: 4,
          uncheckedCount: 2,
          selectors: [".step-1", ".step-2", ".step-3", ".step-4"]
        }]
      },
      ["screenshot-desktop", "measurement-desktop"]
    );

    expect(findings.find((finding) => finding.checkName === "saturated-color-noise-risk")).toMatchObject({
      criterionId: "color.hierarchy.saturation-discipline",
      determinism: "heuristic",
      resultKind: "needs-review",
      confidence: "low",
      humanReviewRecommended: true
    });
    expect(findings.find((finding) => finding.checkName === "checklist-state-visibility-risk")).toMatchObject({
      criterionId: "state.checklist.activation-visibility",
      determinism: "heuristic",
      resultKind: "needs-review",
      confidence: "low",
      humanReviewRecommended: true
    });
  });

  it("emits interaction state and feedback risks", () => {
    const findings = findingsFromMeasurements(
      {
        ...baseMeasurements,
        formErrorAssociationRisks: [{ selector: "#email", region: { x: 0, y: 0, width: 240, height: 36 } }],
        colorOnlyStateRisks: [{ selector: ".error-dot", region: { x: 10, y: 10, width: 10, height: 10 } }],
        disabledWithoutExplanation: [{ selector: "button[disabled]", text: "Save" }],
        statusLiveRegionRisks: [{ selector: ".toast", text: "Saving" }],
        modalFocusRisks: [{ selector: "[role=\"dialog\"]", text: "Confirm" }],
        customControlSemanticsRisks: [{ selector: ".fake-button", text: "Open" }],
        movingContentControlRisks: [{ selector: ".ticker", text: "News" }]
      },
      ["screenshot-desktop", "measurement-desktop"]
    );

    expect(findings.map((finding) => finding.checkName)).toEqual(expect.arrayContaining([
      "form-error-association-risk",
      "color-only-state-risk",
      "disabled-without-explanation",
      "status-live-region-risk",
      "modal-focus-risk",
      "custom-control-semantics-risk",
      "moving-content-control-risk"
    ]));
    expect(findings.find((finding) => finding.checkName === "disabled-without-explanation")).toMatchObject({
      determinism: "heuristic",
      resultKind: "needs-review",
      confidence: "low",
      humanReviewRecommended: true
    });
  });

  it("retains the five-sample defensive cap while validating exact pre-cap coverage", () => {
    const findings = findingsFromMeasurements({
      ...baseMeasurements,
      clippedText: Array.from({ length: 7 }, (_, index) => ({ selector: `.clipped-${index}` })),
      missingAccessibleNames: Array.from({ length: 6 }, (_, index) => ({ selector: `.unnamed-${index}` })),
      findingCoverage: coverageFor("desktop", {
        "text-clipping": { detectedCount: 7, emittedCount: 5 },
        "missing-accessible-name": { detectedCount: 6, emittedCount: 5 }
      })
    }, ["measurement-desktop"]);

    expect(findings.filter(({ checkName }) => checkName === "text-clipping")).toHaveLength(5);
    expect(findings.filter(({ checkName }) => checkName === "missing-accessible-name")).toHaveLength(5);
  });

  it("validates per-check heading counts against one shared five-finding cap", () => {
    const headingIssues = [
      { selector: "#empty-1", level: 2, issue: "empty-heading" as const },
      { selector: "#skip-1", level: 3, previousLevel: 1, issue: "heading-level-skip" as const },
      { selector: "#duplicate-1", level: 1, issue: "duplicate-h1" as const },
      { selector: "#empty-2", level: 2, issue: "empty-heading" as const },
      { selector: "#skip-2", level: 4, previousLevel: 2, issue: "heading-level-skip" as const },
      { selector: "#duplicate-2", level: 1, issue: "duplicate-h1" as const }
    ];
    const findings = findingsFromMeasurements({
      ...baseMeasurements,
      headingIssues,
      findingCoverage: coverageFor("desktop", {
        "empty-heading": { detectedCount: 2, emittedCount: 2 },
        "heading-level-skip": { detectedCount: 2, emittedCount: 2 },
        "duplicate-h1": { detectedCount: 2, emittedCount: 1 }
      })
    }, ["measurement-desktop"]);

    expect(findings.map(({ checkName }) => checkName)).toEqual([
      "empty-heading",
      "heading-level-skip",
      "duplicate-h1",
      "empty-heading",
      "heading-level-skip"
    ]);
  });

  it("freezes the unreachable aggregate detectors at their current maximum output shape", () => {
    const findings = findingsFromMeasurements({
      ...baseMeasurements,
      repeatedVisualWeightRisks: [{
        count: 4,
        selectors: [".panel-1", ".panel-2", ".panel-3", ".panel-4"],
        averageArea: 20_000,
        areaVariation: 0.05
      }],
      saturatedColorNoiseRisks: [{
        count: 5,
        hueBucketCount: 3,
        hueBuckets: [0, 120, 240],
        selectors: [".red", ".green", ".blue"]
      }],
      checklistStateVisibilityRisks: [{
        reason: "inconsistent-checked-styles",
        checkedCount: 2,
        uncheckedCount: 2,
        selectors: [".one", ".two"]
      }, {
        reason: "checked-unchecked-styles-too-similar",
        checkedCount: 2,
        uncheckedCount: 2,
        selectors: [".three", ".four"]
      }],
      findingCoverage: coverageFor("desktop")
    }, ["measurement-desktop"]);

    expect(countFindings(findings)).toMatchObject({
      "repeated-visual-weight-risk": 1,
      "saturated-color-noise-risk": 1,
      "checklist-state-visibility-risk": 2
    });
  });
});

function coverageFor(
  viewport: string,
  counts: Partial<Record<string, { detectedCount: number; emittedCount: number }>> = {}
): FindingCoverage {
  return {
    viewport,
    entries: FINDING_COVERAGE_CHECK_NAMES.map((checkName) => {
      const count = counts[checkName] ?? { detectedCount: 0, emittedCount: 0 };
      return {
        checkName,
        ...(checkName === "empty-heading" || checkName === "heading-level-skip" || checkName === "duplicate-h1"
          ? { capGroup: "headingIssues" }
          : {}),
        detectedCount: count.detectedCount,
        emittedCount: count.emittedCount,
        omittedCount: count.detectedCount - count.emittedCount,
        limit: 5
      };
    })
  };
}

function countFindings(findings: Array<{ checkName: string }>): Record<string, number> {
  return Object.fromEntries(
    [...new Set(findings.map(({ checkName }) => checkName))]
      .map((checkName) => [checkName, findings.filter((finding) => finding.checkName === checkName).length])
  );
}

function typographyVariantSummary(
  overrides: Partial<TypographyVariantSummary> = {}
): TypographyVariantSummary {
  const firstTuple = {
    families: ["named\u0000inter", "generic\u0000sans-serif"],
    sizeMilliPx: 16_000,
    weightMilli: 400_000,
    style: "normal" as const
  };
  const secondTuple = {
    families: ["named\u0000inter", "generic\u0000sans-serif"],
    sizeMilliPx: 24_000,
    weightMilli: 700_000,
    style: "normal" as const
  };

  return {
    policyId: "typography-variant-budget-v1",
    methodId: "rendered-typography-variants-v1",
    maxDistinctVariants: 1,
    coverage: "lower-bound",
    candidateElementCount: 3,
    collectedElementCount: 2,
    evaluatedElementCount: 2,
    ignoredElementCount: 0,
    skippedElementCount: 1,
    skippedByReason: { "font-family-too-long": 1 },
    distinctVariantCount: 2,
    emittedVariantCount: 2,
    omittedVariantCount: 0,
    variants: [{
      identity: JSON.stringify(firstTuple),
      tuple: firstTuple,
      affectedElementCount: 1,
      emittedLocationCount: 1,
      omittedLocationCount: 0,
      locations: [{
        selector: "h1",
        region: { x: 24, y: 24, width: 320, height: 40 }
      }]
    }, {
      identity: JSON.stringify(secondTuple),
      tuple: secondTuple,
      affectedElementCount: 1,
      emittedLocationCount: 1,
      omittedLocationCount: 0,
      locations: [{
        selector: "p",
        region: { x: 24, y: 80, width: 480, height: 24 }
      }]
    }],
    ...overrides
  };
}

function paletteDisciplineSummary(
  overrides: Partial<PaletteDisciplineSummary> = {}
): PaletteDisciplineSummary {
  return {
    policyId: "palette-discipline-budget-v1",
    methodId: "rendered-rgba8-oklch-cover30-v1",
    maxDistinctColors: 1,
    maxChromaticHueFamilies: 1,
    coverage: "complete",
    candidateSlotCount: 2,
    collectedSlotCount: 2,
    evaluatedSlotCount: 2,
    ignoredSlotCount: 0,
    ignoredByReason: {},
    skippedSlotCount: 0,
    skippedByReason: {},
    distinctColorCount: 2,
    emittedColorCount: 2,
    omittedColorCount: 0,
    colors: [{
      identity: "255,0,0,255",
      color: { red: 255, green: 0, blue: 0, alpha: 255 },
      occurrenceCount: 1,
      emittedLocationCount: 1,
      omittedLocationCount: 0,
      locations: [{
        selector: ".alert",
        property: "color",
        region: { x: 24, y: 24, width: 160, height: 24 }
      }]
    }, {
      identity: "0,0,255,255",
      color: { red: 0, green: 0, blue: 255, alpha: 255 },
      occurrenceCount: 1,
      emittedLocationCount: 1,
      omittedLocationCount: 0,
      locations: [{
        selector: ".link",
        property: "color",
        region: { x: 24, y: 64, width: 160, height: 24 }
      }]
    }],
    hueFamilyCount: 2,
    hueFamilyStarts: [0, 180_000_000],
    ...overrides
  };
}

function densityComplexitySummary(
  overrides: Partial<DensityComplexitySummary> = {}
): DensityComplexitySummary {
  return {
    policyId: "density-complexity-budget-v1",
    methodId: "viewport-dom-density-v1",
    visibleElementMethodId: "visible-content-elements-v1",
    textClusterMethodId: "text-flow-connectivity-v1",
    maxVisibleElements: 1,
    maxTextClusters: 1,
    visibleElements: {
      methodId: "visible-content-elements-v1",
      maxVisibleElements: 1,
      coverage: "lower-bound",
      elementUniverseCount: 3,
      visibleElementCount: 2,
      ignoredElementCount: 0,
      ineligibleElementCount: 0,
      skippedElementCount: 1,
      skippedByReason: { "unsupported-clip-or-mask": 1 },
      emittedSampleCount: 2,
      omittedSampleCount: 0,
      samples: [{
        selector: "button",
        region: { x: 24, y: 24, width: 120, height: 40 }
      }, {
        selector: "p",
        region: { x: 24, y: 80, width: 320, height: 48 }
      }]
    },
    textClusters: {
      methodId: "text-flow-connectivity-v1",
      maxTextClusters: 1,
      coverage: "lower-bound",
      lowerBoundMethodId: "supported-flow-root-count-v1",
      textNodeUniverseCount: 2,
      ignoredTextNodeCount: 0,
      ineligibleTextNodeCount: 0,
      skippedTextNodeCount: 1,
      evaluatedTextNodeCount: 1,
      skippedByReason: { "unsupported-clip-or-mask": 1 },
      textFragmentCount: 1,
      textClusterCount: 1,
      edgeTestCount: null,
      emittedSampleCount: 0,
      omittedSampleCount: 1,
      samples: []
    },
    ...overrides
  };
}

function completeDensityTextClusterSummary(
  overrides: Partial<CompleteDensityTextClusterSummary> = {}
): CompleteDensityTextClusterSummary {
  return {
    methodId: "text-flow-connectivity-v1",
    maxTextClusters: 1,
    coverage: "complete",
    textNodeUniverseCount: 2,
    ignoredTextNodeCount: 0,
    ineligibleTextNodeCount: 0,
    skippedTextNodeCount: 0,
    evaluatedTextNodeCount: 2,
    skippedByReason: {},
    textFragmentCount: 2,
    textClusterCount: 2,
    edgeTestCount: 1,
    emittedSampleCount: 2,
    omittedSampleCount: 0,
    samples: [{
      selector: "h1",
      region: { x: 24, y: 24, width: 320, height: 40 },
      fragmentCount: 1
    }, {
      selector: "p",
      region: { x: 24, y: 80, width: 480, height: 48 },
      fragmentCount: 1
    }],
    ...overrides
  };
}

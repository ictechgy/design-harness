import { describe, expect, it } from "vitest";
import { createRenderFailureFinding, findingsFromMeasurements, type ViewportMeasurements } from "./checks.js";

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


  it("detects likely blank renders", () => {
    const findings = findingsFromMeasurements(
      { ...baseMeasurements, textLength: 0, meaningfulElementCount: 0, missingMainLandmark: true },
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
});

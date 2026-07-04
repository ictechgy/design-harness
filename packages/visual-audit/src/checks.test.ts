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
  missingMainLandmark: false,
  repeatedLabels: [],
  fixedWidthRisks: [],
  stickyObstructionRisks: [],
  excessiveLineLength: [],
  tapTargetRisks: []
};

describe("findingsFromMeasurements", () => {
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
});

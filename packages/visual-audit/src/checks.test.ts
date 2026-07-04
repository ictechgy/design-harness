import { describe, expect, it } from "vitest";
import { findingsFromMeasurements, type ViewportMeasurements } from "./checks.js";

const baseMeasurements: ViewportMeasurements = {
  viewport: "desktop",
  viewportWidth: 1440,
  viewportHeight: 900,
  documentScrollWidth: 1440,
  bodyScrollWidth: 1440,
  textLength: 120,
  meaningfulElementCount: 4,
  clippedText: [],
  contrastRisks: []
};

describe("findingsFromMeasurements", () => {
  it("detects likely blank renders", () => {
    const findings = findingsFromMeasurements(
      { ...baseMeasurements, textLength: 0, meaningfulElementCount: 0 },
      "screenshot-desktop",
      "measurement-desktop"
    );
    expect(findings.some((finding) => finding.checkName === "blank-render")).toBe(true);
  });

  it("detects horizontal overflow", () => {
    const findings = findingsFromMeasurements(
      { ...baseMeasurements, documentScrollWidth: 1500 },
      "screenshot-desktop",
      "measurement-desktop"
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
      "screenshot-desktop",
      "measurement-desktop"
    );
    expect(findings.filter((finding) => finding.checkName === "text-clipping")).toHaveLength(5);
    expect(findings.filter((finding) => finding.checkName === "dom-contrast-risk")).toHaveLength(5);
  });
});

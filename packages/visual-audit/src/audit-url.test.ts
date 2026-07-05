import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { assertAuditResultIntegrity, type ViewportPreset } from "@design-harness/core";
import { auditUrl, BrowserUnavailableError, type BrowserHandle, type PageHandle } from "./index.js";
import type { ViewportMeasurements } from "./checks.js";

const viewport: ViewportPreset = {
  name: "desktop",
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
  isMobile: false
};

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((tempDir) => rm(tempDir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("auditUrl failure behavior", () => {
  it("throws actionable browser unavailable errors", async () => {
    await expect(
      auditUrl({
        url: "http://localhost:3000",
        outDir: await tempDir(),
        viewportPresets: [viewport],
        launchBrowser: async () => {
          throw new Error("missing browser");
        }
      })
    ).rejects.toThrow(BrowserUnavailableError);
  });

  it("records navigation failures as partial render-failure findings", async () => {
    const result = await auditUrl({
      url: "http://localhost:3000",
      outDir: await tempDir(),
      viewportPresets: [viewport],
      launchBrowser: async () =>
        fakeBrowser({
          gotoError: new Error("connection refused"),
          measurement: measurementFor("desktop")
        })
    });

    expect(result.auditResult.status).toBe("partial");
    expect(result.auditResult.failedChecks).toContain("desktop:page-timeout-or-navigation");
    expect(result.auditResult.findings.some((finding) => finding.checkName === "render-failure")).toBe(true);
    expect(() => assertAuditResultIntegrity(result.auditResult)).not.toThrow();
  });

  it("keeps finding evidence refs valid when screenshots fail", async () => {
    const result = await auditUrl({
      url: "http://localhost:3000",
      outDir: await tempDir(),
      viewportPresets: [viewport],
      launchBrowser: async () =>
        fakeBrowser({
          screenshotError: new Error("screenshot failed"),
          measurement: {
            ...measurementFor("desktop"),
            documentScrollWidth: 1500
          }
        })
    });

    const evidenceIds = new Set(result.auditResult.evidenceAssets.map((asset) => asset.id));
    expect(result.auditResult.status).toBe("partial");
    expect(result.auditResult.findings.some((finding) => finding.checkName === "horizontal-overflow")).toBe(true);
    for (const finding of result.auditResult.findings) {
      expect(finding.evidenceRefs.every((ref) => evidenceIds.has(ref))).toBe(true);
    }
    expect(() => assertAuditResultIntegrity(result.auditResult)).not.toThrow();
  });
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "design-harness-audit-"));
  tempDirs.push(dir);
  return dir;
}

function fakeBrowser(options: {
  gotoError?: Error;
  screenshotError?: Error;
  measurement: ViewportMeasurements;
}): BrowserHandle {
  return {
    version: () => "fake-browser",
    newPage: async () => fakePage(options),
    close: async () => undefined
  };
}

function fakePage(options: {
  gotoError?: Error;
  screenshotError?: Error;
  measurement: ViewportMeasurements;
}): PageHandle {
  return {
    setDefaultTimeout: () => undefined,
    setDefaultNavigationTimeout: () => undefined,
    goto: async () => {
      if (options.gotoError) {
        throw options.gotoError;
      }
      return {
        status: () => 200,
        statusText: () => "OK"
      };
    },
    evaluate: async (_pageFunction, arg) => {
      if (arg !== undefined) {
        return undefined as never;
      }
      return options.measurement as never;
    },
    screenshot: async () => {
      if (options.screenshotError) {
        throw options.screenshotError;
      }
      return undefined;
    },
    close: async () => undefined
  };
}

function measurementFor(name: string): ViewportMeasurements {
  return {
    viewport: name,
    viewportWidth: 1440,
    viewportHeight: 900,
    documentScrollWidth: 1440,
    bodyScrollWidth: 1440,
    textLength: 120,
    meaningfulElementCount: 8,
    clippedText: [],
    contrastRisks: [],
    missingAccessibleNames: [],
    missingFormLabels: [],
    missingImageAlt: [],
    headingIssues: [],
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
    movingContentControlRisks: []
  };
}

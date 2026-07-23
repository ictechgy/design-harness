import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { errors } from "playwright";
import {
  SCHEMA_VERSION,
  assertAuditResultIntegrity,
  type AuditNotice,
  type CopyStyle,
  type FontFamilyAdherencePolicy,
  type ViewportPreset
} from "@design-harness/core";
import { auditUrl, BrowserUnavailableError, type BrowserHandle, type PageHandle } from "./index.js";
import type { ViewportCollectionResult } from "./browser-measurements.js";
import type { FindingCoverage, ViewportMeasurements } from "./checks.js";
import { FINDING_COVERAGE_CHECK_NAMES } from "./finding-coverage.js";

const viewport: ViewportPreset = {
  name: "desktop",
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
  isMobile: false
};

const mobileViewport: ViewportPreset = {
  name: "mobile",
  width: 390,
  height: 844,
  deviceScaleFactor: 2,
  isMobile: true
};

const tempDirs: string[] = [];

interface FakeBrowserOptions {
  gotoError?: Error;
  gotoErrors?: Array<Error | undefined>;
  closeErrors?: Array<Error | undefined>;
  screenshotError?: Error;
  ariaSnapshot?: string;
  ariaSnapshotError?: Error;
  ariaSnapshotUnavailable?: boolean;
  passwordInputValues?: string[];
  observedPasswordInputValues?: string[];
  observedPasswordAttributes?: Array<Record<string, string>>;
  measurement: ViewportMeasurements;
  notices?: AuditNotice[];
  collectionResults?: ViewportCollectionResult[];
  measurementArgs?: unknown[];
  pageCalls?: FakePageCalls[];
  browserCloseCount?: number;
}

interface FakePageCalls {
  marker: number;
  screenshot: number;
  measurement: number;
  ariaSnapshot: number;
  close: number;
}

interface FakePasswordInput {
  value: string;
  attributes: Map<string, string>;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  removeAttribute(name: string): void;
}

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

  it("stops the failed viewport after a generic navigation error and closes resources", async () => {
    const options: FakeBrowserOptions = {
      gotoError: new Error("connection refused"),
      measurement: hostileMeasurementFor("desktop"),
      pageCalls: []
    };
    const result = await auditUrl({
      url: "http://localhost:3000",
      outDir: await tempDir(),
      viewportPresets: [viewport],
      copyStyle: copyStyle(),
      launchBrowser: async () => fakeBrowser(options)
    });

    expect(result.auditResult.status).toBe("partial");
    expect(result.auditResult.failedChecks).toEqual([
      "desktop:page-timeout-or-navigation",
      "desktop:navigation-error"
    ]);
    expect(result.auditResult.findings.map((finding) => finding.checkName)).toEqual(["render-failure"]);
    const failureEvidence = result.auditResult.evidenceAssets[0];
    expect(result.auditResult.evidenceAssets).toHaveLength(1);
    expect(failureEvidence).toMatchObject({
      type: "measurement",
      viewport: "desktop",
      data: {
        checkName: "navigation-error",
        message: "connection refused"
      }
    });
    expect(result.auditResult.findings[0]?.evidenceRefs).toEqual([failureEvidence?.id]);
    expect(result.auditResult.evidenceAssets.map((asset) => asset.id).filter((id) => (
      id === "screenshot-desktop" ||
      id === "measurement-desktop" ||
      id === "text-inventory-desktop" ||
      id === "aria-snapshot-desktop"
    ))).toEqual([]);
    expect(options.pageCalls).toEqual([{
      marker: 0,
      screenshot: 0,
      measurement: 0,
      ariaSnapshot: 0,
      close: 1
    }]);
    expect(options.browserCloseCount).toBe(1);
    expect(() => assertAuditResultIntegrity(result.auditResult)).not.toThrow();
  });

  it("stops the failed viewport after a navigation timeout without misclassifying it", async () => {
    const options: FakeBrowserOptions = {
      gotoError: new errors.TimeoutError("navigation timed out"),
      measurement: hostileMeasurementFor("desktop"),
      pageCalls: []
    };
    const result = await auditUrl({
      url: "http://localhost:3000",
      outDir: await tempDir(),
      viewportPresets: [viewport],
      copyStyle: copyStyle(),
      launchBrowser: async () => fakeBrowser(options)
    });

    expect(result.auditResult.status).toBe("partial");
    expect(result.auditResult.failedChecks).toEqual(["desktop:page-timeout-or-navigation"]);
    expect(result.auditResult.findings).toHaveLength(1);
    expect(result.auditResult.findings[0]).toMatchObject({
      id: "finding-desktop-page-timeout",
      checkName: "render-failure"
    });
    expect(result.auditResult.findings[0]?.problem).toContain("did not finish loading");
    expect(result.auditResult.evidenceAssets).toHaveLength(1);
    expect(result.auditResult.evidenceAssets[0]).toMatchObject({
      type: "measurement",
      viewport: "desktop",
      data: {
        checkName: "page-timeout",
        message: "navigation timed out"
      }
    });
    expect(options.pageCalls).toEqual([{
      marker: 0,
      screenshot: 0,
      measurement: 0,
      ariaSnapshot: 0,
      close: 1
    }]);
    expect(options.browserCloseCount).toBe(1);
    expect(() => assertAuditResultIntegrity(result.auditResult)).not.toThrow();
  });

  it("continues later viewports after one viewport cannot navigate", async () => {
    const options: FakeBrowserOptions = {
      gotoErrors: [new Error("desktop refused"), undefined],
      measurement: hostileMeasurementFor("desktop"),
      collectionResults: [
        { measurements: hostileMeasurementFor("desktop"), notices: [] },
        { measurements: measurementFor("mobile"), notices: [] }
      ],
      pageCalls: []
    };
    const result = await auditUrl({
      url: "http://localhost:3000",
      outDir: await tempDir(),
      viewportPresets: [viewport, mobileViewport],
      copyStyle: copyStyle(),
      launchBrowser: async () => fakeBrowser(options)
    });

    const evidenceIds = result.auditResult.evidenceAssets.map((asset) => asset.id);
    expect(result.auditResult.status).toBe("partial");
    expect(result.auditResult.findings.map((finding) => finding.id)).toEqual(["finding-desktop-navigation-error"]);
    expect(evidenceIds.filter((id) => id.endsWith("-desktop") && !id.startsWith("failure-"))).toEqual([]);
    expect(evidenceIds).toEqual(expect.arrayContaining([
      "screenshot-mobile",
      "measurement-mobile",
      "text-inventory-mobile",
      "aria-snapshot-mobile"
    ]));
    expect(options.pageCalls).toEqual([
      { marker: 0, screenshot: 0, measurement: 0, ariaSnapshot: 0, close: 1 },
      { marker: 1, screenshot: 1, measurement: 1, ariaSnapshot: 1, close: 1 }
    ]);
    expect(options.browserCloseCount).toBe(1);
    expect(() => assertAuditResultIntegrity(result.auditResult)).not.toThrow();
  });

  it("records page cleanup failures and continues later viewports", async () => {
    const options: FakeBrowserOptions = {
      gotoErrors: [new Error("desktop refused"), undefined],
      closeErrors: [new Error("desktop close failed"), undefined],
      measurement: hostileMeasurementFor("desktop"),
      collectionResults: [
        { measurements: hostileMeasurementFor("desktop"), notices: [] },
        { measurements: measurementFor("mobile"), notices: [] }
      ],
      pageCalls: []
    };
    const result = await auditUrl({
      url: "http://localhost:3000",
      outDir: await tempDir(),
      viewportPresets: [viewport, mobileViewport],
      copyStyle: copyStyle(),
      launchBrowser: async () => fakeBrowser(options)
    });

    const cleanupEvidence = result.auditResult.evidenceAssets.find((asset) => (
      asset.viewport === "desktop" && asset.data?.checkName === "page-close"
    ));
    expect(result.auditResult.status).toBe("partial");
    expect(result.auditResult.failedChecks).toEqual([
      "desktop:page-timeout-or-navigation",
      "desktop:navigation-error",
      "desktop:page-close"
    ]);
    expect(result.auditResult.findings.map((finding) => finding.id)).toEqual(["finding-desktop-navigation-error"]);
    expect(cleanupEvidence).toMatchObject({
      type: "measurement",
      viewport: "desktop",
      data: {
        checkName: "page-close",
        message: "desktop close failed"
      }
    });
    expect(result.auditResult.evidenceAssets.map((asset) => asset.id)).toEqual(expect.arrayContaining([
      "screenshot-mobile",
      "measurement-mobile",
      "text-inventory-mobile",
      "aria-snapshot-mobile"
    ]));
    expect(options.pageCalls).toEqual([
      { marker: 0, screenshot: 0, measurement: 0, ariaSnapshot: 0, close: 1 },
      { marker: 1, screenshot: 1, measurement: 1, ariaSnapshot: 1, close: 1 }
    ]);
    expect(options.browserCloseCount).toBe(1);
    expect(() => assertAuditResultIntegrity(result.auditResult)).not.toThrow();
  });

  it("preserves completed viewport output when page cleanup fails", async () => {
    const options: FakeBrowserOptions = {
      closeErrors: [new Error("desktop close failed")],
      measurement: {
        ...measurementFor("desktop"),
        documentScrollWidth: 1500
      },
      pageCalls: []
    };
    const result = await auditUrl({
      url: "http://localhost:3000",
      outDir: await tempDir(),
      viewportPresets: [viewport],
      launchBrowser: async () => fakeBrowser(options)
    });

    expect(result.auditResult.status).toBe("partial");
    expect(result.auditResult.failedChecks).toEqual(["desktop:page-close"]);
    expect(result.auditResult.findings.some((finding) => finding.checkName === "horizontal-overflow")).toBe(true);
    expect(result.auditResult.evidenceAssets).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "screenshot-desktop" }),
      expect.objectContaining({ id: "measurement-desktop" }),
      expect.objectContaining({ id: "text-inventory-desktop" }),
      expect.objectContaining({ id: "aria-snapshot-desktop" }),
      expect.objectContaining({
        type: "measurement",
        viewport: "desktop",
        data: {
          checkName: "page-close",
          message: "desktop close failed"
        }
      })
    ]));
    expect(options.pageCalls).toEqual([
      { marker: 1, screenshot: 1, measurement: 1, ariaSnapshot: 1, close: 1 }
    ]);
    expect(options.browserCloseCount).toBe(1);
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

  it("records text inventory and aria snapshot as first-class evidence assets", async () => {
    const result = await auditUrl({
      url: "http://localhost:3000",
      outDir: await tempDir(),
      viewportPresets: [viewport],
      launchBrowser: async () =>
        fakeBrowser({
          measurement: {
            ...measurementFor("desktop"),
            textInventory: [{
              selector: "main > p",
              text: "Rendered copy",
              region: { x: 12, y: 24, width: 240, height: 32 },
              fontSize: 16,
              fontWeight: "400",
              nearestLang: "en",
              tag: "p",
              role: "",
              accessibleName: "Rendered copy",
              copySurface: {
                surface: "body",
                ruleIndex: 3,
                matcher: { kind: "adapter", adapter: "web-dom", value: "main p" }
              }
            }]
          },
          ariaSnapshot: "- paragraph: Rendered copy"
        })
    });

    const measurementEvidence = result.auditResult.evidenceAssets.find((asset) => asset.id === "measurement-desktop");
    const textEvidence = result.auditResult.evidenceAssets.find((asset) => asset.id === "text-inventory-desktop");
    const ariaEvidence = result.auditResult.evidenceAssets.find((asset) => asset.id === "aria-snapshot-desktop");

    expect(result.auditResult.status).toBe("success");
    expect(result.auditResult).not.toHaveProperty("notices");
    expect(result.metadata.toolVersions).not.toHaveProperty("@design-harness/copy-audit");
    expect(measurementEvidence?.type).toBe("measurement");
    expect(measurementEvidence?.data).not.toHaveProperty("textInventory");
    expect(textEvidence).toMatchObject({
      type: "text-inventory",
      viewport: "desktop",
      data: {
        viewport: "desktop",
        count: 1,
        truncatedCount: 0
      }
    });
    expect(textEvidence?.data).toMatchObject({
      items: [
        {
          copySurface: {
            surface: "body",
            ruleIndex: 3,
            matcher: { kind: "adapter", adapter: "web-dom", value: "main p" }
          }
        }
      ]
    });
    expect(ariaEvidence).toMatchObject({
      type: "aria-snapshot",
      viewport: "desktop",
      data: {
        viewport: "desktop",
        format: "playwright-aria-yaml",
        snapshot: "- paragraph: Rendered copy"
      }
    });
    expect(() => assertAuditResultIntegrity(result.auditResult)).not.toThrow();
  });

  it("uses locator aria snapshots so the declared Playwright floor is supported", async () => {
    const result = await auditUrl({
      url: "http://localhost:3000",
      outDir: await tempDir(),
      viewportPresets: [viewport],
      launchBrowser: async () =>
        fakeBrowser({
          measurement: measurementFor("desktop"),
          ariaSnapshot: "- document\n  - paragraph: Locator snapshot"
        })
    });

    const ariaEvidence = result.auditResult.evidenceAssets.find((asset) => asset.id === "aria-snapshot-desktop");
    expect(result.auditResult.status).toBe("success");
    expect(result.auditResult.failedChecks).not.toContain("desktop:aria-snapshot");
    expect(ariaEvidence?.data?.snapshot).toContain("Locator snapshot");
  });

  it("does not store password values in DOM attributes while collecting aria snapshots", async () => {
    const secret = "SUPER_SECRET_PASSWORD";
    const options: FakeBrowserOptions = {
      measurement: measurementFor("desktop"),
      passwordInputValues: [secret]
    };
    const result = await auditUrl({
      url: "http://localhost:3000",
      outDir: await tempDir(),
      viewportPresets: [viewport],
      launchBrowser: async () => fakeBrowser(options)
    });

    const ariaEvidence = result.auditResult.evidenceAssets.find((asset) => asset.id === "aria-snapshot-desktop");
    expect(result.auditResult.status).toBe("success");
    expect(ariaEvidence?.data?.snapshot).toContain("data-design-harness-mask-id");
    expect(JSON.stringify(result.auditResult)).not.toContain(secret);
    expect(options.observedPasswordInputValues).toEqual([secret]);
    expect(JSON.stringify(options.observedPasswordAttributes)).not.toContain(secret);
  });

  it("caps text inventory text-like fields before writing evidence", async () => {
    const result = await auditUrl({
      url: "http://localhost:3000",
      outDir: await tempDir(),
      viewportPresets: [viewport],
      launchBrowser: async () =>
        fakeBrowser({
          measurement: {
            ...measurementFor("desktop"),
            textInventory: [{
              selector: "main > p",
              text: `${"x".repeat(2_500)}TEXT_SENTINEL`,
              region: { x: 12, y: 24, width: 240, height: 32 },
              fontSize: 16,
              fontWeight: "400",
              nearestLang: "en",
              tag: "p",
              role: "",
              accessibleName: `${"y".repeat(2_500)}NAME_SENTINEL`
            }]
          }
        })
    });

    const textEvidence = result.auditResult.evidenceAssets.find((asset) => asset.id === "text-inventory-desktop");
    const items = textEvidence?.data?.items as Array<{ text: string; accessibleName: string; truncated?: true }> | undefined;

    expect(textEvidence?.data?.truncatedCount).toBe(1);
    expect(items?.[0]?.truncated).toBe(true);
    expect(items?.[0]?.text).toHaveLength(2_000);
    expect(items?.[0]?.accessibleName).toHaveLength(2_000);
    expect(JSON.stringify(textEvidence)).not.toContain("TEXT_SENTINEL");
    expect(JSON.stringify(textEvidence)).not.toContain("NAME_SENTINEL");
  });

  it("marks long aria snapshots as truncated", async () => {
    const longSnapshot = `${"x".repeat(25_000)}SUPER_SECRET_PASSWORD`;
    const result = await auditUrl({
      url: "http://localhost:3000",
      outDir: await tempDir(),
      viewportPresets: [viewport],
      launchBrowser: async () =>
        fakeBrowser({
          measurement: measurementFor("desktop"),
          ariaSnapshot: longSnapshot
        })
    });

    const ariaEvidence = result.auditResult.evidenceAssets.find((asset) => asset.id === "aria-snapshot-desktop");
    expect(ariaEvidence?.data?.truncated).toBe(true);
    expect(String(ariaEvidence?.data?.snapshot)).toHaveLength(20_000);
    expect(JSON.stringify(result.auditResult)).not.toContain("SUPER_SECRET_PASSWORD");
  });

  it("records aria snapshot failures as partial evidence", async () => {
    const result = await auditUrl({
      url: "http://localhost:3000",
      outDir: await tempDir(),
      viewportPresets: [viewport],
      launchBrowser: async () =>
        fakeBrowser({
          measurement: measurementFor("desktop"),
          ariaSnapshotError: new Error("aria failed")
        })
    });

    const evidenceIds = new Set(result.auditResult.evidenceAssets.map((asset) => asset.id));
    expect(result.auditResult.status).toBe("partial");
    expect(result.auditResult.failedChecks).toContain("desktop:aria-snapshot");
    expect(result.auditResult.evidenceAssets.some((asset) => asset.data?.checkName === "aria-snapshot")).toBe(true);
    for (const finding of result.auditResult.findings) {
      expect(finding.evidenceRefs.every((ref) => evidenceIds.has(ref))).toBe(true);
    }
    expect(() => assertAuditResultIntegrity(result.auditResult)).not.toThrow();
  });

  it("skips missing aria snapshot support without making the audit partial", async () => {
    const result = await auditUrl({
      url: "http://localhost:3000",
      outDir: await tempDir(),
      viewportPresets: [viewport],
      launchBrowser: async () =>
        fakeBrowser({
          measurement: measurementFor("desktop"),
          ariaSnapshotUnavailable: true
        })
    });

    expect(result.auditResult.status).toBe("success");
    expect(result.auditResult.failedChecks).not.toContain("desktop:aria-snapshot");
    expect(result.auditResult.evidenceAssets.some((asset) => asset.data?.checkName === "aria-snapshot-unavailable")).toBe(false);
    expect(() => assertAuditResultIntegrity(result.auditResult)).not.toThrow();
  });
});

describe("auditUrl font-family adherence", () => {
  it("omits all font policy work and evidence when no guide policy is supplied", async () => {
    const measurement = fontMeasurementFor("desktop");
    const options: FakeBrowserOptions = {
      measurement,
      measurementArgs: []
    };

    const result = await auditUrl({
      url: "http://localhost:3000",
      outDir: await tempDir(),
      viewportPresets: [viewport],
      launchBrowser: async () => fakeBrowser(options)
    });

    const measurementEvidence = result.auditResult.evidenceAssets.find((asset) => asset.id === "measurement-desktop");
    const textEvidence = result.auditResult.evidenceAssets.find((asset) => asset.id === "text-inventory-desktop");
    expect(options.measurementArgs).toEqual([undefined]);
    expect(measurementEvidence?.data).not.toHaveProperty("fontFamilyAdherence");
    expect(textEvidence?.data?.items).toEqual([
      expect.not.objectContaining({ fontFamily: expect.anything() })
    ]);
    expect(result.auditResult.findings.some((finding) => finding.checkName === "unapproved-font-family")).toBe(false);
    expect(result.auditResult.failedChecks).not.toContain("desktop:unapproved-font-family");
    expect(result.auditResult).not.toHaveProperty("notices");
  });

  it("records a bounded summary and a source-backed risk for an unexpected computed member", async () => {
    const measurement = fontMeasurementFor("desktop", '"Other", sans-serif');
    const options: FakeBrowserOptions = {
      measurement,
      measurementArgs: [],
      collectionResults: [{
        measurements: measurement,
        notices: [],
        fontFamilyCollection: { evaluatedElementCount: 1, ignoredElementCount: 0 }
      }]
    };
    const result = await auditUrl({
      url: "http://localhost:3000",
      outDir: await tempDir(),
      viewportPresets: [viewport],
      fontFamilyPolicy: fontFamilyPolicy(),
      launchBrowser: async () => fakeBrowser(options)
    });

    const measurementEvidence = result.auditResult.evidenceAssets.find((asset) => asset.id === "measurement-desktop");
    const textEvidence = result.auditResult.evidenceAssets.find((asset) => asset.id === "text-inventory-desktop");
    expect(options.measurementArgs).toEqual([{
      fontFamily: { ignoreSelectors: [".third-party-widget"] }
    }]);
    expect(measurementEvidence?.data?.fontFamilyAdherence).toMatchObject({
      policyId: "font-family-adherence-v1",
      evaluatedElementCount: 1,
      ignoredElementCount: 0,
      violatingElementCount: 1,
      distinctViolationStackCount: 1,
      emittedStackCount: 1,
      truncated: false
    });
    expect(textEvidence?.data?.items).toEqual([
      expect.objectContaining({ fontFamily: '"Other", sans-serif' })
    ]);
    expect(result.auditResult.findings).toEqual([
      expect.objectContaining({
        checkName: "unapproved-font-family",
        criterionId: "visual.font-family.project-contract",
        severity: "low",
        confidence: "high",
        determinism: "deterministic",
        resultKind: "risk"
      })
    ]);
    expect(result.auditResult.advisoryScore).toMatchObject({
      formulaVersion: "epistemic-criterion-max-v2",
      value: 97.6,
      totalDeduction: 2.4,
      saturated: false,
      deductions: [
        expect.objectContaining({
          points: 2.4,
          findingIds: [result.auditResult.findings[0]?.id],
          viewports: ["desktop"],
          reason: expect.stringContaining("deterministic risk")
        })
      ]
    });
    expect(result.auditResult.status).toBe("success");
    expect(() => assertAuditResultIntegrity(result.auditResult)).not.toThrow();
  });

  it("records ignored candidates in a clean observable summary", async () => {
    const measurement = fontMeasurementFor("desktop");
    const result = await auditUrl({
      url: "http://localhost:3000",
      outDir: await tempDir(),
      viewportPresets: [viewport],
      fontFamilyPolicy: fontFamilyPolicy(),
      launchBrowser: async () => fakeBrowser({
        measurement,
        collectionResults: [{
          measurements: measurement,
          notices: [],
          fontFamilyCollection: { evaluatedElementCount: 0, ignoredElementCount: 1 }
        }]
      })
    });

    const measurementEvidence = result.auditResult.evidenceAssets.find((asset) => asset.id === "measurement-desktop");
    expect(measurementEvidence?.data?.fontFamilyAdherence).toMatchObject({
      evaluatedElementCount: 0,
      ignoredElementCount: 1,
      violatingElementCount: 0,
      stacks: []
    });
    expect(result.auditResult.findings).toEqual([]);
    expect(result.auditResult.status).toBe("success");
  });

  it.each([
    ["browser selector failure", {
      error: { code: "invalid-selector" as const, selectorIndex: 0 },
      stack: "Inter, sans-serif",
      expectedReason: "invalid-selector"
    }],
    ["computed serialization parse failure", {
      error: undefined,
      stack: "Inter,,sans-serif",
      expectedReason: "unparsable-computed-family"
    }]
  ])("keeps base measurements but marks only the font check partial on %s", async (_label, scenario) => {
    const measurement = {
      ...fontMeasurementFor("desktop", scenario.stack),
      documentScrollWidth: 1500
    };
    const collection: ViewportCollectionResult = {
      measurements: measurement,
      notices: [],
      ...(scenario.error
        ? { fontFamilyError: scenario.error }
        : { fontFamilyCollection: { evaluatedElementCount: 1, ignoredElementCount: 0 } })
    };
    const result = await auditUrl({
      url: "http://localhost:3000",
      outDir: await tempDir(),
      viewportPresets: [viewport],
      fontFamilyPolicy: fontFamilyPolicy(),
      launchBrowser: async () => fakeBrowser({
        measurement,
        collectionResults: [collection]
      })
    });

    const measurementEvidence = result.auditResult.evidenceAssets.find((asset) => asset.id === "measurement-desktop");
    const textEvidence = result.auditResult.evidenceAssets.find((asset) => asset.id === "text-inventory-desktop");
    expect(result.auditResult.status).toBe("partial");
    expect(result.auditResult.failedChecks).toEqual(["desktop:unapproved-font-family"]);
    expect(result.auditResult.findings.map((finding) => finding.checkName)).toContain("horizontal-overflow");
    expect(result.auditResult.findings.map((finding) => finding.checkName)).not.toContain("unapproved-font-family");
    expect(measurementEvidence?.data).not.toHaveProperty("fontFamilyAdherence");
    expect(textEvidence?.data?.items).toEqual([
      expect.not.objectContaining({ fontFamily: expect.anything() })
    ]);
    expect(result.auditResult.notices).toEqual([
      expect.objectContaining({
        code: "font-family-adherence-measurement-failed",
        message: "Font-family adherence could not be evaluated for this viewport.",
        details: expect.objectContaining({
          viewport: "desktop",
          reasonCode: scenario.expectedReason
        })
      })
    ]);
    expect(JSON.stringify(result.auditResult)).not.toContain(".third-party-widget");
    expect(() => assertAuditResultIntegrity(result.auditResult)).not.toThrow();
  });
});

describe("auditUrl copy analysis", () => {
  it("analyzes pre-materialized text inventory against its exact evidence asset", async () => {
    const result = await auditUrl({
      url: "http://localhost:3000",
      outDir: await tempDir(),
      viewportPresets: [viewport],
      copyStyle: copyStyle(),
      launchBrowser: async () => fakeBrowser({
        measurement: copyMeasurementFor("desktop")
      })
    });

    expect(result.auditResult.findings).toHaveLength(5);
    expect(result.auditResult.findings.map((finding) => finding.checkName)).toEqual(expect.arrayContaining([
      "placeholder-leak",
      "josa-hedge",
      "glossary-banned-term",
      "glossary-use-carefully-term",
      "banned-phrase"
    ]));
    expect(result.auditResult.findings.every((finding) => (
      finding.evidenceRefs.length === 1 && finding.evidenceRefs[0] === "text-inventory-desktop"
    ))).toBe(true);
    expect(new Set(result.auditResult.findings.map((finding) => finding.criterionId)).size).toBe(5);
    expect(result.auditResult.advisoryScore).toMatchObject({
      formulaVersion: "epistemic-criterion-max-v2",
      value: 63.2,
      totalDeduction: 36.8,
      saturated: false
    });
    expect(result.auditResult.advisoryScore.deductions).toHaveLength(5);
    if (result.auditResult.advisoryScore.formulaVersion !== "epistemic-criterion-max-v2") {
      throw new Error("current audit producer did not emit criterion-max-v2");
    }
    for (const deduction of result.auditResult.advisoryScore.deductions) {
      expect(deduction.findingIds).toEqual([deduction.findingId]);
      expect(deduction.viewports).toEqual(["desktop"]);
    }
    expect(result.auditResult.status).toBe("success");
    expect(result.auditResult).not.toHaveProperty("notices");
    expect(result.metadata.toolVersions["@design-harness/copy-audit"]).toBe(result.auditResult.harnessVersion);
    expect(() => assertAuditResultIntegrity(result.auditResult)).not.toThrow();
  });

  it("bounds duplicate viewport occurrences per criterion while keeping distinct criteria additive", async () => {
    const result = await auditUrl({
      url: "http://localhost:3000",
      outDir: await tempDir(),
      viewportPresets: [viewport, mobileViewport],
      copyStyle: copyStyle(),
      launchBrowser: async () => fakeBrowser({
        measurement: copyMeasurementFor("desktop"),
        collectionResults: [
          { measurements: copyMeasurementFor("desktop"), notices: [] },
          { measurements: copyMeasurementFor("mobile"), notices: [] }
        ]
      })
    });

    expect(result.auditResult.findings).toHaveLength(10);
    expect(new Set(result.auditResult.findings.map((finding) => finding.criterionId)).size).toBe(5);
    expect(result.auditResult.advisoryScore).toMatchObject({
      formulaVersion: "epistemic-criterion-max-v2",
      value: 63.2,
      totalDeduction: 36.8,
      saturated: false
    });
    expect(result.auditResult.advisoryScore.deductions).toHaveLength(5);
    if (result.auditResult.advisoryScore.formulaVersion !== "epistemic-criterion-max-v2") {
      throw new Error("current audit producer did not emit criterion-max-v2");
    }
    for (const deduction of result.auditResult.advisoryScore.deductions) {
      const representative = result.auditResult.findings.find((finding) => finding.id === deduction.findingId);
      expect(representative).toBeDefined();
      const findingIds = result.auditResult.findings
        .filter((finding) => finding.criterionId === representative?.criterionId)
        .map((finding) => finding.id)
        .sort();
      expect(findingIds).toHaveLength(2);
      expect(deduction.findingId).toBe(findingIds[0]);
      expect(deduction.findingIds).toEqual(findingIds);
      expect(deduction.viewports).toEqual(["desktop", "mobile"]);
    }
    expect(result.auditResult.advisoryScore.deductions.reduce((sum, deduction) => sum + deduction.points, 0)).toBeCloseTo(36.8, 10);
    expect(() => assertAuditResultIntegrity(result.auditResult)).not.toThrow();
  });

  it("deduplicates configuration notices across viewports without affecting status or score", async () => {
    const mobile = mobileViewport;
    const desktopNotice: AuditNotice = {
      code: "copy-surface-unsupported-adapter",
      message: "Unsupported adapter was skipped.",
      viewport: "desktop",
      details: {
        adapter: "figma",
        value: "node-1",
        ruleIndex: 0,
        matcherIndex: 0
      }
    };
    const mobileNotice: AuditNotice = {
      code: desktopNotice.code,
      message: desktopNotice.message,
      viewport: "mobile",
      details: {
        matcherIndex: 0,
        ruleIndex: 0,
        value: "node-1",
        adapter: "figma"
      }
    };
    const style = copyStyle();
    style.glossary?.push({ term: "형태소", tier: "approved", match: "lemma" });

    const result = await auditUrl({
      url: "http://localhost:3000",
      outDir: await tempDir(),
      viewportPresets: [viewport, mobile],
      copyStyle: style,
      launchBrowser: async () => fakeBrowser({
        measurement: copyMeasurementFor("desktop"),
        collectionResults: [
          { measurements: copyMeasurementFor("desktop"), notices: [desktopNotice] },
          { measurements: copyMeasurementFor("mobile"), notices: [mobileNotice] }
        ]
      })
    });

    expect(result.auditResult.findings).toHaveLength(10);
    expect(result.auditResult.advisoryScore).toMatchObject({
      formulaVersion: "epistemic-criterion-max-v2",
      value: 63.2,
      totalDeduction: 36.8,
      saturated: false
    });
    expect(result.auditResult.advisoryScore.deductions).toHaveLength(5);
    expect(result.auditResult.status).toBe("success");
    expect(result.auditResult.failedChecks).toEqual([]);
    expect(result.auditResult.notices).toHaveLength(2);
    expect(result.auditResult.notices?.filter((notice) => notice.code === desktopNotice.code)).toHaveLength(1);
    expect(result.auditResult.notices?.every((notice) => notice.viewport === undefined)).toBe(true);
    for (const finding of result.auditResult.findings) {
      expect(finding.evidenceRefs).toEqual([`text-inventory-${finding.viewport}`]);
    }
    expect(() => assertAuditResultIntegrity(result.auditResult)).not.toThrow();
  });

  it("aggregates contrast skip notices with stable per-viewport details", async () => {
    const result = await auditUrl({
      url: "http://localhost:3000",
      outDir: await tempDir(),
      viewportPresets: [mobileViewport, viewport],
      launchBrowser: async () => fakeBrowser({
        measurement: measurementFor("mobile"),
        collectionResults: [
          {
            measurements: measurementFor("mobile"),
            notices: [{
              code: "contrast-elements-skipped",
              message: "Some painted contrast could not be determined.",
              viewport: "mobile",
              details: {
                skippedByReason: { opacity: 2, filter: 1 },
                skippedElementCount: 3
              }
            }]
          },
          {
            measurements: measurementFor("desktop"),
            notices: [{
              code: "contrast-elements-skipped",
              message: "Some painted contrast could not be determined.",
              viewport: "desktop",
              details: {
                skippedElementCount: 1,
                skippedByReason: { "background-image": 1 }
              }
            }]
          }
        ]
      })
    });

    expect(result.auditResult.notices).toEqual([{
      code: "contrast-elements-skipped",
      message: "Some painted contrast could not be determined.",
      details: {
        viewports: [
          {
            viewport: "desktop",
            skippedElementCount: 1,
            skippedByReason: { "background-image": 1 }
          },
          {
            viewport: "mobile",
            skippedElementCount: 3,
            skippedByReason: { filter: 1, opacity: 2 }
          }
        ]
      }
    }]);
    expect(() => assertAuditResultIntegrity(result.auditResult)).not.toThrow();
  });
});

describe("auditUrl finding coverage", () => {
  it("emits one audit-level notice for multiple truncated checks in one viewport", async () => {
    const measurement = measurementWithCappedSamples("desktop", 7, 8);
    const coverage = browserCoverageFor("desktop", {
      "text-clipping": { detectedCount: 7, emittedCount: 5 },
      "missing-accessible-name": { detectedCount: 8, emittedCount: 5 }
    });
    const result = await auditUrl({
      url: "http://localhost:3000",
      outDir: await tempDir(),
      viewportPresets: [viewport],
      launchBrowser: async () => fakeBrowser({
        measurement,
        collectionResults: [{ measurements: measurement, notices: [], findingCoverage: coverage }]
      })
    });

    const truncationNotices = result.auditResult.notices?.filter(({ code }) => code === "finding-samples-truncated");
    expect(truncationNotices).toHaveLength(1);
    expect(truncationNotices?.[0]).not.toHaveProperty("viewport");
    expect(truncationNotices?.[0]?.details).toEqual({
      viewports: [{
        viewport: "desktop",
        checks: [{
          checkName: "missing-accessible-name",
          detectedCount: 8,
          emittedCount: 5,
          limit: 5,
          omittedCount: 3
        }, {
          checkName: "text-clipping",
          detectedCount: 7,
          emittedCount: 5,
          limit: 5,
          omittedCount: 2
        }]
      }]
    });
    expect(result.auditResult.findings).toHaveLength(10);
    const measurementEvidence = result.auditResult.evidenceAssets.find(({ id }) => id === "measurement-desktop");
    expect((measurementEvidence?.data?.findingCoverage as FindingCoverage | undefined)?.entries).toHaveLength(20);
  });

  it("keeps two viewports separate inside one viewport-sorted notice", async () => {
    const mobileMeasurement = measurementWithCappedSamples("mobile", 0, 7);
    const desktopMeasurement = measurementWithCappedSamples("desktop", 6, 0);
    const result = await auditUrl({
      url: "http://localhost:3000",
      outDir: await tempDir(),
      viewportPresets: [mobileViewport, viewport],
      launchBrowser: async () => fakeBrowser({
        measurement: mobileMeasurement,
        collectionResults: [{
          measurements: mobileMeasurement,
          notices: [],
          findingCoverage: browserCoverageFor("mobile", {
            "missing-accessible-name": { detectedCount: 7, emittedCount: 5 }
          })
        }, {
          measurements: desktopMeasurement,
          notices: [],
          findingCoverage: browserCoverageFor("desktop", {
            "text-clipping": { detectedCount: 6, emittedCount: 5 }
          })
        }]
      })
    });

    const notices = result.auditResult.notices?.filter(({ code }) => code === "finding-samples-truncated");
    const viewports = notices?.[0]?.details?.viewports as Array<{ viewport: string }> | undefined;
    expect(notices).toHaveLength(1);
    expect(viewports?.map(({ viewport }) => viewport)).toEqual(["desktop", "mobile"]);
  });

  it("emits no truncation notice at or below the materialization limit", async () => {
    const measurement = measurementWithCappedSamples("desktop", 5, 3);
    const result = await auditUrl({
      url: "http://localhost:3000",
      outDir: await tempDir(),
      viewportPresets: [viewport],
      launchBrowser: async () => fakeBrowser({
        measurement,
        collectionResults: [{
          measurements: measurement,
          notices: [],
          findingCoverage: browserCoverageFor("desktop", {
            "text-clipping": { detectedCount: 5, emittedCount: 5 },
            "missing-accessible-name": { detectedCount: 3, emittedCount: 3 }
          })
        }]
      })
    });

    expect(result.auditResult.notices?.some(({ code }) => code === "finding-samples-truncated") ?? false).toBe(false);
  });

  it("keeps findings, status, failed checks, and v2 score byte-equal when only diagnostics are added", async () => {
    const withoutCoverageMeasurement = measurementWithCappedSamples("desktop", 7, 0);
    const withoutCoverage = await auditUrl({
      url: "http://localhost:3000",
      outDir: await tempDir(),
      viewportPresets: [viewport],
      launchBrowser: async () => fakeBrowser({ measurement: withoutCoverageMeasurement })
    });
    const withCoverageMeasurement = measurementWithCappedSamples("desktop", 7, 0);
    const withCoverage = await auditUrl({
      url: "http://localhost:3000",
      outDir: await tempDir(),
      viewportPresets: [viewport],
      launchBrowser: async () => fakeBrowser({
        measurement: withCoverageMeasurement,
        collectionResults: [{
          measurements: withCoverageMeasurement,
          notices: [],
          findingCoverage: browserCoverageFor("desktop", {
            "text-clipping": { detectedCount: 7, emittedCount: 5 }
          })
        }]
      })
    });

    expect(withCoverage.auditResult.findings).toEqual(withoutCoverage.auditResult.findings);
    expect(withCoverage.auditResult.status).toBe(withoutCoverage.auditResult.status);
    expect(withCoverage.auditResult.failedChecks).toEqual(withoutCoverage.auditResult.failedChecks);
    expect(withCoverage.auditResult.advisoryScore).toEqual(withoutCoverage.auditResult.advisoryScore);
  });
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "design-harness-audit-"));
  tempDirs.push(dir);
  return dir;
}

function fakeBrowser(options: FakeBrowserOptions): BrowserHandle {
  let pageIndex = 0;
  return {
    version: () => "fake-browser",
    newPage: async () => fakePage(options, pageIndex++),
    close: async () => {
      options.browserCloseCount = (options.browserCloseCount ?? 0) + 1;
    }
  };
}

function fakePage(options: FakeBrowserOptions, pageIndex: number): PageHandle {
  const calls = pageCallsFor(options, pageIndex);
  const passwordInputs = (options.passwordInputValues ?? []).map(fakePasswordInput);
  const collectionResult = options.collectionResults?.[pageIndex] ?? {
    measurements: options.measurement,
    notices: options.notices ?? []
  };
  const page: PageHandle = {
    setDefaultTimeout: () => undefined,
    setDefaultNavigationTimeout: () => undefined,
    goto: async () => {
      const gotoError = options.gotoErrors ? options.gotoErrors[pageIndex] : options.gotoError;
      if (gotoError) {
        throw gotoError;
      }
      return {
        status: () => 200,
        statusText: () => "OK"
      };
    },
    evaluate: async (pageFunction, arg) => {
      const source = String(pageFunction);
      if (source.includes("data-design-harness-mask-id")) {
        return runWithFakeDocument(passwordInputs, () => pageFunction(arg)) as never;
      }
      if (source.includes("MAX_TEXT_INVENTORY_TEXT_LENGTH")) {
        calls.measurement += 1;
        options.measurementArgs?.push(arg);
        // The closure returns raw candidates and collectViewportMeasurements scores them in Node, so the
        // double has to supply that channel too. No test here exercises contrast, and every fixture
        // measurement declares `contrastRisks: []`, so an empty candidate list reproduces them exactly.
        return {
          ...collectionResult,
          contrastCandidates: [],
          tapTargetCandidates: [],
          measurements: {
            ...collectionResult.measurements,
            contrastCoverage: { evaluatedElementCount: 0, skippedElementCount: 0, skippedByReason: {} }
          }
        } as never;
      }
      if (arg !== undefined) {
        calls.marker += 1;
        return undefined as never;
      }
      return collectionResult as never;
    },
    locator: options.ariaSnapshotUnavailable
      ? undefined
      : () => ({
        ariaSnapshot: async () => {
          calls.ariaSnapshot += 1;
          if (options.ariaSnapshotError) {
            throw options.ariaSnapshotError;
          }
          return options.ariaSnapshot ?? ariaSnapshotFromPasswordInputs(passwordInputs);
        }
      }),
    screenshot: async () => {
      calls.screenshot += 1;
      if (options.screenshotError) {
        throw options.screenshotError;
      }
      return undefined;
    },
    close: async () => {
      calls.close += 1;
      options.observedPasswordInputValues = passwordInputs.map((input) => input.value);
      options.observedPasswordAttributes = passwordInputs.map((input) => Object.fromEntries(input.attributes));
      const closeError = options.closeErrors?.[pageIndex];
      if (closeError) {
        throw closeError;
      }
    }
  };
  return page;
}

function pageCallsFor(options: FakeBrowserOptions, pageIndex: number): FakePageCalls {
  const calls: FakePageCalls = {
    marker: 0,
    screenshot: 0,
    measurement: 0,
    ariaSnapshot: 0,
    close: 0
  };
  if (!options.pageCalls) {
    return calls;
  }
  options.pageCalls[pageIndex] = calls;
  return calls;
}

function fakePasswordInput(value: string): FakePasswordInput {
  return {
    value,
    attributes: new Map<string, string>(),
    setAttribute(name: string, attributeValue: string) {
      this.attributes.set(name, attributeValue);
    },
    getAttribute(name: string) {
      return this.attributes.get(name) ?? null;
    },
    hasAttribute(name: string) {
      return this.attributes.has(name);
    },
    removeAttribute(name: string) {
      this.attributes.delete(name);
    }
  };
}

function ariaSnapshotFromPasswordInputs(inputs: FakePasswordInput[]): string {
  if (inputs.length === 0) {
    return "- document";
  }

  return inputs.map((input, index) => {
    const attributes = JSON.stringify(Object.fromEntries(input.attributes));
    return `- password-input-${index}: value=${input.value} attributes=${attributes}`;
  }).join("\n");
}

function runWithFakeDocument<T>(inputs: FakePasswordInput[], callback: () => T | Promise<T>): T | Promise<T> {
  const previousDocument = globalThis.document;
  const document = {
    querySelectorAll(selector: string) {
      if (selector === "input[type='password']") {
        return inputs;
      }
      return [];
    },
    querySelector(selector: string) {
      const match = selector.match(/^input\[data-design-harness-mask-id="([^"]+)"\]$/);
      if (!match) {
        return null;
      }
      return inputs.find((input) => input.getAttribute("data-design-harness-mask-id") === match[1]) ?? null;
    }
  };
  globalThis.document = document as unknown as Document;
  try {
    return callback();
  } finally {
    globalThis.document = previousDocument;
  }
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
}

function measurementWithCappedSamples(
  name: string,
  clippedTextCount: number,
  missingAccessibleNameCount: number
): ViewportMeasurements {
  return {
    ...measurementFor(name),
    clippedText: Array.from({ length: clippedTextCount }, (_, index) => ({ selector: `.clipped-${index}` })),
    missingAccessibleNames: Array.from(
      { length: missingAccessibleNameCount },
      (_, index) => ({ selector: `.unnamed-${index}` })
    )
  };
}

function browserCoverageFor(
  viewport: string,
  counts: Partial<Record<string, { detectedCount: number; emittedCount: number }>> = {}
): FindingCoverage {
  return {
    viewport,
    entries: FINDING_COVERAGE_CHECK_NAMES
      .filter((checkName) => checkName !== "dom-contrast-risk" && checkName !== "tap-target-risk")
      .map((checkName) => {
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

function copyMeasurementFor(name: string): ViewportMeasurements {
  return {
    ...measurementFor(name),
    textInventory: [{
      selector: "main > p",
      text: "TODO 충전하기 주의어 빠르고 쉽습니다 을(를)",
      region: { x: 12, y: 24, width: 420, height: 32 },
      fontSize: 16,
      fontWeight: "400",
      nearestLang: "ko-KR",
      tag: "p",
      role: "",
      accessibleName: "TODO 충전하기 주의어 빠르고 쉽습니다 을(를)",
      copySurface: {
        surface: "body",
        ruleIndex: 0,
        matcher: { kind: "adapter", adapter: "web-dom", value: "main p" }
      }
    }]
  };
}

function fontMeasurementFor(name: string, fontFamily?: string): ViewportMeasurements {
  return {
    ...measurementFor(name),
    textInventory: [{
      selector: "main > p",
      text: "Visible text",
      region: { x: 12, y: 24, width: 240, height: 32 },
      fontSize: 16,
      fontWeight: "400",
      nearestLang: "en",
      tag: "p",
      role: "",
      accessibleName: "Visible text",
      ...(fontFamily === undefined ? {} : { fontFamily })
    }]
  };
}

function hostileMeasurementFor(name: string): ViewportMeasurements {
  return {
    ...copyMeasurementFor(name),
    textLength: 0,
    meaningfulElementCount: 0,
    pageLangMissing: true,
    missingMainLandmark: true
  };
}

function fontFamilyPolicy(): FontFamilyAdherencePolicy {
  return {
    policyId: "font-family-adherence-v1",
    allowedFamilies: [
      { value: "Inter", kind: "named" },
      { value: "sans-serif", kind: "generic" }
    ],
    ignoreSelectors: [".third-party-widget"]
  };
}

function copyStyle(): CopyStyle {
  return {
    schemaVersion: SCHEMA_VERSION,
    locale: "ko-KR",
    glossary: [
      {
        term: "충전하기",
        tier: "banned",
        preferredTerm: "입금하기",
        surfaces: ["body"]
      },
      {
        term: "주의어",
        tier: "use-carefully",
        surfaces: ["body"]
      }
    ],
    bannedPhrases: [{
      phrase: "빠르고 쉽습니다",
      suggestedReplacement: "소요 시간과 다음 단계를 구체적으로 안내하세요.",
      surfaces: ["body"]
    }]
  };
}

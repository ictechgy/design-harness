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

interface FakeBrowserOptions {
  gotoError?: Error;
  screenshotError?: Error;
  ariaSnapshot?: string;
  ariaSnapshotError?: Error;
  ariaSnapshotUnavailable?: boolean;
  passwordInputValues?: string[];
  observedPasswordInputValues?: string[];
  observedPasswordAttributes?: Array<Record<string, string>>;
  measurement: ViewportMeasurements;
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

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "design-harness-audit-"));
  tempDirs.push(dir);
  return dir;
}

function fakeBrowser(options: FakeBrowserOptions): BrowserHandle {
  return {
    version: () => "fake-browser",
    newPage: async () => fakePage(options),
    close: async () => undefined
  };
}

function fakePage(options: FakeBrowserOptions): PageHandle {
  const passwordInputs = (options.passwordInputValues ?? []).map(fakePasswordInput);
  const page: PageHandle = {
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
    evaluate: async (pageFunction, arg) => {
      const source = String(pageFunction);
      if (source.includes("data-design-harness-mask-id")) {
        return runWithFakeDocument(passwordInputs, () => pageFunction(arg)) as never;
      }
      if (arg !== undefined) {
        return undefined as never;
      }
      return options.measurement as never;
    },
    locator: options.ariaSnapshotUnavailable
      ? undefined
      : () => ({
        ariaSnapshot: async () => {
          if (options.ariaSnapshotError) {
            throw options.ariaSnapshotError;
          }
          return options.ariaSnapshot ?? ariaSnapshotFromPasswordInputs(passwordInputs);
        }
      }),
    screenshot: async () => {
      if (options.screenshotError) {
        throw options.screenshotError;
      }
      return undefined;
    },
    close: async () => {
      options.observedPasswordInputValues = passwordInputs.map((input) => input.value);
      options.observedPasswordAttributes = passwordInputs.map((input) => Object.fromEntries(input.attributes));
    }
  };
  return page;
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

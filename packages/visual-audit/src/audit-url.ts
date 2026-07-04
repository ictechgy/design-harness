import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_VIEWPORT_PRESETS,
  HARNESS_VERSION,
  SCHEMA_VERSION,
  scoreFindings,
  type AuditResult,
  type EvidenceAsset,
  type Finding,
  type RunMetadata,
  type RunStatus,
  type ViewportPreset
} from "@design-harness/core";
import { chromium, errors } from "playwright";
import { collectViewportMeasurements } from "./browser-measurements.js";
import { createRenderFailureFinding, findingsFromMeasurements, type ViewportMeasurements } from "./checks.js";
import { BrowserUnavailableError } from "./errors.js";

export interface AuditUrlOptions {
  url: string;
  outDir: string;
  runId?: string;
  timeoutMs?: number;
  viewportPresets?: ViewportPreset[];
  launchBrowser?: () => Promise<BrowserHandle>;
}

export interface AuditUrlResult {
  auditResult: AuditResult;
  metadata: RunMetadata;
}

export interface BrowserHandle {
  version(): string;
  newPage(options: {
    viewport: { width: number; height: number };
    deviceScaleFactor: number;
    isMobile: boolean;
  }): Promise<PageHandle>;
  close(): Promise<void>;
}

export interface PageHandle {
  setDefaultTimeout(timeoutMs: number): void;
  setDefaultNavigationTimeout(timeoutMs: number): void;
  goto(url: string, options: { waitUntil: "domcontentloaded"; timeout: number }): Promise<{ status(): number; statusText(): string } | null>;
  evaluate<T>(pageFunction: ((arg?: unknown) => T | Promise<T>), arg?: unknown): Promise<T>;
  screenshot(options: { path: string; fullPage: boolean }): Promise<unknown>;
  close(): Promise<void>;
}

interface MeasurementRecord {
  measurement: ViewportMeasurements;
  evidenceRefs: string[];
}

export async function auditUrl(options: AuditUrlOptions): Promise<AuditUrlResult> {
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const runId = options.runId ?? createRunId(startedAt);
  const timeoutMs = options.timeoutMs ?? 15_000;
  const viewportPresets = options.viewportPresets ?? DEFAULT_VIEWPORT_PRESETS;
  const screenshotsDir = join(options.outDir, "screenshots");
  const evidenceAssets: EvidenceAsset[] = [];
  const measurementRecords: MeasurementRecord[] = [];
  const findings: Finding[] = [];
  const failedChecks: string[] = [];

  await mkdir(screenshotsDir, { recursive: true });

  let browser;
  try {
    browser = options.launchBrowser ? await options.launchBrowser() : ((await chromium.launch({ headless: true })) as BrowserHandle);
  } catch (error) {
    throw new BrowserUnavailableError(
      [
        "Playwright Chromium could not be launched.",
        "Run `pnpm playwright:install` and try again.",
        `Original error: ${error instanceof Error ? error.message : String(error)}`
      ].join(" ")
    );
  }

  let browserVersion: string | undefined;
  try {
    browserVersion = browser.version();

    for (const viewport of viewportPresets) {
      const page = await browser.newPage({
        viewport: {
          width: viewport.width,
          height: viewport.height
        },
        deviceScaleFactor: viewport.deviceScaleFactor,
        isMobile: viewport.isMobile
      });

      const viewportEvidenceRefs: string[] = [];
      page.setDefaultTimeout(timeoutMs);
      page.setDefaultNavigationTimeout(timeoutMs);

      try {
        const response = await page.goto(options.url, {
          waitUntil: "domcontentloaded",
          timeout: timeoutMs
        });
        if (response && response.status() >= 400) {
          const evidenceId = addFailureEvidence(evidenceAssets, viewport.name, "http-status", {
            status: response.status(),
            statusText: response.statusText()
          });
          viewportEvidenceRefs.push(evidenceId);
          failedChecks.push(`${viewport.name}:http-${response.status()}`);
          findings.push(createRenderFailureFinding({
            id: `finding-${viewport.name}-http-status-${response.status()}`,
            viewport: viewport.name,
            evidenceRefs: [evidenceId],
            problem: `The page returned HTTP ${response.status()} ${response.statusText()}.`
          }));
        }
      } catch (error) {
        const errorKind = error instanceof errors.TimeoutError ? "page-timeout" : "navigation-error";
        const evidenceId = addFailureEvidence(evidenceAssets, viewport.name, errorKind, {
          message: error instanceof Error ? error.message : String(error)
        });
        viewportEvidenceRefs.push(evidenceId);
        failedChecks.push(`${viewport.name}:page-timeout-or-navigation`);
        if (!(error instanceof errors.TimeoutError)) {
          failedChecks.push(`${viewport.name}:navigation-error`);
        }
        findings.push(createRenderFailureFinding({
          id: `finding-${viewport.name}-${errorKind}`,
          viewport: viewport.name,
          evidenceRefs: [evidenceId],
          problem: error instanceof errors.TimeoutError
            ? `The page did not finish loading within ${timeoutMs}ms.`
            : "The page could not be navigated successfully."
        }));
      }

      try {
        await page.evaluate((viewportName) => {
          document.documentElement.dataset.designHarnessViewport = String(viewportName);
        }, viewport.name);
      } catch (error) {
        const evidenceId = addFailureEvidence(evidenceAssets, viewport.name, "viewport-marker", {
          message: error instanceof Error ? error.message : String(error)
        });
        viewportEvidenceRefs.push(evidenceId);
        failedChecks.push(`${viewport.name}:viewport-marker`);
      }

      const screenshotPath = join(screenshotsDir, `${viewport.name}.png`);
      const screenshotEvidenceId = `screenshot-${viewport.name}`;
      try {
        await page.screenshot({
          path: screenshotPath,
          fullPage: false
        });
        evidenceAssets.push({
          id: screenshotEvidenceId,
          type: "screenshot",
          path: `screenshots/${viewport.name}.png`,
          viewport: viewport.name,
          createdAt: new Date().toISOString()
        });
        viewportEvidenceRefs.push(screenshotEvidenceId);
      } catch (error) {
        const evidenceId = addFailureEvidence(evidenceAssets, viewport.name, "screenshot", {
          message: error instanceof Error ? error.message : String(error)
        });
        viewportEvidenceRefs.push(evidenceId);
        failedChecks.push(`${viewport.name}:screenshot`);
      }

      try {
        const measurement = await collectViewportMeasurements(page);
        const measurementEvidenceId = `measurement-${viewport.name}`;
        evidenceAssets.push({
          id: measurementEvidenceId,
          type: "measurement",
          viewport: viewport.name,
          data: measurement as unknown as Record<string, unknown>,
          createdAt: new Date().toISOString()
        });
        viewportEvidenceRefs.push(measurementEvidenceId);
        measurementRecords.push({
          measurement,
          evidenceRefs: [...viewportEvidenceRefs]
        });
      } catch (error) {
        const evidenceId = addFailureEvidence(evidenceAssets, viewport.name, "measurement", {
          message: error instanceof Error ? error.message : String(error)
        });
        viewportEvidenceRefs.push(evidenceId);
        failedChecks.push(`${viewport.name}:measurement`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }

  findings.push(...measurementRecords.flatMap((record) => findingsFromMeasurements(record.measurement, record.evidenceRefs)));
  const finishedAtMs = Date.now();
  const finishedAt = new Date(finishedAtMs).toISOString();
  const status: RunStatus = failedChecks.length > 0 ? "partial" : "success";
  const auditResult: AuditResult = {
    schemaVersion: SCHEMA_VERSION,
    harnessVersion: HARNESS_VERSION,
    runId,
    target: {
      schemaVersion: SCHEMA_VERSION,
      kind: "url",
      url: options.url
    },
    viewportPresets,
    evidenceAssets,
    findings,
    advisoryScore: scoreFindings(findings),
    timings: {
      startedAt,
      finishedAt,
      durationMs: finishedAtMs - startedAtMs
    },
    status,
    failedChecks
  };
  const outputFiles = [
    "metadata.json",
    "audit.json",
    "report.md",
    "report-manifest.json",
    ...evidenceAssets
      .filter((asset) => asset.type === "screenshot" && asset.path)
      .map((asset) => asset.path as string)
  ];
  const metadata: RunMetadata = {
    schemaVersion: SCHEMA_VERSION,
    harnessVersion: HARNESS_VERSION,
    runId,
    status,
    targetUrl: options.url,
    startedAt,
    finishedAt,
    durationMs: finishedAtMs - startedAtMs,
    viewportPresets,
    toolVersions: {
      "@design-harness/core": HARNESS_VERSION,
      "@design-harness/visual-audit": HARNESS_VERSION,
      playwright: browserVersion ?? "unknown"
    },
    browserVersion,
    outputFiles,
    failedChecks
  };

  return {
    auditResult,
    metadata
  };
}

function createRunId(isoTimestamp: string): string {
  return isoTimestamp.replaceAll(":", "").replaceAll(".", "").replace("T", "-").replace("Z", "Z");
}

function addFailureEvidence(evidenceAssets: EvidenceAsset[], viewport: string, checkName: string, data: Record<string, unknown>): string {
  const id = `failure-${viewport}-${checkName}-${evidenceAssets.length + 1}`;
  evidenceAssets.push({
    id,
    type: "measurement",
    viewport,
    data: {
      checkName,
      ...data
    },
    createdAt: new Date().toISOString()
  });
  return id;
}

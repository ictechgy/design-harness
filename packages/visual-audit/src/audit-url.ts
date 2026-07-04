import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_VIEWPORT_PRESETS,
  HARNESS_VERSION,
  SCHEMA_VERSION,
  scoreFindings,
  type AuditResult,
  type EvidenceAsset,
  type RunMetadata,
  type RunStatus,
  type ViewportPreset
} from "@design-harness/core";
import { chromium, errors } from "playwright";
import { collectViewportMeasurements } from "./browser-measurements.js";
import { findingsFromMeasurements, type ViewportMeasurements } from "./checks.js";
import { BrowserUnavailableError } from "./errors.js";

export interface AuditUrlOptions {
  url: string;
  outDir: string;
  runId?: string;
  timeoutMs?: number;
  viewportPresets?: ViewportPreset[];
}

export interface AuditUrlResult {
  auditResult: AuditResult;
  metadata: RunMetadata;
}

export async function auditUrl(options: AuditUrlOptions): Promise<AuditUrlResult> {
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const runId = options.runId ?? createRunId(startedAt);
  const timeoutMs = options.timeoutMs ?? 15_000;
  const viewportPresets = options.viewportPresets ?? DEFAULT_VIEWPORT_PRESETS;
  const screenshotsDir = join(options.outDir, "screenshots");
  const evidenceAssets: EvidenceAsset[] = [];
  const measurements: ViewportMeasurements[] = [];
  const failedChecks: string[] = [];

  await mkdir(screenshotsDir, { recursive: true });

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    throw new BrowserUnavailableError(
      [
        "Playwright Chromium could not be launched.",
        "Run `pnpm exec playwright install chromium` and try again.",
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

      page.setDefaultTimeout(timeoutMs);
      page.setDefaultNavigationTimeout(timeoutMs);

      try {
        await page.goto(options.url, {
          waitUntil: "domcontentloaded",
          timeout: timeoutMs
        });
      } catch (error) {
        failedChecks.push(`${viewport.name}:page-timeout-or-navigation`);
        if (!(error instanceof errors.TimeoutError)) {
          failedChecks.push(`${viewport.name}:navigation-error`);
        }
      }

      await page.evaluate((viewportName) => {
        document.documentElement.dataset.designHarnessViewport = viewportName;
      }, viewport.name);

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
      } catch (error) {
        failedChecks.push(`${viewport.name}:screenshot`);
      }

      try {
        const measurement = await collectViewportMeasurements(page);
        measurements.push(measurement);
        evidenceAssets.push({
          id: `measurement-${viewport.name}`,
          type: "measurement",
          viewport: viewport.name,
          data: measurement as unknown as Record<string, unknown>,
          createdAt: new Date().toISOString()
        });
      } catch (error) {
        failedChecks.push(`${viewport.name}:measurement`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }

  const findings = measurements.flatMap((measurement) =>
    findingsFromMeasurements(measurement, `screenshot-${measurement.viewport}`, `measurement-${measurement.viewport}`)
  );
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
    status
  };
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
    outputFiles: [
      "metadata.json",
      "audit.json",
      "report.md",
      "screenshots/desktop.png",
      "screenshots/mobile.png"
    ],
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

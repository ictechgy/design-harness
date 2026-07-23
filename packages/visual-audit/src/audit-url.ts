import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_VIEWPORT_PRESETS,
  HARNESS_VERSION,
  SCHEMA_VERSION,
  scoreFindings,
  type AuditNotice,
  type AuditResult,
  type CopyStyle,
  type EvidenceAsset,
  type Finding,
  type FontFamilyAdherencePolicy,
  type RunMetadata,
  type RunStatus,
  type ViewportPreset,
  type LayoutMetrics
} from "@design-harness/core";
import { analyzeCopy, copyAuditCapabilityNotices } from "@design-harness/copy-audit";
import { chromium, errors } from "playwright";
import {
  collectViewportMeasurements,
  type FontFamilyMeasurementError,
  type ViewportCollectionResult,
  type ViewportMeasurementConfig
} from "./browser-measurements.js";
import { createRenderFailureFinding, findingsFromMeasurements, type ViewportMeasurements } from "./checks.js";
import { BrowserUnavailableError } from "./errors.js";
import { findingSamplesTruncatedNotice } from "./finding-coverage.js";
import {
  analyzeFontFamilyAdherence,
  type FontFamilyAdherenceAnalysisError
} from "./font-family-adherence.js";

const MAX_ARIA_SNAPSHOT_LENGTH = 20_000;
const MAX_TEXT_INVENTORY_FIELD_LENGTH = 2_000;
const CONTRAST_SKIP_AGGREGATE_MESSAGE =
  "Some elements whose painted contrast could not be determined from computed styles were skipped; "
  + "no contrast finding was emitted for them.";

export interface AuditUrlOptions {
  url: string;
  outDir: string;
  runId?: string;
  timeoutMs?: number;
  viewportPresets?: ViewportPreset[];
  copyStyle?: CopyStyle;
  fontFamilyPolicy?: FontFamilyAdherencePolicy;
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
  locator?: (selector: string) => {
    ariaSnapshot?: () => Promise<string>;
  };
  screenshot(options: { path: string; fullPage: boolean }): Promise<unknown>;
  ariaSnapshot?: () => Promise<string>;
  close(): Promise<void>;
}

interface MeasurementRecord {
  measurement: ViewportMeasurements;
  evidenceRefs: string[];
}

interface SensitiveInputMask {
  marker: string;
  value: string;
}

interface ContrastSkipViewportNotice {
  viewport: string;
  skippedElementCount: number;
  skippedByReason: Record<string, number>;
}

export async function auditUrl(options: AuditUrlOptions): Promise<AuditUrlResult> {
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const runId = options.runId ?? createRunId(startedAt);
  const timeoutMs = options.timeoutMs ?? 15_000;
  const viewportPresets = options.viewportPresets ?? DEFAULT_VIEWPORT_PRESETS;
  const measurementConfig = viewportMeasurementConfig(options.copyStyle, options.fontFamilyPolicy);
  const screenshotsDir = join(options.outDir, "screenshots");
  const evidenceAssets: EvidenceAsset[] = [];
  const measurementRecords: MeasurementRecord[] = [];
  const findings: Finding[] = [];
  const failedChecks: string[] = [];
  const layoutMetrics: LayoutMetrics[] = [];
  const noticeCandidates: AuditNotice[] = options.copyStyle
    ? copyAuditCapabilityNotices(options.copyStyle)
    : [];

  await mkdir(screenshotsDir, { recursive: true });

  let browser;
  try {
    browser = options.launchBrowser ? await options.launchBrowser() : ((await chromium.launch({ headless: true })) as BrowserHandle);
  } catch (error) {
    throw new BrowserUnavailableError(
      [
        "Playwright Chromium could not be launched.",
        "Install Chromium for Playwright with `npx playwright install chromium`, or run `pnpm playwright:install` from a Design Harness checkout.",
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

      try {
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
          continue;
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
          const collection = await collectViewportMeasurements(page, measurementConfig);
          const measurement = collection.measurements;
          if (collection.findingCoverage) {
            measurement.findingCoverage = collection.findingCoverage;
          }
          noticeCandidates.push(...collection.notices);
          if (collection.layoutMetrics) {
            layoutMetrics.push(collection.layoutMetrics);
          }
          if (options.fontFamilyPolicy) {
            const fontFamilyFailure = applyFontFamilyAdherence(
              collection,
              options.fontFamilyPolicy
            );
            if (fontFamilyFailure) {
              stripFontFamilyEvidence(measurement);
              failedChecks.push(`${viewport.name}:unapproved-font-family`);
              const details = fontFamilyFailureDetails(viewport.name, fontFamilyFailure);
              noticeCandidates.push({
                code: "font-family-adherence-measurement-failed",
                message: "Font-family adherence could not be evaluated for this viewport.",
                viewport: viewport.name,
                details
              });
              viewportEvidenceRefs.push(addFailureEvidence(
                evidenceAssets,
                viewport.name,
                "unapproved-font-family",
                details
              ));
            }
          }
          const measurementEvidenceId = `measurement-${viewport.name}`;
          evidenceAssets.push({
            id: measurementEvidenceId,
            type: "measurement",
            viewport: viewport.name,
            data: measurementEvidenceData(measurement),
            createdAt: new Date().toISOString()
          });
          viewportEvidenceRefs.push(measurementEvidenceId);
          const textInventoryEvidenceId = `text-inventory-${viewport.name}`;
          evidenceAssets.push({
            id: textInventoryEvidenceId,
            type: "text-inventory",
            viewport: viewport.name,
            data: textInventoryEvidenceData(measurement),
            createdAt: new Date().toISOString()
          });
          viewportEvidenceRefs.push(textInventoryEvidenceId);
          if (options.copyStyle) {
            findings.push(...analyzeCopy({
              viewport: measurement.viewport,
              evidenceRef: textInventoryEvidenceId,
              items: measurement.textInventory
            }, options.copyStyle));
          }
          viewportEvidenceRefs.push(...await recordAriaSnapshotEvidence(page, evidenceAssets, viewport.name, failedChecks));
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
        }
      } finally {
        try {
          await page.close();
        } catch (error) {
          addFailureEvidence(evidenceAssets, viewport.name, "page-close", {
            message: error instanceof Error ? error.message : String(error)
          });
          failedChecks.push(`${viewport.name}:page-close`);
        }
      }
    }
  } finally {
    await browser.close();
  }

  findings.push(...measurementRecords.flatMap((record) => findingsFromMeasurements(record.measurement, record.evidenceRefs)));
  const truncationNotice = findingSamplesTruncatedNotice(
    measurementRecords.flatMap(({ measurement }) => (
      measurement.findingCoverage ? [measurement.findingCoverage] : []
    ))
  );
  if (truncationNotice) {
    noticeCandidates.push(truncationNotice);
  }
  const finishedAtMs = Date.now();
  const finishedAt = new Date(finishedAtMs).toISOString();
  const status: RunStatus = failedChecks.length > 0 ? "partial" : "success";
  const notices = deduplicateNotices(noticeCandidates);
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
    failedChecks,
    ...(notices.length > 0 ? { notices } : {}),
    ...(layoutMetrics.length > 0 ? { layoutMetrics } : {})
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
      ...(options.copyStyle ? { "@design-harness/copy-audit": HARNESS_VERSION } : {}),
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

type FontFamilyScopedFailure =
  | FontFamilyMeasurementError
  | FontFamilyAdherenceAnalysisError
  | { code: "missing-collection-result" };

function applyFontFamilyAdherence(
  collection: ViewportCollectionResult,
  policy: FontFamilyAdherencePolicy
): FontFamilyScopedFailure | undefined {
  if (collection.fontFamilyError) {
    return collection.fontFamilyError;
  }
  if (!collection.fontFamilyCollection) {
    return { code: "missing-collection-result" };
  }
  const result = analyzeFontFamilyAdherence(
    collection.measurements.textInventory,
    policy,
    collection.fontFamilyCollection
  );
  if (!result.ok) {
    return result.error;
  }
  collection.measurements.fontFamilyAdherence = result.summary;
  return undefined;
}

function stripFontFamilyEvidence(measurement: ViewportMeasurements): void {
  delete measurement.fontFamilyAdherence;
  for (const item of measurement.textInventory) {
    delete item.fontFamily;
  }
}

function fontFamilyFailureDetails(
  viewport: string,
  failure: FontFamilyScopedFailure
): Record<string, unknown> {
  return {
    viewport,
    reasonCode: failure.code,
    ...("selectorIndex" in failure && failure.selectorIndex !== undefined
      ? { selectorIndex: failure.selectorIndex }
      : {}),
    ...("elementIndex" in failure && failure.elementIndex !== undefined
      ? { elementIndex: failure.elementIndex }
      : {}),
    ...("candidateCount" in failure && failure.candidateCount !== undefined
      ? { candidateCount: failure.candidateCount }
      : {}),
    ...("valueLength" in failure && failure.valueLength !== undefined
      ? { valueLength: failure.valueLength }
      : {}),
    ...("limit" in failure && failure.limit !== undefined ? { limit: failure.limit } : {}),
    ...("parserCode" in failure && failure.parserCode !== undefined
      ? { parserCode: failure.parserCode }
      : {})
  };
}

function viewportMeasurementConfig(
  copyStyle: CopyStyle | undefined,
  fontFamilyPolicy: FontFamilyAdherencePolicy | undefined
): ViewportMeasurementConfig | undefined {
  const surfaceMapping = copyStyle?.surfaceMapping;
  if (!surfaceMapping && !fontFamilyPolicy) {
    return undefined;
  }
  return {
    ...(surfaceMapping ? { surfaceMapping } : {}),
    ...(fontFamilyPolicy ? {
      fontFamily: { ignoreSelectors: [...fontFamilyPolicy.ignoreSelectors] }
    } : {})
  };
}

function createRunId(isoTimestamp: string): string {
  return isoTimestamp.replaceAll(":", "").replaceAll(".", "").replace("T", "-").replace("Z", "Z");
}

function measurementEvidenceData(measurement: ViewportMeasurements): Record<string, unknown> {
  const { textInventory: _textInventory, ...measurementWithoutTextInventory } = measurement;
  return measurementWithoutTextInventory as unknown as Record<string, unknown>;
}

function textInventoryEvidenceData(measurement: ViewportMeasurements): Record<string, unknown> {
  const items = measurement.textInventory.map((item) => {
    const text = truncateText(item.text, MAX_TEXT_INVENTORY_FIELD_LENGTH);
    const accessibleName = truncateText(item.accessibleName, MAX_TEXT_INVENTORY_FIELD_LENGTH);
    const truncated = Boolean(item.truncated || text.truncated || accessibleName.truncated);
    return {
      ...item,
      text: text.text,
      accessibleName: accessibleName.text,
      ...(truncated ? { truncated: true as const } : {})
    };
  });
  const truncatedCount = items.filter((item) => item.truncated).length;
  return {
    viewport: measurement.viewport,
    count: items.length,
    truncatedCount,
    items
  };
}

function deduplicateNotices(notices: AuditNotice[]): AuditNotice[] {
  const deduplicated = new Map<string, AuditNotice>();
  const contrastSkipViewports = new Map<string, ContrastSkipViewportNotice>();
  const contrastSkipKey = "contrast-elements-skipped\u0000aggregated-viewports";

  for (const notice of notices) {
    const contrastSkipViewport = contrastSkipViewportNotice(notice);
    if (contrastSkipViewport) {
      if (!deduplicated.has(contrastSkipKey)) {
        deduplicated.set(contrastSkipKey, {
          code: notice.code,
          message: CONTRAST_SKIP_AGGREGATE_MESSAGE
        });
      }
      if (!contrastSkipViewports.has(contrastSkipViewport.viewport)) {
        contrastSkipViewports.set(contrastSkipViewport.viewport, contrastSkipViewport);
      }
      continue;
    }

    const details = notice.details === undefined
      ? undefined
      : canonicalizeJsonValue(notice.details) as Record<string, unknown>;
    const key = `${notice.code}\u0000${JSON.stringify(details ?? null)}`;
    if (!deduplicated.has(key)) {
      deduplicated.set(key, {
        code: notice.code,
        message: notice.message,
        ...(details === undefined ? {} : { details })
      });
    }
  }

  if (contrastSkipViewports.size > 0) {
    const notice = deduplicated.get(contrastSkipKey);
    if (notice) {
      deduplicated.set(contrastSkipKey, {
        ...notice,
        details: {
          viewports: [...contrastSkipViewports.values()]
            .sort((left, right) => compareUtf16(left.viewport, right.viewport))
        }
      });
    }
  }

  return [...deduplicated.values()];
}

function contrastSkipViewportNotice(notice: AuditNotice): ContrastSkipViewportNotice | undefined {
  if (
    notice.code !== "contrast-elements-skipped"
    || !notice.viewport
    || !notice.details
  ) {
    return undefined;
  }

  const skippedElementCount = notice.details.skippedElementCount;
  const skippedByReason = notice.details.skippedByReason;
  if (
    typeof skippedElementCount !== "number"
    || !Number.isInteger(skippedElementCount)
    || skippedElementCount < 0
    || skippedByReason === null
    || typeof skippedByReason !== "object"
    || Array.isArray(skippedByReason)
    || Object.values(skippedByReason).some((count) => (
      typeof count !== "number" || !Number.isInteger(count) || count < 0
    ))
  ) {
    return undefined;
  }

  return {
    viewport: notice.viewport,
    skippedElementCount,
    skippedByReason: canonicalizeJsonValue(skippedByReason) as Record<string, number>
  };
}

function canonicalizeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeJsonValue);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalizeJsonValue(child)])
    );
  }
  return value;
}

function compareUtf16(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function recordAriaSnapshotEvidence(
  page: PageHandle,
  evidenceAssets: EvidenceAsset[],
  viewport: string,
  failedChecks: string[]
): Promise<string[]> {
  const ariaSnapshot = ariaSnapshotFnForPage(page);
  if (!ariaSnapshot) {
    return [];
  }

  const evidenceRefs: string[] = [];
  let maskedSensitiveValues: SensitiveInputMask[] = [];
  try {
    maskedSensitiveValues = await maskSensitiveInputValues(page);
    const rawSnapshot = await ariaSnapshot();
    const snapshot = truncateText(rawSnapshot, MAX_ARIA_SNAPSHOT_LENGTH);
    const evidenceId = `aria-snapshot-${viewport}`;
    evidenceAssets.push({
      id: evidenceId,
      type: "aria-snapshot",
      viewport,
      data: {
        viewport,
        format: "playwright-aria-yaml",
        snapshot: snapshot.text,
        ...(snapshot.truncated ? { truncated: true } : {})
      },
      createdAt: new Date().toISOString()
    });
    evidenceRefs.push(evidenceId);
  } catch (error) {
    const evidenceId = addFailureEvidence(evidenceAssets, viewport, "aria-snapshot", {
      message: error instanceof Error ? error.message : String(error)
    });
    failedChecks.push(`${viewport}:aria-snapshot`);
    evidenceRefs.push(evidenceId);
  } finally {
    if (maskedSensitiveValues.length > 0) {
      try {
        await restoreSensitiveInputValues(page, maskedSensitiveValues);
      } catch (error) {
        const evidenceId = addFailureEvidence(evidenceAssets, viewport, "aria-snapshot-restore", {
          message: error instanceof Error ? error.message : String(error)
        });
        failedChecks.push(`${viewport}:aria-snapshot-restore`);
        evidenceRefs.push(evidenceId);
      }
    }
  }

  return evidenceRefs;
}

function ariaSnapshotFnForPage(page: PageHandle): (() => Promise<string>) | undefined {
  const bodyLocator = page.locator?.("body");
  if (bodyLocator && typeof bodyLocator.ariaSnapshot === "function") {
    return () => bodyLocator.ariaSnapshot?.() ?? Promise.resolve("");
  }

  if (typeof page.ariaSnapshot === "function") {
    return () => page.ariaSnapshot?.() ?? Promise.resolve("");
  }

  return undefined;
}

async function maskSensitiveInputValues(page: PageHandle): Promise<SensitiveInputMask[]> {
  return page.evaluate(() => {
    const markerAttribute = "data-design-harness-mask-id";
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("input[type='password']"));
    const snapshots = inputs.map((input, index) => ({
      marker: `dh-${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2)}`,
      value: input.value
    }));

    try {
      for (const [index, input] of inputs.entries()) {
        input.setAttribute(markerAttribute, snapshots[index]?.marker ?? "");
        input.value = "";
      }
    } catch (error) {
      for (const [index, input] of inputs.entries()) {
        input.value = snapshots[index]?.value ?? "";
        input.removeAttribute(markerAttribute);
      }
      throw error;
    }
    return snapshots;
  });
}

async function restoreSensitiveInputValues(page: PageHandle, snapshots: SensitiveInputMask[]): Promise<void> {
  await page.evaluate((arg) => {
    const markerAttribute = "data-design-harness-mask-id";
    const maskedInputs = Array.isArray(arg) ? arg : [];
    for (const snapshot of maskedInputs) {
      if (
        typeof snapshot !== "object" ||
        snapshot === null ||
        !("marker" in snapshot) ||
        !("value" in snapshot) ||
        typeof snapshot.marker !== "string" ||
        typeof snapshot.value !== "string"
      ) {
        continue;
      }
      const input = document.querySelector<HTMLInputElement>(`input[${markerAttribute}="${snapshot.marker}"]`);
      if (input) {
        input.value = snapshot.value;
        input.removeAttribute(markerAttribute);
      }
    }
  }, snapshots);
}

function truncateText(text: string, maxLength: number): { text: string; truncated: boolean } {
  if (text.length <= maxLength) {
    return { text, truncated: false };
  }
  return { text: text.slice(0, maxLength), truncated: true };
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

import { HARNESS_VERSION, SCHEMA_VERSION } from "./version.js";
import { CRITERIA } from "./criteria.js";
import type { AuditResult, Criterion, DesignBrief, Finding, ReportManifest, RunMetadata } from "./types.js";
import { DEFAULT_VIEWPORT_PRESETS } from "./viewport-presets.js";
import { scoreFindings } from "./scoring.js";

export function createExampleBrief(): DesignBrief {
  return {
    schemaVersion: SCHEMA_VERSION,
    title: "Merchant dashboard",
    summary: "A compact dashboard for local merchants to inspect daily demand.",
    goals: ["Help merchants understand today's performance"],
    targetUsers: ["Local shop owner"],
    constraints: ["Must work on mobile and desktop"],
    successCriteria: ["Primary metrics are visible without horizontal scrolling"]
  };
}

export function createExampleFinding(): Finding {
  return {
    id: "finding-desktop-overflow",
    category: "responsiveness",
    severity: "medium",
    confidence: "high",
    viewport: "desktop",
    evidenceRefs: ["screenshot-desktop", "measurement-desktop"],
    problem: "The document width appears wider than the desktop viewport.",
    recommendation: "Constrain wide content and remove unintended horizontal overflow.",
    checkName: "horizontal-overflow",
    criterionId: "responsive.horizontal-overflow.none",
    sourceRefs: ["wcag-2-2", "govuk-layout"],
    determinism: "deterministic",
    resultKind: "risk",
    runtime: "viewport-sweep",
    observed: {
      documentScrollWidth: 1500,
      viewportWidth: 1440
    },
    expected: "Document and body scroll widths stay within the viewport width.",
    humanReviewRecommended: false
  };
}

export function createExampleCriterion(): Criterion {
  return CRITERIA[0];
}

export function createExampleAuditResult(): AuditResult {
  const finding = createExampleFinding();
  return {
    schemaVersion: SCHEMA_VERSION,
    harnessVersion: HARNESS_VERSION,
    runId: "example-run",
    target: {
      schemaVersion: SCHEMA_VERSION,
      kind: "url",
      url: "http://localhost:3000",
      name: "Example"
    },
    viewportPresets: DEFAULT_VIEWPORT_PRESETS,
    evidenceAssets: [
      {
        id: "screenshot-desktop",
        type: "screenshot",
        path: "screenshots/desktop.png",
        viewport: "desktop",
        createdAt: "2026-01-01T00:00:00.000Z"
      },
      {
        id: "measurement-desktop",
        type: "measurement",
        viewport: "desktop",
        data: {
          scrollWidth: 1500,
          viewportWidth: 1440
        },
        createdAt: "2026-01-01T00:00:00.000Z"
      }
    ],
    findings: [finding],
    advisoryScore: scoreFindings([finding]),
    timings: {
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:00:01.000Z",
      durationMs: 1000
    },
    status: "success",
    failedChecks: []
  };
}

export function createExampleMetadata(): RunMetadata {
  const auditResult = createExampleAuditResult();
  return {
    schemaVersion: SCHEMA_VERSION,
    harnessVersion: HARNESS_VERSION,
    runId: auditResult.runId,
    status: auditResult.status,
    targetUrl: auditResult.target.url,
    startedAt: auditResult.timings.startedAt,
    finishedAt: auditResult.timings.finishedAt,
    durationMs: auditResult.timings.durationMs,
    viewportPresets: auditResult.viewportPresets,
    toolVersions: {
      "@design-harness/core": HARNESS_VERSION
    },
    browserVersion: "example",
    outputFiles: ["metadata.json", "audit.json", "report.md", "report-manifest.json", "screenshots/desktop.png"],
    failedChecks: []
  };
}

export function createExampleReportManifest(): ReportManifest {
  return {
    schemaVersion: SCHEMA_VERSION,
    harnessVersion: HARNESS_VERSION,
    runId: "example-run",
    format: "markdown",
    reportPath: "report.md",
    sourceAuditPath: "audit.json",
    sections: [
      "Run Summary",
      "Advisory Score",
      "Findings",
      "Source-Backed Criteria",
      "Evidence Links",
      "Recommendations",
      "Iteration Prompt Scaffold",
      "Optional Subjective Critique"
    ],
    createdAt: "2026-01-01T00:00:00.000Z"
  };
}

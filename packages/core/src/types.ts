export type RubricCategory =
  | "layout"
  | "hierarchy"
  | "interaction"
  | "accessibility"
  | "responsiveness"
  | "visual-polish"
  | "task-fit";

export type Severity = "low" | "medium" | "high" | "critical";
export type Confidence = "low" | "medium" | "high";
export type RunStatus = "success" | "partial" | "failed";

export interface DesignBrief {
  schemaVersion: string;
  title: string;
  summary?: string;
  goals: string[];
  targetUsers: string[];
  constraints?: string[];
  successCriteria?: string[];
}

export interface AuditTarget {
  schemaVersion: string;
  kind: "url";
  url: string;
  name?: string;
}

export interface ViewportPreset {
  name: string;
  width: number;
  height: number;
  deviceScaleFactor: number;
  isMobile: boolean;
}

export interface FindingRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Finding {
  id: string;
  category: RubricCategory;
  severity: Severity;
  confidence: Confidence;
  viewport: string;
  selector?: string;
  region?: FindingRegion;
  evidenceRefs: string[];
  problem: string;
  recommendation: string;
  checkName: string;
}

export type EvidenceAssetType =
  | "screenshot"
  | "dom-summary"
  | "console-summary"
  | "network-summary"
  | "measurement";

export interface EvidenceAsset {
  id: string;
  type: EvidenceAssetType;
  path?: string;
  data?: Record<string, unknown>;
  viewport?: string;
  createdAt: string;
}

export interface ScoreDeduction {
  findingId: string;
  points: number;
  reason: string;
}

export interface AdvisoryScore {
  value: number;
  max: number;
  band: "strong" | "usable" | "needs-work" | "blocked";
  deductions: ScoreDeduction[];
  explanation: string;
}

export interface AuditTimings {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

export interface AuditResult {
  schemaVersion: string;
  harnessVersion: string;
  runId: string;
  target: AuditTarget;
  viewportPresets: ViewportPreset[];
  evidenceAssets: EvidenceAsset[];
  findings: Finding[];
  advisoryScore: AdvisoryScore;
  timings: AuditTimings;
  status: RunStatus;
}

export interface Critique {
  schemaVersion: string;
  harnessVersion: string;
  id: string;
  auditRunId: string;
  provider?: string;
  summary: string;
  evidenceRefs: string[];
  recommendations: string[];
  createdAt: string;
}

export interface ReportManifest {
  schemaVersion: string;
  harnessVersion: string;
  runId: string;
  format: "markdown";
  reportPath: string;
  sourceAuditPath: string;
  sections: string[];
  createdAt: string;
}

export interface RunMetadata {
  schemaVersion: string;
  harnessVersion: string;
  runId: string;
  status: RunStatus;
  targetUrl: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  viewportPresets: ViewportPreset[];
  toolVersions: Record<string, string>;
  browserVersion?: string;
  outputFiles: string[];
  failedChecks: string[];
}

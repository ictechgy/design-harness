export type RubricCategory =
  | "layout"
  | "hierarchy"
  | "interaction"
  | "accessibility"
  | "content"
  | "responsiveness"
  | "visual-polish"
  | "task-fit";

export type Severity = "low" | "medium" | "high" | "critical";
export type Confidence = "low" | "medium" | "high";
export type RunStatus = "success" | "partial" | "failed";
export type SourceStrength =
  | "official-testable"
  | "official-pattern"
  | "industry-heuristic"
  | "research-emerging"
  | "philosophical"
  | "project-contract";
export type FindingDeterminism = "deterministic" | "heuristic" | "subjective";
export type FindingResultKind = "failure" | "risk" | "needs-review";
export type CheckRuntime =
  | "static-dom"
  | "computed-style"
  | "viewport-sweep"
  | "interaction-simulation"
  | "human-review"
  | "model-judged";

export type FindingObservation = string | number | boolean | null | Record<string, unknown> | unknown[];

export interface CriterionSource {
  id: string;
  title: string;
  url: string;
  strength: SourceStrength;
  note?: string;
  /**
   * Machine-readable clause references keyed by criterion id, e.g.
   * { "a11y.text-contrast.minimum": ["1.4.3"] } on the wcag-2-2 source.
   * Kept on the source (not the criterion) so a future standard remap
   * (WCAG 3.0, KWCAG) is a new source entry with its own mapping.
   */
  clausesByCriterion?: Record<string, string[]>;
}

export interface Criterion {
  id: string;
  category: RubricCategory;
  title: string;
  description: string;
  sourceRefs: string[];
  sourceStrength: SourceStrength;
  determinism: FindingDeterminism;
  resultKind: FindingResultKind;
  confidenceDefault: Confidence;
  runtime: CheckRuntime;
  checkNames: string[];
  remediationHint: string;
}

export interface DesignBrief {
  schemaVersion: string;
  title: string;
  summary?: string;
  goals: string[];
  targetUsers: string[];
  constraints?: string[];
  successCriteria?: string[];
}

export type CopySurface = "button" | "error" | "marketing" | "body";
export type CopyRegister = "haeyoche" | "hapsyoche" | "noun-form" | "banmal";
export type GlossaryTier = "approved" | "banned" | "use-carefully";
export type GlossaryMatchMode = "literal" | "lemma";
export type JosaHedgePolicy = "flag" | "allow";

export interface CopyStyleSurfaceRule {
  selectors?: string[];
  roles?: string[];
  tags?: string[];
  regions?: string[];
  ariaLive?: boolean;
}

export type CopyStyleSurfaceMap<T> = Partial<Record<CopySurface, T>>;

export interface CopyStyleGlossaryTerm {
  term: string;
  tier: GlossaryTier;
  preferredTerm?: string;
  match?: GlossaryMatchMode;
  surfaces?: CopySurface[];
  note?: string;
}

export interface CopyStyleBannedPhrase {
  phrase: string;
  suggestedReplacement?: string;
  surfaces?: CopySurface[];
  reason?: string;
}

export interface CopyStyle {
  schemaVersion: string;
  locale: string;
  josaHedgePolicy?: JosaHedgePolicy;
  surfaceRegisters?: CopyStyleSurfaceMap<CopyRegister>;
  surfaceMapping?: CopyStyleSurfaceMap<CopyStyleSurfaceRule>;
  glossary?: CopyStyleGlossaryTerm[];
  bannedPhrases?: CopyStyleBannedPhrase[];
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
  criterionId?: string;
  sourceRefs?: string[];
  determinism?: FindingDeterminism;
  resultKind?: FindingResultKind;
  runtime?: CheckRuntime;
  observed?: FindingObservation;
  expected?: FindingObservation;
  humanReviewRecommended?: boolean;
}

export type EvidenceAssetType =
  | "screenshot"
  | "dom-summary"
  | "console-summary"
  | "network-summary"
  | "measurement"
  | "text-inventory"
  | "aria-snapshot";

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
  formulaVersion: "epistemic-weight-v1";
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
  failedChecks: string[];
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

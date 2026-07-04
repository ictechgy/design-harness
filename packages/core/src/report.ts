import { verdictForScore } from "./scoring.js";
import { getCriterion, getSource } from "./criteria.js";
import type { AuditResult, Critique, Finding } from "./types.js";

export interface RenderReportInput {
  auditResult: AuditResult;
  critique?: Critique;
}

export function renderMarkdownReport(input: RenderReportInput): string {
  const { auditResult, critique } = input;
  const sections = [
    "# Design Harness Audit Report",
    renderRunSummary(auditResult),
    renderFailedChecks(auditResult),
    renderScore(auditResult),
    renderFindings(auditResult.findings),
    renderSourceBackedCriteria(auditResult.findings),
    renderEvidence(auditResult),
    renderRecommendations(auditResult.findings),
    renderIterationPrompt(auditResult),
    renderOptionalCritique(critique)
  ];

  return `${sections.filter(Boolean).join("\n\n")}\n`;
}

function renderFailedChecks(auditResult: AuditResult): string {
  if (auditResult.failedChecks.length === 0) {
    return "";
  }

  return [
    "## Failed Checks",
    "",
    ...auditResult.failedChecks.map((failedCheck) => `- ${failedCheck}`)
  ].join("\n");
}

export function buildIterationPrompt(auditResult: AuditResult): string {
  const topFindings = auditResult.findings.slice(0, 5);
  const findingLines = topFindings.length
    ? topFindings.map((finding) => {
        const implementationArea = implementationAreaFor(finding);
        const criterion = finding.criterionId ? ` Criterion: ${finding.criterionId}.` : "";
        return `- ${implementationArea}: ${finding.id}: ${finding.problem}${criterion} Recommendation: ${finding.recommendation}`;
      }).join("\n")
    : "- No blocking deterministic findings were detected. Improve polish while preserving the current layout stability.";

  return [
    "You are improving a UI using Design Harness evidence.",
    `Target URL: ${auditResult.target.url}`,
    `Run ID: ${auditResult.runId}`,
    "Use the deterministic findings below as evidence, then make one focused revision pass.",
    findingLines,
    "After revising, rerun the audit and compare the new report against this one."
  ].join("\n");
}

function renderRunSummary(auditResult: AuditResult): string {
  return [
    "## Run Summary",
    "",
    `- Run ID: \`${auditResult.runId}\``,
    `- Target: ${auditResult.target.url}`,
    `- Status: \`${auditResult.status}\``,
    `- Started: ${auditResult.timings.startedAt}`,
    `- Duration: ${auditResult.timings.durationMs}ms`,
    `- Viewports: ${auditResult.viewportPresets.map((viewport) => `${viewport.name} (${viewport.width}x${viewport.height})`).join(", ")}`
  ].join("\n");
}

function renderScore(auditResult: AuditResult): string {
  return [
    "## Advisory Score",
    "",
    `**${auditResult.advisoryScore.value}/${auditResult.advisoryScore.max}** (${auditResult.advisoryScore.band})`,
    "",
    `Verdict: ${verdictForScore(auditResult.advisoryScore)}`,
    "",
    `Note: ${auditResult.advisoryScore.explanation}`
  ].join("\n");
}

function renderFindings(findings: Finding[]): string {
  if (findings.length === 0) {
    return [
      "## Findings",
      "",
      "No blocking deterministic findings were detected."
    ].join("\n");
  }

  const groupedFindings = groupFindings(findings);
  const sections = [
    "## Findings",
    "",
    renderFindingGroup("Deterministic Findings: Failures", groupedFindings.deterministicFailures),
    renderFindingGroup("Deterministic Findings: Risks", groupedFindings.deterministicRisks),
    renderFindingGroup("Heuristic Review Prompts", groupedFindings.heuristicFindings),
    renderFindingGroup("Subjective Review Notes", groupedFindings.subjectiveFindings),
    renderFindingGroup("Legacy Findings", groupedFindings.legacyFindings)
  ].filter(Boolean);

  return sections.join("\n\n");
}

function renderFindingGroup(title: string, findings: Finding[]): string {
  if (findings.length === 0) {
    return "";
  }

  const rows = findings.map((finding) =>
    [
      finding.id,
      finding.severity,
      finding.confidence,
      finding.category,
      finding.viewport,
      finding.determinism ?? "legacy",
      finding.resultKind ?? "finding",
      finding.criterionId ?? "",
      escapeTable(finding.problem),
      finding.evidenceRefs.map((ref) => `\`${ref}\``).join(", ")
    ].join(" | ")
  );

  return [
    `### ${title}`,
    "",
    "| ID | Severity | Confidence | Category | Viewport | Determinism | Result | Criterion | Problem | Evidence |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map((row) => `| ${row} |`)
  ].join("\n");
}

function renderSourceBackedCriteria(findings: Finding[]): string {
  const criterionIds = unique(findings.map((finding) => finding.criterionId).filter(isString));
  if (criterionIds.length === 0) {
    return [
      "## Source-Backed Criteria",
      "",
      "No source-backed criteria were attached to this audit."
    ].join("\n");
  }

  const lines = criterionIds.map((criterionId) => {
    const criterion = getCriterion(criterionId);
    if (!criterion) {
      return `- \`${criterionId}\`: criterion metadata was not found.`;
    }

    const sources = criterion.sourceRefs
      .map((sourceRef) => {
        const source = getSource(sourceRef);
        return source ? `[${escapeInline(source.title)}](${source.url}) (${source.strength})` : sourceRef;
      })
      .join("; ");

    return `- \`${criterion.id}\` (${criterion.determinism}/${criterion.resultKind}, ${criterion.runtime}): ${criterion.title}. Sources: ${sources}.`;
  });

  return [
    "## Source-Backed Criteria",
    "",
    ...lines
  ].join("\n");
}

function renderEvidence(auditResult: AuditResult): string {
  const lines = auditResult.evidenceAssets.map((asset) => {
    const location = asset.path ? asset.path : JSON.stringify(asset.data ?? {});
    return `- \`${asset.id}\` (${asset.type}${asset.viewport ? `, ${asset.viewport}` : ""}): ${location}`;
  });

  return [
    "## Evidence Links",
    "",
    ...(lines.length ? lines : ["- No evidence assets were recorded."])
  ].join("\n");
}

function renderRecommendations(findings: Finding[]): string {
  const recommendations = findings.map((finding) => {
    const criterion = finding.criterionId ? ` Criterion: \`${finding.criterionId}\`.` : "";
    const evidence = finding.evidenceRefs.length ? ` Evidence: ${finding.evidenceRefs.map((ref) => `\`${ref}\``).join(", ")}.` : "";
    return `- \`${finding.id}\`: ${finding.recommendation}${criterion}${evidence}`;
  });
  return [
    "## Recommendations",
    "",
    ...(recommendations.length ? recommendations : ["- Keep the current structure and continue with human visual review."])
  ].join("\n");
}

function renderIterationPrompt(auditResult: AuditResult): string {
  return [
    "## Iteration Prompt Scaffold",
    "",
    "```text",
    buildIterationPrompt(auditResult),
    "```"
  ].join("\n");
}

function renderOptionalCritique(critique?: Critique): string {
  if (!critique) {
    return [
      "## Optional Subjective Critique",
      "",
      "No subjective critique was supplied. This report only contains deterministic audit findings."
    ].join("\n");
  }

  return [
    "## Optional Subjective Critique",
    "",
    critique.summary,
    "",
    ...critique.recommendations.map((recommendation) => `- ${recommendation}`)
  ].join("\n");
}

function escapeTable(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function escapeInline(value: string): string {
  return value.replaceAll("[", "\\[").replaceAll("]", "\\]");
}

function groupFindings(findings: Finding[]): {
  deterministicFailures: Finding[];
  deterministicRisks: Finding[];
  heuristicFindings: Finding[];
  subjectiveFindings: Finding[];
  legacyFindings: Finding[];
} {
  return {
    deterministicFailures: findings.filter((finding) => finding.determinism === "deterministic" && finding.resultKind === "failure"),
    deterministicRisks: findings.filter((finding) => finding.determinism === "deterministic" && finding.resultKind !== "failure"),
    heuristicFindings: findings.filter((finding) => finding.determinism === "heuristic"),
    subjectiveFindings: findings.filter((finding) => finding.determinism === "subjective"),
    legacyFindings: findings.filter((finding) => !finding.determinism)
  };
}

function implementationAreaFor(finding: Finding): string {
  switch (finding.category) {
    case "accessibility":
      return "semantics";
    case "responsiveness":
    case "layout":
      return "layout";
    case "interaction":
      return "interaction state";
    case "task-fit":
      return "content";
    case "hierarchy":
      return "structure";
    case "visual-polish":
      return "visual polish";
  }
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

const OVERCLAIM_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "WCAG compliant", pattern: /\bWCAG compliant\b/i },
  { label: "good design", pattern: /\bgood design\b/i },
  { label: "best practice violation", pattern: /\bbest practice violation\b/i },
  { label: "objectively better", pattern: /\bobjectively better\b/i },
  { label: "unqualified accessible claim", pattern: /\b(?:is|are|was|were|looks|seems|appears)\s+accessible\b/i }
];

export function validateReportCopyGuardrails(report: string): string[] {
  return OVERCLAIM_PATTERNS
    .filter(({ pattern }) => pattern.test(report))
    .map(({ label }) => label);
}

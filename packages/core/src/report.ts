import { verdictForScore } from "./scoring.js";
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
    ? topFindings.map((finding) => `- ${finding.id}: ${finding.problem} Recommendation: ${finding.recommendation}`).join("\n")
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
      "## Deterministic Findings",
      "",
      "No blocking deterministic findings were detected."
    ].join("\n");
  }

  const rows = findings.map((finding) =>
    [
      finding.id,
      finding.severity,
      finding.confidence,
      finding.category,
      finding.viewport,
      escapeTable(finding.problem),
      finding.evidenceRefs.map((ref) => `\`${ref}\``).join(", ")
    ].join(" | ")
  );

  return [
    "## Deterministic Findings",
    "",
    "| ID | Severity | Confidence | Category | Viewport | Problem | Evidence |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map((row) => `| ${row} |`)
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
  const recommendations = findings.map((finding) => `- ${finding.recommendation}`);
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

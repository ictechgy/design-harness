import { verdictForScore } from "./scoring.js";
import { getCriterion, getSource } from "./criteria.js";
import type { AuditResult, Critique, Finding } from "./types.js";

export interface RenderReportInput {
  auditResult: AuditResult;
  critique?: Critique;
}

export interface MarkdownReport {
  markdown: string;
  sections: string[];
}

interface MarkdownReportSection {
  title: string;
  body: string;
}

export function buildMarkdownReport(input: RenderReportInput): MarkdownReport {
  const { auditResult, critique } = input;
  const sections = [
    reportSection("Run Summary", renderRunSummary(auditResult)),
    reportSection("Failed Checks", renderFailedChecks(auditResult)),
    reportSection("Notices", renderNotices(auditResult)),
    reportSection("Advisory Score", renderScore(auditResult)),
    reportSection("Findings", renderFindings(auditResult.findings)),
    reportSection("Source-Backed Criteria", renderSourceBackedCriteria(auditResult.findings)),
    reportSection("Evidence Links", renderEvidence(auditResult)),
    reportSection("Recommendations", renderRecommendations(auditResult.findings)),
    reportSection("Iteration Prompt Scaffold", renderIterationPrompt(auditResult)),
    reportSection("Optional Subjective Critique", renderOptionalCritique(critique, auditResult.findings))
  ].filter(isReportSection);

  return {
    markdown: `${[
      "# Design Harness Audit Report",
      ...sections.map((section) => `## ${section.title}\n\n${section.body}`)
    ].join("\n\n")}\n`,
    sections: sections.map((section) => section.title)
  };
}

export function renderMarkdownReport(input: RenderReportInput): string {
  return buildMarkdownReport(input).markdown;
}

function reportSection(title: string, body: string): MarkdownReportSection | undefined {
  return body ? { title, body } : undefined;
}

function isReportSection(section: MarkdownReportSection | undefined): section is MarkdownReportSection {
  return section !== undefined;
}

function renderNotices(auditResult: AuditResult): string {
  if (!auditResult.notices?.length) {
    return "";
  }

  const lines = auditResult.notices.map((notice) => {
    const viewport = notice.viewport ? ` (viewport: \`${escapeInline(notice.viewport)}\`)` : "";
    const details = notice.details ? ` Details: \`${escapeInline(JSON.stringify(notice.details))}\`.` : "";
    return `- \`${escapeInline(notice.code)}\`${viewport}: ${notice.message}${details}`;
  });

  return [
    "These configuration and capability notices are informational and do not affect the audit score or status.",
    "",
    ...lines
  ].join("\n");
}

function renderFailedChecks(auditResult: AuditResult): string {
  if (auditResult.failedChecks.length === 0) {
    return "";
  }

  return auditResult.failedChecks.map((failedCheck) => `- ${failedCheck}`).join("\n");
}

export function buildIterationPrompt(auditResult: AuditResult): string {
  const topFindings = selectIterationPromptFindings(auditResult.findings);
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

const ITERATION_PROMPT_SEVERITY_RANK: Record<Finding["severity"], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3
};

const ITERATION_PROMPT_CONFIDENCE_RANK: Record<Finding["confidence"], number> = {
  high: 0,
  medium: 1,
  low: 2
};

function selectIterationPromptFindings(findings: readonly Finding[]): Finding[] {
  return findings
    .map((finding, producerIndex) => ({ finding, producerIndex }))
    .filter(({ finding }) => (
      finding.determinism === "deterministic" &&
      (finding.resultKind === "failure" || finding.resultKind === "risk")
    ))
    .sort((left, right) => (
      iterationPromptPriorityGroup(left.finding) - iterationPromptPriorityGroup(right.finding) ||
      ITERATION_PROMPT_SEVERITY_RANK[left.finding.severity] - ITERATION_PROMPT_SEVERITY_RANK[right.finding.severity] ||
      ITERATION_PROMPT_CONFIDENCE_RANK[left.finding.confidence] - ITERATION_PROMPT_CONFIDENCE_RANK[right.finding.confidence] ||
      left.producerIndex - right.producerIndex
    ))
    .slice(0, 5)
    .map(({ finding }) => finding);
}

function iterationPromptPriorityGroup(finding: Finding): number {
  if (
    finding.resultKind === "failure" &&
    (finding.checkName === "render-failure" || finding.checkName === "blank-render")
  ) {
    return 0;
  }
  if (finding.resultKind === "failure") {
    return 1;
  }
  return finding.confidence === "low" ? 3 : 2;
}

function renderRunSummary(auditResult: AuditResult): string {
  return [
    `- Run ID: \`${auditResult.runId}\``,
    `- Target: ${auditResult.target.url}`,
    `- Status: \`${auditResult.status}\``,
    `- Started: ${auditResult.timings.startedAt}`,
    `- Duration: ${auditResult.timings.durationMs}ms`,
    `- Viewports: ${auditResult.viewportPresets.map((viewport) => `${viewport.name} (${viewport.width}x${viewport.height})`).join(", ")}`
  ].join("\n");
}

function renderScore(auditResult: AuditResult): string {
  const score = auditResult.advisoryScore;
  const formulaLines = score.formulaVersion === "epistemic-criterion-max-v2"
    ? renderV2ScoreDetails(auditResult)
    : [
        "- Deduction model: legacy per-finding deductions.",
        "- Compatibility: formula versions have different semantics; v1 and v2 values are not directly comparable."
      ];

  return [
    `**${auditResult.advisoryScore.value}/${auditResult.advisoryScore.max}** (${auditResult.advisoryScore.band})`,
    "",
    `- Formula: \`${score.formulaVersion}\``,
    ...formulaLines,
    "",
    `Verdict: ${verdictForScore(auditResult.advisoryScore, auditResult.findings)}`,
    "",
    `Note: ${auditResult.advisoryScore.explanation}`
  ].join("\n");
}

function renderV2ScoreDetails(auditResult: AuditResult): string[] {
  const score = auditResult.advisoryScore;
  if (score.formulaVersion !== "epistemic-criterion-max-v2") {
    return [];
  }

  const findingsById = new Map(auditResult.findings.map((finding) => [finding.id, finding]));
  const saturation = score.saturated
    ? "yes — the grouped pre-floor deduction exceeds 100, so the displayed value is floored at 0."
    : "no — the grouped pre-floor deduction does not exceed 100.";
  const deductions = score.deductions.length === 0
    ? ["- Grouped deductions: none."]
    : [
        "- Grouped deductions:",
        ...score.deductions.map((deduction) => {
          const representative = findingsById.get(deduction.findingId);
          if (!representative) {
            throw new Error(
              `Advisory score deduction references unknown representative ${deduction.findingId}.`
            );
          }
          const groupKey = representative.criterionId ?? representative.checkName;
          const occurrenceCount = deduction.findingIds.length;
          const viewports = deduction.viewports.map((viewport) => `\`${escapeInline(viewport)}\``).join(", ");
          return `  - \`${escapeInline(groupKey)}\`: ${deduction.points} points; ${occurrenceCount} ${occurrenceCount === 1 ? "occurrence" : "occurrences"}; viewports: ${viewports}; representative: \`${escapeInline(deduction.findingId)}\`. ${deduction.reason}`;
        })
      ];

  return [
    "- Deduction model: one maximum scoreable occurrence per criterion, with legacy findings grouped by check name.",
    `- Grouped pre-floor total deduction: ${score.totalDeduction}`,
    `- Saturation: ${saturation}`,
    "- Compatibility: formula versions have different semantics; v1 and v2 values are not directly comparable.",
    ...deductions
  ];
}

function renderFindings(findings: Finding[]): string {
  if (findings.length === 0) {
    return "No blocking deterministic findings were detected.";
  }

  const groupedFindings = groupFindings(findings);
  const sections = [
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
    return "No source-backed criteria were attached to this audit.";
  }

  const lines = criterionIds.map((criterionId) => {
    const criterion = getCriterion(criterionId);
    if (!criterion) {
      return `- \`${criterionId}\`: criterion metadata was not found.`;
    }

    const usedSourceRefs = unique(
      findings
        .filter((finding) => finding.criterionId === criterionId)
        .flatMap((finding) => finding.sourceRefs ?? [])
    );
    const sources = usedSourceRefs
      .map((sourceRef) => {
        const source = getSource(sourceRef);
        return source ? `[${escapeInline(source.title)}](${source.url}) (${source.strength})` : sourceRef;
      })
      .join("; ") || "none recorded";

    return `- \`${criterion.id}\` (${criterion.determinism}/${criterion.resultKind}, ${criterion.runtime}): ${criterion.title}. Sources used by emitted findings: ${sources}.`;
  });

  return [
    ...lines
  ].join("\n");
}

function renderEvidence(auditResult: AuditResult): string {
  const lines = auditResult.evidenceAssets.map((asset) => {
    const location = asset.path ? asset.path : JSON.stringify(asset.data ?? {});
    return `- \`${asset.id}\` (${asset.type}${asset.viewport ? `, ${asset.viewport}` : ""}): ${location}`;
  });

  return [
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
    ...(recommendations.length ? recommendations : ["- Keep the current structure and continue with human visual review."])
  ].join("\n");
}

function renderIterationPrompt(auditResult: AuditResult): string {
  return [
    "```text",
    buildIterationPrompt(auditResult),
    "```"
  ].join("\n");
}

function renderOptionalCritique(critique: Critique | undefined, findings: Finding[]): string {
  if (!critique) {
    // Only claim "deterministic only" when it is true. A heuristic, subjective, or legacy finding makes
    // that claim false, and the report renders those in their own sections — so the critique note must not
    // contradict them (HARD RULE 1).
    const hasNonDeterministic = findings.some(
      (finding) => finding.determinism === "heuristic" || finding.determinism === "subjective" || !finding.determinism
    );
    return hasNonDeterministic
      ? "No subjective critique was supplied. The findings above are shown with their recorded classifications."
      : "No subjective critique was supplied. This report only contains deterministic audit findings.";
  }

  return [
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
    case "content":
      return "content";
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

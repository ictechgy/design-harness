import { getCriterion, getSource } from "./criteria.js";
import { scoreFindings } from "./scoring.js";
import type { AdvisoryScoreV2, AuditResult, Critique, Finding } from "./types.js";

export interface IntegrityIssue {
  path: string;
  message: string;
}

export interface IntegrityResult {
  valid: boolean;
  issues: IntegrityIssue[];
}

export class IntegrityValidationError extends Error {
  constructor(public readonly issues: IntegrityIssue[]) {
    super(`Audit artifact integrity failed: ${issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`);
    this.name = "IntegrityValidationError";
  }
}

export function validateAuditResultIntegrity(auditResult: AuditResult): IntegrityResult {
  const issues: IntegrityIssue[] = [];
  const viewportNames = new Set<string>();
  const evidenceIds = new Set<string>();
  const findingIds = new Set<string>();

  auditResult.viewportPresets.forEach((viewport, index) => {
    if (viewportNames.has(viewport.name)) {
      issues.push({ path: `$.viewportPresets[${index}].name`, message: `duplicates viewport ${viewport.name}` });
    }
    viewportNames.add(viewport.name);
  });

  auditResult.evidenceAssets.forEach((asset, index) => {
    if (evidenceIds.has(asset.id)) {
      issues.push({ path: `$.evidenceAssets[${index}].id`, message: `duplicates evidence asset ${asset.id}` });
    }
    evidenceIds.add(asset.id);

    if (asset.viewport && !viewportNames.has(asset.viewport)) {
      issues.push({ path: `$.evidenceAssets[${index}].viewport`, message: `references unknown viewport ${asset.viewport}` });
    }

    if (!asset.path && !asset.data) {
      issues.push({ path: `$.evidenceAssets[${index}]`, message: "must include path or data" });
    }
  });

  auditResult.findings.forEach((finding, index) => {
    if (findingIds.has(finding.id)) {
      issues.push({ path: `$.findings[${index}].id`, message: `duplicates finding ${finding.id}` });
    }
    findingIds.add(finding.id);

    if (!viewportNames.has(finding.viewport)) {
      issues.push({ path: `$.findings[${index}].viewport`, message: `references unknown viewport ${finding.viewport}` });
    }

    finding.evidenceRefs.forEach((evidenceRef, refIndex) => {
      if (!evidenceIds.has(evidenceRef)) {
        issues.push({ path: `$.findings[${index}].evidenceRefs[${refIndex}]`, message: `references unknown evidence asset ${evidenceRef}` });
      }
    });

    if (finding.criterionId) {
      const criterion = getCriterion(finding.criterionId);
      if (!criterion) {
        issues.push({ path: `$.findings[${index}].criterionId`, message: `references unknown criterion ${finding.criterionId}` });
      } else {
        if (finding.checkName && !criterion.checkNames.includes(finding.checkName)) {
          issues.push({
            path: `$.findings[${index}].checkName`,
            message: `does not match criterion ${finding.criterionId}`
          });
        }

        finding.sourceRefs?.forEach((sourceRef, sourceIndex) => {
          if (!criterion.sourceRefs.includes(sourceRef)) {
            issues.push({
              path: `$.findings[${index}].sourceRefs[${sourceIndex}]`,
              message: `is not declared by criterion ${finding.criterionId}`
            });
          }
        });
      }

      if (!finding.sourceRefs || finding.sourceRefs.length === 0) {
        issues.push({ path: `$.findings[${index}].sourceRefs`, message: "is required when criterionId is present" });
      }

      if (!finding.determinism) {
        issues.push({ path: `$.findings[${index}].determinism`, message: "is required when criterionId is present" });
      }

      if (!finding.resultKind) {
        issues.push({ path: `$.findings[${index}].resultKind`, message: "is required when criterionId is present" });
      }

    }

    finding.sourceRefs?.forEach((sourceRef, sourceIndex) => {
      if (!getSource(sourceRef)) {
        issues.push({ path: `$.findings[${index}].sourceRefs[${sourceIndex}]`, message: `references unknown source ${sourceRef}` });
      }
    });

    if (finding.determinism === "subjective" && finding.resultKind === "failure") {
      issues.push({ path: `$.findings[${index}].resultKind`, message: "subjective findings cannot be failures" });
    }

    if (finding.determinism === "heuristic" && finding.resultKind === "failure") {
      issues.push({ path: `$.findings[${index}].resultKind`, message: "heuristic findings must be risks or needs-review" });
    }
  });

  validateAdvisoryScoreIntegrity(auditResult, findingIds, issues);

  return {
    valid: issues.length === 0,
    issues
  };
}

function validateAdvisoryScoreIntegrity(
  auditResult: AuditResult,
  findingIds: ReadonlySet<string>,
  issues: IntegrityIssue[]
): void {
  const formulaVersion = (auditResult.advisoryScore as { formulaVersion?: unknown }).formulaVersion;

  if (formulaVersion === "epistemic-weight-v1") {
    auditResult.advisoryScore.deductions.forEach((deduction, index) => {
      if (!findingIds.has(deduction.findingId)) {
        issues.push({
          path: `$.advisoryScore.deductions[${index}].findingId`,
          message: `references unknown finding ${deduction.findingId}`
        });
      }
    });
    return;
  }

  if (formulaVersion !== "epistemic-criterion-max-v2") {
    issues.push({
      path: "$.advisoryScore.formulaVersion",
      message: `uses unsupported formula ${String(formulaVersion)}`
    });
    return;
  }

  validateV2AdvisoryScore(auditResult.advisoryScore as AdvisoryScoreV2, auditResult.findings, findingIds, issues);
}

function validateV2AdvisoryScore(
  actual: AdvisoryScoreV2,
  findings: readonly Finding[],
  findingIds: ReadonlySet<string>,
  issues: IntegrityIssue[]
): void {
  const findingsById = new Map(findings.map((finding) => [finding.id, finding]));
  const assignedFindingIds = new Set<string>();

  actual.deductions.forEach((deduction, deductionIndex) => {
    const deductionPath = `$.advisoryScore.deductions[${deductionIndex}]`;
    if (!findingIds.has(deduction.findingId)) {
      issues.push({
        path: `${deductionPath}.findingId`,
        message: `references unknown finding ${deduction.findingId}`
      });
    }

    const localFindingIds = new Set<string>();
    deduction.findingIds.forEach((findingId, findingIndex) => {
      const findingPath = `${deductionPath}.findingIds[${findingIndex}]`;
      if (localFindingIds.has(findingId)) {
        issues.push({ path: findingPath, message: `duplicates finding ${findingId} within the deduction` });
      }
      localFindingIds.add(findingId);

      if (assignedFindingIds.has(findingId)) {
        issues.push({ path: findingPath, message: `assigns finding ${findingId} to more than one deduction` });
      }
      assignedFindingIds.add(findingId);

      const finding = findingsById.get(findingId);
      if (!finding) {
        issues.push({ path: findingPath, message: `references unknown finding ${findingId}` });
      } else if (finding.resultKind === "needs-review") {
        issues.push({ path: findingPath, message: `references score-exempt needs-review finding ${findingId}` });
      }
    });
  });

  const expected = scoreFindings(findings);
  const actualRepresentatives = actual.deductions.map((deduction) => deduction.findingId);
  const expectedRepresentatives = expected.deductions.map((deduction) => deduction.findingId);

  if (!sameStrings(actualRepresentatives, expectedRepresentatives)) {
    issues.push({
      path: "$.advisoryScore.deductions",
      message: "must contain one canonical representative per scoreable group in UTF-16 code-unit group-key order"
    });
  }

  if (actual.deductions.length !== expected.deductions.length) {
    issues.push({
      path: "$.advisoryScore.deductions",
      message: `must contain ${expected.deductions.length} criterion/check-name deduction groups`
    });
  }

  const comparisonLength = Math.min(actual.deductions.length, expected.deductions.length);
  for (let index = 0; index < comparisonLength; index += 1) {
    const actualDeduction = actual.deductions[index];
    const expectedDeduction = expected.deductions[index];
    const path = `$.advisoryScore.deductions[${index}]`;

    if (actualDeduction.findingId !== expectedDeduction.findingId) {
      issues.push({
        path: `${path}.findingId`,
        message: `must be maximum-point representative ${expectedDeduction.findingId}`
      });
    }
    if (!sameStrings(actualDeduction.findingIds, expectedDeduction.findingIds)) {
      issues.push({
        path: `${path}.findingIds`,
        message: "must equal complete scoreable group membership in UTF-16 code-unit order"
      });
    }
    if (!sameStrings(actualDeduction.viewports, expectedDeduction.viewports)) {
      issues.push({
        path: `${path}.viewports`,
        message: "must equal the group's unique viewports in UTF-16 code-unit order"
      });
    }
    if (actualDeduction.points !== expectedDeduction.points) {
      issues.push({
        path: `${path}.points`,
        message: `must equal grouped maximum ${expectedDeduction.points}`
      });
    }
  }

  if (actual.max !== expected.max) {
    issues.push({ path: "$.advisoryScore.max", message: `must equal ${expected.max}` });
  }
  if (actual.totalDeduction !== expected.totalDeduction) {
    issues.push({
      path: "$.advisoryScore.totalDeduction",
      message: `must equal rounded grouped deduction total ${expected.totalDeduction}`
    });
  }
  if (actual.saturated !== expected.saturated) {
    issues.push({
      path: "$.advisoryScore.saturated",
      message: `must equal ${expected.saturated} for total deduction ${expected.totalDeduction}`
    });
  }
  if (actual.value !== expected.value) {
    issues.push({ path: "$.advisoryScore.value", message: `must equal recomputed value ${expected.value}` });
  }
  if (actual.band !== expected.band) {
    issues.push({ path: "$.advisoryScore.band", message: `must equal recomputed band ${expected.band}` });
  }
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function assertAuditResultIntegrity(auditResult: AuditResult): void {
  const result = validateAuditResultIntegrity(auditResult);
  if (!result.valid) {
    throw new IntegrityValidationError(result.issues);
  }
}

export function validateCritiqueIntegrity(critique: Critique, auditResult: AuditResult): IntegrityResult {
  const evidenceIds = new Set(auditResult.evidenceAssets.map((asset) => asset.id));
  const issues: IntegrityIssue[] = [];

  if (critique.auditRunId !== auditResult.runId) {
    issues.push({ path: "$.auditRunId", message: `must match audit run ${auditResult.runId}` });
  }

  critique.evidenceRefs.forEach((evidenceRef, index) => {
    if (!evidenceIds.has(evidenceRef)) {
      issues.push({ path: `$.evidenceRefs[${index}]`, message: `references unknown evidence asset ${evidenceRef}` });
    }
  });

  return {
    valid: issues.length === 0,
    issues
  };
}

export function assertCritiqueIntegrity(critique: Critique, auditResult: AuditResult): void {
  const result = validateCritiqueIntegrity(critique, auditResult);
  if (!result.valid) {
    throw new IntegrityValidationError(result.issues);
  }
}

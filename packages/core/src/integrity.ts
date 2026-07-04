import type { AuditResult, Critique } from "./types.js";

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
  });

  auditResult.advisoryScore.deductions.forEach((deduction, index) => {
    if (!findingIds.has(deduction.findingId)) {
      issues.push({ path: `$.advisoryScore.deductions[${index}].findingId`, message: `references unknown finding ${deduction.findingId}` });
    }
  });

  return {
    valid: issues.length === 0,
    issues
  };
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

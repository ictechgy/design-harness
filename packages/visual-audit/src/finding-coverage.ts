import type { AuditNotice, Finding } from "@design-harness/core";

export interface FindingCoverageEntry {
  checkName: string;
  capGroup?: string;
  detectedCount: number;
  emittedCount: number;
  omittedCount: number;
  limit: number;
}

export interface FindingCoverage {
  viewport: string;
  entries: FindingCoverageEntry[];
}

export const FINDING_COVERAGE_CHECK_NAMES = [
  "text-clipping",
  "missing-accessible-name",
  "missing-form-label",
  "missing-image-alt",
  "empty-heading",
  "heading-level-skip",
  "duplicate-h1",
  "ambiguous-repeated-label",
  "fixed-width-risk",
  "sticky-obstruction-risk",
  "excessive-line-length",
  "form-error-association-risk",
  "color-only-state-risk",
  "disabled-without-explanation",
  "status-live-region-risk",
  "modal-focus-risk",
  "custom-control-semantics-risk",
  "moving-content-control-risk",
  "dom-contrast-risk",
  "tap-target-risk"
] as const;

const FINDING_COVERAGE_CHECK_NAME_SET = new Set<string>(FINDING_COVERAGE_CHECK_NAMES);
const HEADING_CHECK_NAMES = new Set<string>([
  "empty-heading",
  "heading-level-skip",
  "duplicate-h1"
]);
const FINDING_MATERIALIZATION_LIMIT = 5;

export class FindingCoverageValidationError extends Error {
  constructor(message: string) {
    super(`Invalid finding coverage: ${message}`);
    this.name = "FindingCoverageValidationError";
  }
}

/**
 * Validates the optional diagnostic against the findings actually materialized for one viewport.
 * Coverage is additive, but once present it is an exact inventory rather than a best-effort sample.
 */
export function assertFindingCoverageIntegrity(
  coverage: FindingCoverage | undefined,
  expectedViewport: string,
  materializedFindings: readonly Finding[]
): void {
  if (coverage === undefined) {
    return;
  }
  if (!isRecord(coverage)) {
    invalid("coverage must be an object");
  }
  if (coverage.viewport !== expectedViewport) {
    invalid(`viewport ${JSON.stringify(coverage.viewport)} does not match ${JSON.stringify(expectedViewport)}`);
  }
  if (!Array.isArray(coverage.entries)) {
    invalid("entries must be an array");
  }
  if (coverage.entries.length !== FINDING_COVERAGE_CHECK_NAMES.length) {
    invalid(`entries must contain exactly ${FINDING_COVERAGE_CHECK_NAMES.length} checks`);
  }

  const entriesByCheck = new Map<string, FindingCoverageEntry>();
  for (const [index, entry] of coverage.entries.entries()) {
    validateEntry(entry, index);
    if (entriesByCheck.has(entry.checkName)) {
      invalid(`duplicate checkName ${JSON.stringify(entry.checkName)}`);
    }
    entriesByCheck.set(entry.checkName, entry);
  }

  for (const checkName of FINDING_COVERAGE_CHECK_NAMES) {
    if (!entriesByCheck.has(checkName)) {
      invalid(`missing checkName ${JSON.stringify(checkName)}`);
    }
  }

  const emittedCounts = new Map<string, number>();
  for (const finding of materializedFindings) {
    if (FINDING_COVERAGE_CHECK_NAME_SET.has(finding.checkName)) {
      emittedCounts.set(finding.checkName, (emittedCounts.get(finding.checkName) ?? 0) + 1);
    }
  }

  for (const checkName of FINDING_COVERAGE_CHECK_NAMES) {
    const entry = entriesByCheck.get(checkName) as FindingCoverageEntry;
    const actualEmittedCount = emittedCounts.get(checkName) ?? 0;
    if (entry.emittedCount !== actualEmittedCount) {
      invalid(
        `${JSON.stringify(checkName)} emittedCount ${entry.emittedCount} does not match ${actualEmittedCount} materialized findings`
      );
    }
  }

  const headingEmittedCount = [...HEADING_CHECK_NAMES]
    .reduce((sum, checkName) => sum + (entriesByCheck.get(checkName)?.emittedCount ?? 0), 0);
  if (headingEmittedCount > FINDING_MATERIALIZATION_LIMIT) {
    invalid(`capGroup "headingIssues" emitted ${headingEmittedCount} findings, exceeding limit ${FINDING_MATERIALIZATION_LIMIT}`);
  }
}

export function findingSamplesTruncatedNotice(
  coverages: readonly FindingCoverage[]
): AuditNotice | undefined {
  const viewports = coverages
    .map((coverage) => ({
      viewport: coverage.viewport,
      checks: coverage.entries
        .filter((entry) => entry.omittedCount > 0)
        .map((entry) => ({ ...entry }))
        .sort((left, right) => compareUtf16(left.checkName, right.checkName))
    }))
    .filter(({ checks }) => checks.length > 0)
    .sort((left, right) => compareUtf16(left.viewport, right.viewport));

  if (viewports.length === 0) {
    return undefined;
  }

  return {
    code: "finding-samples-truncated",
    message: "Some detected findings exceed the bounded sample count materialized in this audit.",
    details: { viewports }
  };
}

function validateEntry(entry: FindingCoverageEntry, index: number): void {
  if (!isRecord(entry)) {
    invalid(`entries[${index}] must be an object`);
  }
  if (typeof entry.checkName !== "string" || !FINDING_COVERAGE_CHECK_NAME_SET.has(entry.checkName)) {
    invalid(`entries[${index}].checkName is not in the capped-check inventory`);
  }

  const expectedCapGroup = HEADING_CHECK_NAMES.has(entry.checkName) ? "headingIssues" : undefined;
  if (entry.capGroup !== expectedCapGroup) {
    invalid(
      `${JSON.stringify(entry.checkName)} capGroup must be ${expectedCapGroup === undefined ? "absent" : JSON.stringify(expectedCapGroup)}`
    );
  }

  for (const field of ["detectedCount", "emittedCount", "omittedCount", "limit"] as const) {
    const value = entry[field];
    if (!Number.isInteger(value)) {
      invalid(`${JSON.stringify(entry.checkName)} ${field} must be an integer`);
    }
    if (field === "limit" ? value <= 0 : value < 0) {
      invalid(`${JSON.stringify(entry.checkName)} ${field} is out of range`);
    }
  }
  if (entry.limit !== FINDING_MATERIALIZATION_LIMIT) {
    invalid(`${JSON.stringify(entry.checkName)} limit must be ${FINDING_MATERIALIZATION_LIMIT}`);
  }
  if (entry.detectedCount !== entry.emittedCount + entry.omittedCount) {
    invalid(`${JSON.stringify(entry.checkName)} detectedCount must equal emittedCount + omittedCount`);
  }
  if (entry.emittedCount > entry.limit) {
    invalid(`${JSON.stringify(entry.checkName)} emittedCount exceeds limit`);
  }
}

function compareUtf16(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(message: string): never {
  throw new FindingCoverageValidationError(message);
}

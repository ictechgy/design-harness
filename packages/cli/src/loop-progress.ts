import { createHash } from "node:crypto";
import type { Finding } from "@design-harness/core";

export const FAILURE_PROGRESS_VERSION = "failure-progress-v1" as const;

export interface FailureProgress {
  version: typeof FAILURE_PROGRESS_VERSION;
  count: number;
  fingerprint: string;
}

type FailureTuple = [criterionId: string, checkName: string, viewport: string, selector: string];

/**
 * Fingerprints only the stable identity and multiplicity of deterministic failures.
 *
 * Finding ids and presentation/evidence fields are deliberately absent: regenerated audit artifacts must
 * not look like progress unless the failure criterion, check, viewport, selector, or multiplicity changed.
 */
export function computeDeterministicFailureProgress(findings: readonly Finding[]): FailureProgress {
  const tuples = findings
    .filter((finding) => finding.determinism === "deterministic" && finding.resultKind === "failure")
    .map((finding): FailureTuple => [
      finding.criterionId ?? "",
      finding.checkName,
      finding.viewport,
      finding.selector ?? ""
    ])
    .sort(compareFailureTuples);
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(tuples), "utf8")
    .digest("hex");
  return {
    version: FAILURE_PROGRESS_VERSION,
    count: tuples.length,
    fingerprint
  };
}

function compareFailureTuples(left: FailureTuple, right: FailureTuple): number {
  for (let index = 0; index < left.length; index += 1) {
    const compared = compareUtf16(left[index], right[index]);
    if (compared !== 0) {
      return compared;
    }
  }
  return 0;
}

function compareUtf16(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

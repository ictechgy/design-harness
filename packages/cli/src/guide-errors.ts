export type GuideFailurePhase =
  | "args"
  | "read"
  | "size"
  | "decode"
  | "parse"
  | "parse-policy"
  | "schema"
  | "profile"
  | "sanitize"
  | "contradiction"
  | "budget"
  | "marker"
  | "ownership"
  | "containment"
  | "concurrent-change"
  | "stage-write"
  | "commit"
  | "rollback";

export interface GuideSecondaryFailure {
  phase: GuideFailurePhase;
  path: string;
  detail: string;
}

export class GuideOperationError extends Error {
  constructor(
    public readonly phase: GuideFailurePhase,
    public readonly path: string,
    public readonly detail: string,
    public readonly secondaryFailures: readonly GuideSecondaryFailure[] = []
  ) {
    super(formatGuideError(phase, path, detail, secondaryFailures));
    this.name = "GuideOperationError";
  }
}

export function formatGuideError(
  phase: GuideFailurePhase,
  path: string,
  detail: string,
  secondaryFailures: readonly GuideSecondaryFailure[] = []
): string {
  const primary = `Guide ${phase} error at ${path}: ${detail}`;
  if (secondaryFailures.length === 0) {
    return primary;
  }
  return [
    primary,
    "Secondary cleanup failures:",
    ...secondaryFailures.map((failure) => (
      `- [${failure.phase}] ${failure.path}: ${failure.detail}`
    ))
  ].join("\n");
}

export function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

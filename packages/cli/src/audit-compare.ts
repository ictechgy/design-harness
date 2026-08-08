import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import {
  assertAuditResultIntegrity,
  assertValidSchema,
  type AuditResult,
  type Finding
} from "@design-harness/core";

export const MAX_COMPARE_AUDIT_BYTES = 8 * 1024 * 1024;

const COMPARE_READ_CHUNK_BYTES = 64 * 1024;
const TRUNCATED_FINDING_NOTICE = "finding-samples-truncated";

export type AuditCompareStage =
  | "read"
  | "size"
  | "decode"
  | "parse"
  | "schema"
  | "integrity"
  | "completeness"
  | "comparability"
  | "identity";

export class AuditCompareError extends Error {
  constructor(
    public readonly stage: AuditCompareStage,
    public readonly inputPath: string | undefined,
    public readonly detail: string
  ) {
    super(inputPath
      ? `Compare ${stage} error at ${inputPath}: ${detail}`
      : `Compare ${stage} error: ${detail}`);
    this.name = "AuditCompareError";
  }
}

export interface CompareAuditFileStats {
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  isFile(): boolean;
}

export interface CompareAuditFileHandle {
  stat(): Promise<CompareAuditFileStats>;
  read(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number | null
  ): Promise<{ bytesRead: number }>;
  close(): Promise<void>;
}

export interface AuditCompareDependencies {
  openFile?: (path: string) => Promise<CompareAuditFileHandle>;
}

export interface AuditCompareInput {
  beforePath: string;
  afterPath: string;
}

export type FailureObservationKey = readonly [
  criterionId: string,
  checkName: string,
  viewport: string,
  selector: string
];

export interface FailureObservationGroup {
  key: FailureObservationKey;
  count: number;
}

export interface AuditComparison {
  beforeCount: number;
  afterCount: number;
  sameKeyCount: number;
  beforeOnlyCount: number;
  afterOnlyCount: number;
  sameKey: FailureObservationGroup[];
  beforeOnly: FailureObservationGroup[];
  afterOnly: FailureObservationGroup[];
  markdown: string;
}

/**
 * Loads two complete compatible local audit artifacts and compares only the
 * stable key multiset of their deterministic failure findings.
 */
export async function runAuditComparison(
  input: AuditCompareInput,
  dependencies: AuditCompareDependencies = {}
): Promise<AuditComparison> {
  const before = await loadCompareAudit(input.beforePath, dependencies);
  const after = await loadCompareAudit(input.afterPath, dependencies);
  return compareAuditResults(before, after, input.beforePath, input.afterPath);
}

/** @internal Compares audit values that already passed schema and integrity validation. */
export function compareAuditResults(
  before: AuditResult,
  after: AuditResult,
  beforePath = "--before",
  afterPath = "--after"
): AuditComparison {
  assertComparableAudits(before, after);

  const beforeGroups = deterministicFailureGroups(before, beforePath);
  const afterGroups = deterministicFailureGroups(after, afterPath);
  const comparison = compareFailureGroups(beforeGroups, afterGroups);
  return {
    ...comparison,
    markdown: renderAuditComparison(comparison)
  };
}

export async function loadCompareAudit(
  path: string,
  dependencies: AuditCompareDependencies = {}
): Promise<AuditResult> {
  const bytes = await readCompareAuditBytes(
    path,
    dependencies.openFile ?? openCompareAuditFile
  );

  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new AuditCompareError("decode", path, "file is not valid UTF-8");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch (error) {
    throw new AuditCompareError("parse", path, `invalid JSON: ${errorMessage(error)}`);
  }

  try {
    assertValidSchema("audit-result", parsed);
  } catch (error) {
    throw new AuditCompareError("schema", path, errorMessage(error));
  }

  const audit = parsed as AuditResult;
  try {
    assertAuditResultIntegrity(audit);
  } catch (error) {
    throw new AuditCompareError("integrity", path, errorMessage(error));
  }
  assertCompleteAudit(audit, path);
  return audit;
}

/** @internal Exported so tests can lock the production read-only mode. */
export function compareAuditOpenFlags(): number {
  const nonBlocking = typeof constants.O_NONBLOCK === "number" ? constants.O_NONBLOCK : 0;
  const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
  return constants.O_RDONLY | nonBlocking | noFollow;
}

async function openCompareAuditFile(path: string): Promise<CompareAuditFileHandle> {
  return open(path, compareAuditOpenFlags());
}

async function readCompareAuditBytes(
  path: string,
  openFile: (path: string) => Promise<CompareAuditFileHandle>
): Promise<Buffer> {
  let handle: CompareAuditFileHandle | undefined;
  let primaryError: unknown;
  try {
    handle = await openFile(path);
    const before = await handle.stat();
    assertUsableStats(before, path);

    const chunks: Buffer[] = [];
    let byteCount = 0;
    while (byteCount < MAX_COMPARE_AUDIT_BYTES + 1) {
      const length = Math.min(
        COMPARE_READ_CHUNK_BYTES,
        MAX_COMPARE_AUDIT_BYTES + 1 - byteCount
      );
      const chunk = Buffer.allocUnsafe(length);
      const result = await handle.read(chunk, 0, length, null);
      if (!Number.isInteger(result.bytesRead) || result.bytesRead < 0 || result.bytesRead > length) {
        throw new Error(`file handle returned invalid byte count ${String(result.bytesRead)}`);
      }
      if (result.bytesRead === 0) {
        break;
      }
      chunks.push(chunk.subarray(0, result.bytesRead));
      byteCount += result.bytesRead;
    }

    const after = await handle.stat();
    assertUsableStats(after, path);
    if (!sameReadSnapshot(before, after)) {
      throw new AuditCompareError("read", path, "file changed during read");
    }
    if (byteCount > MAX_COMPARE_AUDIT_BYTES) {
      throw new AuditCompareError(
        "size",
        path,
        `file exceeds ${MAX_COMPARE_AUDIT_BYTES} bytes`
      );
    }
    if (byteCount !== after.size) {
      throw new AuditCompareError(
        "read",
        path,
        `file changed during read (read ${byteCount} bytes; stable size is ${after.size})`
      );
    }
    return Buffer.concat(chunks, byteCount);
  } catch (error) {
    primaryError = error;
    if (error instanceof AuditCompareError) {
      throw error;
    }
    throw new AuditCompareError("read", path, errorMessage(error));
  } finally {
    if (handle) {
      try {
        await handle.close();
      } catch (error) {
        if (!primaryError) {
          throw new AuditCompareError("read", path, `failed to close file: ${errorMessage(error)}`);
        }
      }
    }
  }
}

function assertUsableStats(stats: CompareAuditFileStats, path: string): void {
  if (!stats.isFile()) {
    throw new AuditCompareError("read", path, "path is not a regular file");
  }
  if (
    !Number.isSafeInteger(stats.size)
    || stats.size < 0
    || !Number.isFinite(stats.mtimeMs)
    || !Number.isFinite(stats.ctimeMs)
  ) {
    throw new AuditCompareError("read", path, "file metadata is invalid");
  }
}

function sameReadSnapshot(left: CompareAuditFileStats, right: CompareAuditFileStats): boolean {
  return left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

function assertCompleteAudit(audit: AuditResult, path: string): void {
  if (audit.status !== "success") {
    throw new AuditCompareError(
      "completeness",
      path,
      `audit status must be success; received ${audit.status}`
    );
  }
  if (audit.failedChecks.length !== 0) {
    throw new AuditCompareError(
      "completeness",
      path,
      `failedChecks must be empty; found ${audit.failedChecks.length}`
    );
  }
  if (audit.notices?.some(({ code }) => code === TRUNCATED_FINDING_NOTICE)) {
    throw new AuditCompareError(
      "completeness",
      path,
      `notice ${TRUNCATED_FINDING_NOTICE} makes deterministic failure samples incomplete`
    );
  }
}

/** @internal Exported so focused tests can lock every compatibility field. */
export function assertComparableAudits(before: AuditResult, after: AuditResult): void {
  if (before.schemaVersion !== after.schemaVersion) {
    throw new AuditCompareError(
      "comparability",
      undefined,
      `schemaVersion differs between --before (${before.schemaVersion}) and --after (${after.schemaVersion})`
    );
  }
  if (before.harnessVersion !== after.harnessVersion) {
    throw new AuditCompareError(
      "comparability",
      undefined,
      `harnessVersion differs between --before (${before.harnessVersion}) and --after (${after.harnessVersion})`
    );
  }
  if (!isDeepStrictEqual(before.target, after.target)) {
    throw new AuditCompareError(
      "comparability",
      undefined,
      "target differs between --before and --after"
    );
  }
  if (!isDeepStrictEqual(before.viewportPresets, after.viewportPresets)) {
    throw new AuditCompareError(
      "comparability",
      undefined,
      "viewportPresets differ between --before and --after"
    );
  }
}

function deterministicFailureGroups(
  audit: AuditResult,
  path: string
): Map<string, FailureObservationGroup> {
  const groups = new Map<string, FailureObservationGroup>();
  audit.findings.forEach((finding, index) => {
    if (finding.determinism !== "deterministic" || finding.resultKind !== "failure") {
      return;
    }
    const key = failureObservationKey(finding, index, path);
    const encoded = JSON.stringify(key);
    const current = groups.get(encoded);
    groups.set(encoded, {
      key,
      count: (current?.count ?? 0) + 1
    });
  });
  return groups;
}

function failureObservationKey(
  finding: Finding,
  index: number,
  path: string
): FailureObservationKey {
  const fields = [
    ["criterionId", finding.criterionId],
    ["checkName", finding.checkName],
    ["viewport", finding.viewport],
    ["selector", finding.selector]
  ] as const;
  for (const [field, value] of fields) {
    if (typeof value !== "string" || value.trim() === "") {
      throw new AuditCompareError(
        "identity",
        path,
        `deterministic failure finding ${index} has an empty ${field}`
      );
    }
  }
  return [
    finding.criterionId as string,
    finding.checkName,
    finding.viewport,
    finding.selector as string
  ];
}

function compareFailureGroups(
  before: ReadonlyMap<string, FailureObservationGroup>,
  after: ReadonlyMap<string, FailureObservationGroup>
): Omit<AuditComparison, "markdown"> {
  const encodedKeys = [...new Set([...before.keys(), ...after.keys()])]
    .sort((left, right) => compareObservationKeys(
      (before.get(left) ?? after.get(left))?.key as FailureObservationKey,
      (before.get(right) ?? after.get(right))?.key as FailureObservationKey
    ));
  const sameKey: FailureObservationGroup[] = [];
  const beforeOnly: FailureObservationGroup[] = [];
  const afterOnly: FailureObservationGroup[] = [];

  for (const encoded of encodedKeys) {
    const beforeGroup = before.get(encoded);
    const afterGroup = after.get(encoded);
    const key = (beforeGroup ?? afterGroup)?.key as FailureObservationKey;
    const beforeCount = beforeGroup?.count ?? 0;
    const afterCount = afterGroup?.count ?? 0;
    const sharedCount = Math.min(beforeCount, afterCount);
    if (sharedCount > 0) {
      sameKey.push({ key, count: sharedCount });
    }
    if (beforeCount > sharedCount) {
      beforeOnly.push({ key, count: beforeCount - sharedCount });
    }
    if (afterCount > sharedCount) {
      afterOnly.push({ key, count: afterCount - sharedCount });
    }
  }

  return {
    beforeCount: sumGroupCounts(before),
    afterCount: sumGroupCounts(after),
    sameKeyCount: sumObservationCounts(sameKey),
    beforeOnlyCount: sumObservationCounts(beforeOnly),
    afterOnlyCount: sumObservationCounts(afterOnly),
    sameKey,
    beforeOnly,
    afterOnly
  };
}

function renderAuditComparison(comparison: Omit<AuditComparison, "markdown">): string {
  return [
    "# Design Harness audit observation comparison",
    "",
    `- Before deterministic failure observations: ${comparison.beforeCount}`,
    `- After deterministic failure observations: ${comparison.afterCount}`,
    `- Same-key observations: ${comparison.sameKeyCount}`,
    `- Before-only observations: ${comparison.beforeOnlyCount}`,
    `- After-only observations: ${comparison.afterOnlyCount}`,
    "- Checked compatibility fields: schemaVersion, harnessVersion, target, viewportPresets",
    "",
    "## Same-key observations",
    "",
    ...renderObservationGroups(comparison.sameKey),
    "",
    "## Before-only observations",
    "",
    ...renderObservationGroups(comparison.beforeOnly),
    "",
    "## After-only observations",
    "",
    ...renderObservationGroups(comparison.afterOnly),
    "",
    "Configuration equivalence and causality are unverified. Shared keys do not establish DOM identity, and one-sided keys do not establish why an observation differs."
  ].join("\n");
}

function renderObservationGroups(groups: readonly FailureObservationGroup[]): string[] {
  return groups.length === 0
    ? ["- None."]
    : groups.map(({ key, count }) => `- count=${count}; key=${JSON.stringify(key)}`);
}

function compareObservationKeys(left: FailureObservationKey, right: FailureObservationKey): number {
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

function sumGroupCounts(groups: ReadonlyMap<string, FailureObservationGroup>): number {
  return sumObservationCounts(groups.values());
}

function sumObservationCounts(groups: Iterable<FailureObservationGroup>): number {
  let total = 0;
  for (const group of groups) {
    total += group.count;
  }
  return total;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

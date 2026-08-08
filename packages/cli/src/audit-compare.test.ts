import { execFileSync } from "node:child_process";
import { constants } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createExampleAuditResult,
  scoreFindings,
  type AuditResult,
  type Finding
} from "@design-harness/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AuditCompareError,
  MAX_COMPARE_AUDIT_BYTES,
  assertComparableAudits,
  compareAuditOpenFlags,
  compareAuditResults,
  loadCompareAudit,
  runAuditComparison,
  type CompareAuditFileHandle,
  type CompareAuditFileStats
} from "./audit-compare.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("compare audit bounded input", () => {
  it("uses a read-only, non-blocking, no-follow production open mode", () => {
    const flags = compareAuditOpenFlags();
    expect(flags & (constants.O_WRONLY | constants.O_RDWR)).toBe(constants.O_RDONLY);
    if (typeof constants.O_NONBLOCK === "number") {
      expect(flags & constants.O_NONBLOCK).toBe(constants.O_NONBLOCK);
    }
    if (typeof constants.O_NOFOLLOW === "number") {
      expect(flags & constants.O_NOFOLLOW).toBe(constants.O_NOFOLLOW);
    }
  });

  it("accepts exactly 8,388,608 bytes through bounded sequential reads", async () => {
    const bytes = paddedAuditBytes(completeAudit(), MAX_COMPARE_AUDIT_BYTES);
    const fixture = memoryHandle(bytes);

    await expect(loadCompareAudit("exact-limit.json", {
      openFile: async () => fixture.handle
    })).resolves.toMatchObject({ status: "success" });

    expect(fixture.cursor()).toBe(MAX_COMPARE_AUDIT_BYTES);
    expect(fixture.handle.stat).toHaveBeenCalledTimes(2);
    expect(fixture.handle.read).toHaveBeenCalledWith(
      expect.any(Buffer),
      0,
      expect.any(Number),
      null
    );
    expect(fixture.requestedLengths().every((length) => length <= 64 * 1024)).toBe(true);
    expect(fixture.handle.close).toHaveBeenCalledOnce();
    expect(fixture.handle.stat.mock.invocationCallOrder[0])
      .toBeLessThan(fixture.handle.read.mock.invocationCallOrder[0] as number);
    expect(fixture.handle.read.mock.invocationCallOrder.at(-1))
      .toBeLessThan(fixture.handle.stat.mock.invocationCallOrder[1] as number);
    expect(fixture.handle.stat.mock.invocationCallOrder[1])
      .toBeLessThan(fixture.handle.close.mock.invocationCallOrder[0] as number);
  });

  it("rejects a production-path directory as non-regular", async () => {
    const path = await compareTempRoot();

    await expect(loadCompareAudit(path)).rejects.toMatchObject({
      stage: "read",
      detail: "path is not a regular file"
    });
  });

  it.skipIf(process.platform === "win32")("rejects a production-path FIFO without blocking", async () => {
    const root = await compareTempRoot();
    const path = join(root, "audit.pipe");
    execFileSync("mkfifo", [path]);

    await expect(loadCompareAudit(path)).rejects.toMatchObject({
      stage: "read",
      detail: "path is not a regular file"
    });
  });

  it("rejects 8,388,609 bytes after reading no more than limit+1", async () => {
    const bytes = paddedAuditBytes(completeAudit(), MAX_COMPARE_AUDIT_BYTES + 1);
    const fixture = memoryHandle(bytes);

    await expect(loadCompareAudit("limit-plus-one.json", {
      openFile: async () => fixture.handle
    })).rejects.toMatchObject({
      stage: "size",
      inputPath: "limit-plus-one.json",
      detail: `file exceeds ${MAX_COMPARE_AUDIT_BYTES} bytes`
    });

    expect(fixture.cursor()).toBe(MAX_COMPARE_AUDIT_BYTES + 1);
    expect(fixture.requestedLengths().reduce((sum, length) => sum + length, 0))
      .toBe(MAX_COMPARE_AUDIT_BYTES + 1);
    expect(fixture.handle.close).toHaveBeenCalledOnce();
  });

  it("rejects an opened non-regular handle before reading and still closes it", async () => {
    const fixture = memoryHandle(Buffer.from("{}"), {
      before: { regular: false },
      after: { regular: false }
    });

    await expect(loadCompareAudit("directory", {
      openFile: async () => fixture.handle
    })).rejects.toMatchObject({ stage: "read", detail: "path is not a regular file" });

    expect(fixture.handle.read).not.toHaveBeenCalled();
    expect(fixture.handle.close).toHaveBeenCalledOnce();
  });

  it.each([
    ["growth", { before: { sizeDelta: -1 }, after: {} }],
    ["shrink", { before: { sizeDelta: 1 }, after: {} }],
    ["mtime", { before: {}, after: { mtimeMs: 2 } }],
    ["ctime", { before: {}, after: { ctimeMs: 2 } }]
  ] as const)("rejects %s observed across the handle read", async (_label, snapshots) => {
    const fixture = memoryHandle(auditBytes(completeAudit()), snapshots);

    await expect(loadCompareAudit("changing.json", {
      openFile: async () => fixture.handle
    })).rejects.toMatchObject({ stage: "read", detail: "file changed during read" });

    expect(fixture.handle.stat).toHaveBeenCalledTimes(2);
    expect(fixture.handle.close).toHaveBeenCalledOnce();
  });

  it("rejects a stable-size byte-count mismatch", async () => {
    const bytes = auditBytes(completeAudit());
    const fixture = memoryHandle(bytes.subarray(0, bytes.length - 1), {
      before: { size: bytes.length },
      after: { size: bytes.length }
    });

    await expect(loadCompareAudit("short-read.json", {
      openFile: async () => fixture.handle
    })).rejects.toMatchObject({
      stage: "read",
      detail: expect.stringContaining("stable size")
    });
  });

  it("preserves a primary read failure when close also fails", async () => {
    await expect(loadCompareAudit("primary.json", {
      openFile: async () => ({
        stat: async () => {
          throw new Error("primary stat failure");
        },
        read: async () => ({ bytesRead: 0 }),
        close: async () => {
          throw new Error("secondary close failure");
        }
      })
    })).rejects.toSatisfy((error: unknown) => {
      return error instanceof AuditCompareError
        && error.stage === "read"
        && error.detail.includes("primary stat failure")
        && !error.detail.includes("secondary close failure");
    });
  });

  it("reports a close failure when no earlier failure occurred", async () => {
    const fixture = memoryHandle(auditBytes(completeAudit()));
    fixture.handle.close.mockRejectedValueOnce(new Error("close failed"));

    await expect(loadCompareAudit("close.json", {
      openFile: async () => fixture.handle
    })).rejects.toMatchObject({
      stage: "read",
      detail: "failed to close file: close failed"
    });
  });

  it("keeps UTF-8, JSON, schema, and integrity failures at distinct boundaries", async () => {
    const integrityInvalid = completeAudit([deterministicFailure()]);
    integrityInvalid.findings[0]!.evidenceRefs = ["unknown-evidence"];
    integrityInvalid.advisoryScore = scoreFindings(integrityInvalid.findings);

    for (const scenario of [
      { stage: "decode", bytes: Buffer.from([0xc3, 0x28]) },
      { stage: "parse", bytes: Buffer.from("{", "utf8") },
      { stage: "schema", bytes: Buffer.from("{}", "utf8") },
      { stage: "integrity", bytes: auditBytes(integrityInvalid) }
    ] as const) {
      const fixture = memoryHandle(scenario.bytes);
      await expect(loadCompareAudit(`${scenario.stage}.json`, {
        openFile: async () => fixture.handle
      })).rejects.toMatchObject({ stage: scenario.stage });
      expect(fixture.handle.close).toHaveBeenCalledOnce();
    }
  });
});

describe("compare audit validation and compatibility", () => {
  it("rejects partial status, failed checks, and the exact truncation notice", async () => {
    const partial = completeAudit();
    partial.status = "partial";
    partial.failedChecks = ["desktop:screenshot"];
    await expect(loadAuditValue(partial, "partial.json"))
      .rejects.toMatchObject({ stage: "completeness", detail: expect.stringContaining("status") });

    const failedChecks = completeAudit();
    failedChecks.failedChecks = ["desktop:measurement"];
    await expect(loadAuditValue(failedChecks, "failed-checks.json"))
      .rejects.toMatchObject({ stage: "completeness", detail: expect.stringContaining("failedChecks") });

    const truncated = completeAudit();
    truncated.notices = [{
      code: "finding-samples-truncated",
      message: "Some finding samples were omitted."
    }];
    await expect(loadAuditValue(truncated, "truncated.json"))
      .rejects.toMatchObject({
        stage: "completeness",
        detail: expect.stringContaining("finding-samples-truncated")
      });
  });

  it("does not reject notice codes that merely contain the truncation code", async () => {
    const audit = completeAudit();
    audit.notices = [{
      code: "prefix-finding-samples-truncated-suffix",
      message: "A different notice."
    }];

    await expect(loadAuditValue(audit, "similar-notice.json"))
      .resolves.toMatchObject({ status: "success" });
  });

  it.each([
    ["schemaVersion", (audit: AuditResult) => { audit.schemaVersion = "future"; }],
    ["harnessVersion", (audit: AuditResult) => { audit.harnessVersion = "other"; }],
    ["target", (audit: AuditResult) => { audit.target = { ...audit.target, url: "http://localhost:4000" }; }],
    ["viewportPresets", (audit: AuditResult) => { audit.viewportPresets = audit.viewportPresets.slice(0, 1); }]
  ] as const)("rejects a %s mismatch with a precise compatibility message", (field, mutate) => {
    const before = completeAudit();
    const after = completeAudit();
    mutate(after);

    expect(() => assertComparableAudits(before, after)).toThrow(field);
  });

  it.each([
    ["criterionId", { criterionId: undefined }],
    ["checkName", { checkName: " " }],
    ["viewport", { viewport: "\t" }],
    ["selector", { selector: undefined }]
  ] as const)("rejects an empty deterministic failure %s", (field, overrides) => {
    const before = completeAudit([deterministicFailure(overrides)]);
    const after = completeAudit();

    expect(() => compareAuditResults(before, after, "before.json", "after.json"))
      .toThrow(`empty ${field}`);
  });
});

describe("compare audit observation multiset", () => {
  it("preserves duplicate multiplicity and splits groups by minimum count", async () => {
    const before = completeAudit([
      deterministicFailure({ id: "before-a-1", selector: "#a" }),
      deterministicFailure({ id: "before-a-2", selector: "#a" }),
      deterministicFailure({ id: "before-a-3", selector: "#a" }),
      deterministicFailure({ id: "before-b", selector: "#b" })
    ]);
    const after = completeAudit([
      deterministicFailure({ id: "after-a-1", selector: "#a" }),
      deterministicFailure({ id: "after-a-2", selector: "#a" }),
      deterministicFailure({ id: "after-c-1", selector: "#c" }),
      deterministicFailure({ id: "after-c-2", selector: "#c" })
    ]);

    const comparison = await compareAuditValues(before, after);

    expect(comparison).toMatchObject({
      beforeCount: 4,
      afterCount: 4,
      sameKeyCount: 2,
      beforeOnlyCount: 2,
      afterOnlyCount: 2
    });
    expect(comparison.sameKey).toEqual([
      { key: ["a11y.language.page-lang", "page-lang-missing", "desktop", "#a"], count: 2 }
    ]);
    expect(comparison.beforeOnly).toEqual([
      { key: ["a11y.language.page-lang", "page-lang-missing", "desktop", "#a"], count: 1 },
      { key: ["a11y.language.page-lang", "page-lang-missing", "desktop", "#b"], count: 1 }
    ]);
    expect(comparison.afterOnly).toEqual([
      { key: ["a11y.language.page-lang", "page-lang-missing", "desktop", "#c"], count: 2 }
    ]);
  });

  it("ignores non-failures and non-key finding fields", async () => {
    const beforeFailure = deterministicFailure({
      id: "before-id",
      severity: "critical",
      confidence: "high",
      problem: "Before wording.",
      recommendation: "Before advice.",
      evidenceRefs: ["screenshot-desktop"],
      region: { x: 1, y: 2, width: 3, height: 4 }
    });
    const afterFailure = deterministicFailure({
      id: "after-id",
      severity: "low",
      confidence: "medium",
      problem: "After wording.",
      recommendation: "After advice.",
      evidenceRefs: ["measurement-desktop"],
      region: { x: 10, y: 20, width: 30, height: 40 }
    });
    const excluded = [
      legacyFinding({ id: "det-risk", determinism: "deterministic", resultKind: "risk" }),
      legacyFinding({ id: "heuristic-risk", determinism: "heuristic", resultKind: "risk" }),
      legacyFinding({ id: "subjective-review", determinism: "subjective", resultKind: "needs-review" })
    ];

    const comparison = await compareAuditValues(
      completeAudit([beforeFailure, ...excluded]),
      completeAudit([afterFailure])
    );

    expect(comparison.sameKeyCount).toBe(1);
    expect(comparison.beforeOnlyCount).toBe(0);
    expect(comparison.afterOnlyCount).toBe(0);
    expect(comparison.markdown).not.toContain("Before wording");
    expect(comparison.markdown).not.toContain("After advice");
  });

  it("renders stable lexical groups, deterministic stdout, and the mandatory caveat", async () => {
    const before = completeAudit([
      deterministicFailure({ id: "z", viewport: "mobile", selector: "#z" }),
      deterministicFailure({ id: "b", selector: "#b" }),
      deterministicFailure({ id: "a", selector: "#a" })
    ]);
    const after = completeAudit([
      deterministicFailure({ id: "after-a", selector: "#a" })
    ]);

    const first = await compareAuditValues(before, after);
    const second = await compareAuditValues(before, after);

    expect(second.markdown).toBe(first.markdown);
    expect(first.markdown.indexOf('"#b"')).toBeLessThan(first.markdown.indexOf('"#z"'));
    expect(first.markdown).toContain("## Same-key observations");
    expect(first.markdown).toContain("## Before-only observations");
    expect(first.markdown).toContain("## After-only observations");
    expect(first.markdown).toContain("Configuration equivalence and causality are unverified.");
    expect(first.markdown).not.toMatch(
      /\b(?:fixed|resolved|regressed|regression|compliant|accessible)\b|same element|good design/iu
    );
  });

  it("returns a valid observation result when keys appear on only one side", async () => {
    const comparison = await compareAuditValues(
      completeAudit([deterministicFailure({ id: "before", selector: "#before" })]),
      completeAudit([deterministicFailure({ id: "after", selector: "#after" })])
    );

    expect(comparison.sameKeyCount).toBe(0);
    expect(comparison.beforeOnlyCount).toBe(1);
    expect(comparison.afterOnlyCount).toBe(1);
  });
});

function completeAudit(findings: Finding[] = []): AuditResult {
  const audit = createExampleAuditResult();
  audit.findings = findings;
  audit.advisoryScore = scoreFindings(findings);
  return audit;
}

function deterministicFailure(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "deterministic-failure",
    category: "accessibility",
    severity: "high",
    confidence: "high",
    viewport: "desktop",
    selector: "html",
    evidenceRefs: ["measurement-desktop"],
    problem: "The page language declaration is absent.",
    recommendation: "Declare the page language.",
    checkName: "page-lang-missing",
    criterionId: "a11y.language.page-lang",
    sourceRefs: ["wcag-2-2"],
    determinism: "deterministic",
    resultKind: "failure",
    runtime: "static-dom",
    observed: false,
    expected: true,
    humanReviewRecommended: false,
    ...overrides
  };
}

function legacyFinding(overrides: Partial<Finding>): Finding {
  return {
    id: "legacy-finding",
    category: "content",
    severity: "low",
    confidence: "low",
    viewport: "desktop",
    evidenceRefs: ["measurement-desktop"],
    problem: "An excluded observation.",
    recommendation: "Review it separately.",
    checkName: "legacy-observation",
    ...overrides
  };
}

async function loadAuditValue(audit: AuditResult, path: string): Promise<AuditResult> {
  const fixture = memoryHandle(auditBytes(audit));
  return loadCompareAudit(path, { openFile: async () => fixture.handle });
}

async function compareAuditValues(before: AuditResult, after: AuditResult) {
  const bytes = new Map([
    ["before.json", auditBytes(before)],
    ["after.json", auditBytes(after)]
  ]);
  return runAuditComparison({ beforePath: "before.json", afterPath: "after.json" }, {
    openFile: async (path) => {
      const source = bytes.get(path);
      if (!source) {
        throw new Error(`Unexpected path ${path}`);
      }
      return memoryHandle(source).handle;
    }
  });
}

function auditBytes(audit: AuditResult): Buffer {
  return Buffer.from(JSON.stringify(audit), "utf8");
}

function paddedAuditBytes(audit: AuditResult, size: number): Buffer {
  const source = auditBytes(audit);
  if (source.length > size) {
    throw new Error(`Audit fixture is ${source.length} bytes; cannot pad to ${size}.`);
  }
  return Buffer.concat([source, Buffer.alloc(size - source.length, 0x20)], size);
}

interface SnapshotOptions {
  size?: number;
  sizeDelta?: number;
  mtimeMs?: number;
  ctimeMs?: number;
  regular?: boolean;
}

interface MemoryHandleOptions {
  before?: SnapshotOptions;
  after?: SnapshotOptions;
}

function memoryHandle(bytes: Buffer, options: MemoryHandleOptions = {}) {
  let cursor = 0;
  let statCall = 0;
  const requestedLengths: number[] = [];
  const before = fileStats(bytes.length, options.before);
  const after = fileStats(bytes.length, options.after);
  const handle = {
    stat: vi.fn(async () => statCall++ === 0 ? before : after),
    read: vi.fn(async (buffer: Buffer, offset: number, length: number, position: number | null) => {
      if (position !== null) {
        throw new Error("Compare reader must use the handle's sequential offset.");
      }
      requestedLengths.push(length);
      const bytesRead = Math.min(length, bytes.length - cursor);
      if (bytesRead > 0) {
        bytes.copy(buffer, offset, cursor, cursor + bytesRead);
        cursor += bytesRead;
      }
      return { bytesRead };
    }),
    close: vi.fn(async () => undefined)
  } satisfies CompareAuditFileHandle;
  return {
    handle,
    cursor: () => cursor,
    requestedLengths: () => requestedLengths
  };
}

function fileStats(baseSize: number, options: SnapshotOptions = {}): CompareAuditFileStats {
  const size = options.size ?? baseSize + (options.sizeDelta ?? 0);
  return {
    size,
    mtimeMs: options.mtimeMs ?? 1,
    ctimeMs: options.ctimeMs ?? 1,
    isFile: () => options.regular ?? true
  };
}

async function compareTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "design-harness-audit-compare-"));
  tempRoots.push(root);
  return root;
}

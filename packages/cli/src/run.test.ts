import { stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import {
  createExampleDesignGuide,
  createExampleAuditResult,
  createExampleMetadata,
  createMinimalCopyStyle,
  projectFontFamilyAdherencePolicy
} from "@design-harness/core";
import { BrowserUnavailableError, type AuditUrlOptions } from "@design-harness/visual-audit";
import { CopyStyleLoadError } from "./copy-style.js";
import { GuideOperationError } from "./guide-errors.js";
import type { GuideRunDependencies, GuideRunResult } from "./guide-run.js";
import { runCli, type RunCliDependencies } from "./run.js";

const baseArgv = ["audit", "--url", "http://localhost:3000", "--out", "runs/demo"];

describe("runCli", () => {
  it("preserves the no-config path without resolving cwd, invoking loaders, or passing policy properties", async () => {
    const { dependencies, audit, loadDesignGuide, loadCopyStyle, writeArtifacts, cwd } = successfulDependencies();

    await expect(runCli(baseArgv, dependencies)).resolves.toBe(0);

    expect(cwd).not.toHaveBeenCalled();
    expect(loadDesignGuide).not.toHaveBeenCalled();
    expect(loadCopyStyle).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledOnce();
    expect(audit.mock.calls[0]?.[0]).not.toHaveProperty("copyStyle");
    expect(audit.mock.calls[0]?.[0]).not.toHaveProperty("fontFamilyPolicy");
    expect(audit.mock.calls[0]?.[0]).not.toHaveProperty("guide");
    expect(audit.mock.calls[0]?.[0]).not.toHaveProperty("designGuide");
    expect(writeArtifacts).toHaveBeenCalledOnce();
  });

  it("loads and projects the explicit guide before copy regardless of argv order", async () => {
    const guide = createExampleDesignGuide();
    guide.audit = { fontFamily: { ignoreSelectors: [".third-party-widget"] } };
    const copyStyle = createMinimalCopyStyle();
    const { dependencies, audit, loadDesignGuide, loadCopyStyle, cwd } = successfulDependencies();
    loadDesignGuide.mockResolvedValue(guide);
    loadCopyStyle.mockResolvedValue(copyStyle);

    await expect(runCli([
      ...baseArgv,
      "--copy",
      "config/style.yaml",
      "--guide",
      "config/design-guide.yaml"
    ], dependencies)).resolves.toBe(0);

    expect(cwd).toHaveBeenCalledOnce();
    expect(loadDesignGuide).toHaveBeenCalledWith("config/design-guide.yaml", { cwd: "/project" });
    expect(loadCopyStyle).toHaveBeenCalledWith("config/style.yaml", { cwd: "/project" });
    expect(loadDesignGuide.mock.invocationCallOrder[0]).toBeLessThan(loadCopyStyle.mock.invocationCallOrder[0]);
    expect(audit).toHaveBeenCalledOnce();
    expect(audit.mock.calls[0]?.[0].fontFamilyPolicy).toEqual(projectFontFamilyAdherencePolicy(guide));
    expect(audit.mock.calls[0]?.[0].copyStyle).toBe(copyStyle);
    expect(audit.mock.calls[0]?.[0]).not.toHaveProperty("guide");
    expect(audit.mock.calls[0]?.[0]).not.toHaveProperty("designGuide");
  });

  it("passes only the projected policy for a guide-only audit", async () => {
    const guide = createExampleDesignGuide();
    const { dependencies, audit, loadDesignGuide, loadCopyStyle } = successfulDependencies();
    loadDesignGuide.mockResolvedValue(guide);

    await expect(runCli([...baseArgv, "--guide", "config/design-guide.yaml"], dependencies)).resolves.toBe(0);

    expect(loadDesignGuide).toHaveBeenCalledOnce();
    expect(loadCopyStyle).not.toHaveBeenCalled();
    expect(audit.mock.calls[0]?.[0]).toMatchObject({
      fontFamilyPolicy: projectFontFamilyAdherencePolicy(guide)
    });
    expect(audit.mock.calls[0]?.[0]).not.toHaveProperty("copyStyle");
  });

  it("passes the validated copy style by identity into one audit call", async () => {
    const copyStyle = createMinimalCopyStyle();
    const { dependencies, audit, loadCopyStyle } = successfulDependencies();
    loadCopyStyle.mockResolvedValue(copyStyle);

    await expect(runCli([...baseArgv, "--copy", "config/style.yaml"], dependencies)).resolves.toBe(0);

    expect(loadCopyStyle).toHaveBeenCalledWith("config/style.yaml", { cwd: "/project" });
    expect(audit).toHaveBeenCalledOnce();
    expect(audit.mock.calls[0]?.[0].copyStyle).toBe(copyStyle);
  });

  it("rejects the URL before loading config, auditing, or writing", async () => {
    const { dependencies, audit, loadDesignGuide, loadCopyStyle, writeArtifacts, cwd } = successfulDependencies();
    dependencies.assertUrl = vi.fn(() => {
      throw new Error("Only local http(s) URLs are allowed");
    });

    await expect(runCli([
      ...baseArgv,
      "--copy",
      "style.yaml",
      "--guide",
      "design-guide.yaml"
    ], dependencies)).resolves.toBe(1);

    expect(cwd).not.toHaveBeenCalled();
    expect(loadDesignGuide).not.toHaveBeenCalled();
    expect(loadCopyStyle).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    expect(writeArtifacts).not.toHaveBeenCalled();
  });

  it("leaves audit and artifacts untouched when config loading fails", async () => {
    const { dependencies, audit, loadCopyStyle, writeArtifacts } = successfulDependencies();
    const outDir = join(tmpdir(), `design-harness-run-missing-${Date.now()}`);
    loadCopyStyle.mockRejectedValue(new CopyStyleLoadError("schema", "/project/style.yaml", "invalid"));

    await expect(runCli([
      "audit",
      "--url",
      "http://localhost:3000",
      "--out",
      outDir,
      "--copy",
      "style.yaml"
    ], dependencies)).resolves.toBe(1);

    expect(audit).not.toHaveBeenCalled();
    expect(writeArtifacts).not.toHaveBeenCalled();
    await expect(stat(outDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("blocks copy loading, browser work, and output when guide loading fails", async () => {
    const { dependencies, audit, loadDesignGuide, loadCopyStyle, writeArtifacts } = successfulDependencies();
    const outDir = join(tmpdir(), `design-harness-run-invalid-guide-${Date.now()}`);
    loadDesignGuide.mockRejectedValue(new Error("Design guide schema error"));

    await expect(runCli([
      "audit",
      "--url",
      "http://localhost:3000",
      "--out",
      outDir,
      "--copy",
      "style.yaml",
      "--guide",
      "design-guide.yaml"
    ], dependencies)).resolves.toBe(1);

    expect(loadDesignGuide).toHaveBeenCalledOnce();
    expect(loadCopyStyle).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    expect(writeArtifacts).not.toHaveBeenCalled();
    await expect(stat(outDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps a valid guide preflight but blocks browser and output when copy loading fails", async () => {
    const { dependencies, audit, loadDesignGuide, loadCopyStyle, writeArtifacts } = successfulDependencies();
    const outDir = join(tmpdir(), `design-harness-run-invalid-copy-after-guide-${Date.now()}`);
    loadCopyStyle.mockRejectedValue(new CopyStyleLoadError("schema", "/project/style.yaml", "invalid"));

    await expect(runCli([
      "audit",
      "--url",
      "http://localhost:3000",
      "--out",
      outDir,
      "--guide",
      "design-guide.yaml",
      "--copy",
      "style.yaml"
    ], dependencies)).resolves.toBe(1);

    expect(loadDesignGuide).toHaveBeenCalledOnce();
    expect(loadCopyStyle).toHaveBeenCalledOnce();
    expect(audit).not.toHaveBeenCalled();
    expect(writeArtifacts).not.toHaveBeenCalled();
    await expect(stat(outDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps partial exit 2 unless allow-partial is present", async () => {
    const first = successfulDependencies("partial");
    await expect(runCli(baseArgv, first.dependencies)).resolves.toBe(2);

    const allowed = successfulDependencies("partial");
    await expect(runCli([...baseArgv, "--allow-partial"], allowed.dependencies)).resolves.toBe(0);
  });

  it("keeps browser-unavailable failures at exit 1", async () => {
    const { dependencies, audit, writeArtifacts, stderr } = successfulDependencies();
    audit.mockRejectedValue(new BrowserUnavailableError("browser unavailable"));

    await expect(runCli(baseArgv, dependencies)).resolves.toBe(1);

    expect(writeArtifacts).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledWith("browser unavailable");
  });

  it("routes guide compile without invoking the audit path", async () => {
    const { dependencies, runGuide, audit, loadDesignGuide, loadCopyStyle, writeArtifacts, stdout } = successfulDependencies();

    await expect(runCli([
      "guide",
      "compile",
      "--guide",
      "project/design-guide.yaml",
      "--target",
      "project"
    ], dependencies)).resolves.toBe(0);

    expect(runGuide).toHaveBeenCalledOnce();
    expect(runGuide.mock.calls[0]?.[1]).toMatchObject({ cwd: dependencies.cwd });
    expect(audit).not.toHaveBeenCalled();
    expect(loadDesignGuide).not.toHaveBeenCalled();
    expect(loadCopyStyle).not.toHaveBeenCalled();
    expect(writeArtifacts).not.toHaveBeenCalled();
    expect(stdout).toHaveBeenCalledWith("guide-token-estimate-v1: 1234/2000");
  });

  it("returns exit 1 for zero-write guide drift and renders scoped help", async () => {
    const first = successfulDependencies();
    first.runGuide.mockResolvedValue({ ...guideResult("check"), ok: false });
    await expect(runCli([
      "guide",
      "check",
      "--guide",
      "project/design-guide.yaml",
      "--target",
      "project"
    ], first.dependencies)).resolves.toBe(1);
    expect(first.stderr).toHaveBeenCalledWith("Guide check found stale or missing owned artifacts.");

    const help = successfulDependencies();
    await expect(runCli(["guide", "check", "--help"], help.dependencies)).resolves.toBe(0);
    expect(help.stdout.mock.calls[0]?.[0]).toContain("--max-tokens <1..2000>");
    expect(help.runGuide).not.toHaveBeenCalled();
  });

  it("prints a phase-coded guide failure without auditing or writing", async () => {
    const { dependencies, runGuide, audit, writeArtifacts, stderr } = successfulDependencies();
    runGuide.mockRejectedValue(new GuideOperationError(
      "containment",
      "--guide",
      "--guide must be inside --target"
    ));

    await expect(runCli([
      "guide",
      "compile",
      "--guide",
      "outside.yaml",
      "--target",
      "project"
    ], dependencies)).resolves.toBe(1);

    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("Guide containment error"));
    expect(audit).not.toHaveBeenCalled();
    expect(writeArtifacts).not.toHaveBeenCalled();
  });
});

function successfulDependencies(status: "success" | "partial" = "success") {
  const auditResult = createExampleAuditResult();
  auditResult.status = status;
  if (status === "partial") {
    auditResult.failedChecks = ["desktop:screenshot"];
  }
  const metadata = createExampleMetadata();
  metadata.status = status;
  metadata.failedChecks = [...auditResult.failedChecks];
  const audit = vi.fn(async (_options: AuditUrlOptions) => ({ auditResult, metadata }));
  const loadDesignGuide = vi.fn(async () => createExampleDesignGuide());
  const loadCopyStyle = vi.fn(async () => createMinimalCopyStyle());
  const writeArtifacts = vi.fn(async () => undefined);
  const stdout = vi.fn();
  const stderr = vi.fn();
  const runGuide = vi.fn(async (
    args: { action: "compile" | "check" },
    _guideDependencies?: GuideRunDependencies
  ) => guideResult(args.action));
  const cwd = vi.fn(() => "/project");
  const dependencies: RunCliDependencies = {
    audit,
    loadDesignGuide,
    loadCopyStyle,
    runGuide,
    writeArtifacts,
    assertUrl: vi.fn((url: string) => `${url}/`),
    cwd,
    stdout,
    stderr
  };
  return {
    dependencies,
    audit,
    loadDesignGuide,
    loadCopyStyle,
    runGuide,
    writeArtifacts,
    cwd,
    stdout,
    stderr
  };
}

function guideResult(action: "compile" | "check"): GuideRunResult {
  return {
    action,
    ok: true,
    targetDir: "project",
    profileId: "design-guide-v0.5a-1",
    catalogVersion: "2026-07-18",
    sourceHash: "a".repeat(64),
    tokenEstimate: {
      method: "guide-token-estimate-v1",
      estimated: 1234,
      ceiling: 2000
    },
    artifacts: [
      { name: "AGENTS.md", status: "changed", checkStatus: action === "check" ? "current" : undefined },
      { name: "CLAUDE.md", status: "unchanged", checkStatus: action === "check" ? "current" : undefined },
      { name: "DESIGN.md", status: "changed", checkStatus: action === "check" ? "current" : undefined },
      { name: "design.tokens.json", status: "changed", checkStatus: action === "check" ? "current" : undefined }
    ]
  };
}

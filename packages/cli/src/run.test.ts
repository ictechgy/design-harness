import { stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import {
  createExampleAuditResult,
  createExampleMetadata,
  createMinimalCopyStyle
} from "@design-harness/core";
import { BrowserUnavailableError, type AuditUrlOptions } from "@design-harness/visual-audit";
import { CopyStyleLoadError } from "./copy-style.js";
import { runCli, type RunCliDependencies } from "./run.js";

const baseArgv = ["audit", "--url", "http://localhost:3000", "--out", "runs/demo"];

describe("runCli", () => {
  it("preserves the no-copy path without invoking the loader or passing copyStyle", async () => {
    const { dependencies, audit, loadCopyStyle, writeArtifacts } = successfulDependencies();

    await expect(runCli(baseArgv, dependencies)).resolves.toBe(0);

    expect(loadCopyStyle).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledOnce();
    expect(audit.mock.calls[0]?.[0]).not.toHaveProperty("copyStyle");
    expect(writeArtifacts).toHaveBeenCalledOnce();
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
    const { dependencies, audit, loadCopyStyle, writeArtifacts } = successfulDependencies();
    dependencies.assertUrl = vi.fn(() => {
      throw new Error("Only local http(s) URLs are allowed");
    });

    await expect(runCli([...baseArgv, "--copy", "style.yaml"], dependencies)).resolves.toBe(1);

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
  const loadCopyStyle = vi.fn(async () => createMinimalCopyStyle());
  const writeArtifacts = vi.fn(async () => undefined);
  const stdout = vi.fn();
  const stderr = vi.fn();
  const dependencies: RunCliDependencies = {
    audit,
    loadCopyStyle,
    writeArtifacts,
    assertUrl: vi.fn((url: string) => `${url}/`),
    cwd: () => "/project",
    stdout,
    stderr
  };
  return { dependencies, audit, loadCopyStyle, writeArtifacts, stdout, stderr };
}

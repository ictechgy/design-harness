import { stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import {
  createExampleDesignGuide,
  createExampleAuditResult,
  createExampleMetadata,
  createMinimalCopyStyle,
  projectColorAdherencePolicy,
  projectFontFamilyAdherencePolicy,
  projectSpacingAdherencePolicy,
  projectVisualMetricsRuntimePolicies
} from "@design-harness/core";
import {
  BrowserUnavailableError,
  type AuditUrlOptions,
  type MorphologyCopyAnalyzer
} from "@design-harness/visual-audit";
import { CopyStyleLoadError } from "./copy-style.js";
import { GuideOperationError } from "./guide-errors.js";
import type { AuditComparison } from "./audit-compare.js";
import type { GuideRunDependencies, GuideRunResult } from "./guide-run.js";
import type { LoopRunInput, LoopRunResult } from "./loop-run.js";
import { runCli, type RunCliDependencies } from "./run.js";

const baseArgv = ["audit", "--url", "http://localhost:3000", "--out", "runs/demo"];
const baseLoopArgv = [
  "loop",
  "--url",
  "http://localhost:3000",
  "--out",
  "runs/loop",
  "--until",
  "deterministic-failures==0",
  "--max-iters",
  "3",
  "--agent-cmd",
  "repair --non-interactive"
];

describe("runCli", () => {
  it("preserves the no-config path without resolving cwd, invoking loaders, or passing policy properties", async () => {
    const {
      dependencies,
      audit,
      loadDesignGuide,
      loadCopyStyle,
      prepareKiwiMorphology,
      runLoop,
      writeArtifacts,
      cwd
    } = successfulDependencies();

    await expect(runCli(baseArgv, dependencies)).resolves.toBe(0);

    expect(cwd).not.toHaveBeenCalled();
    expect(loadDesignGuide).not.toHaveBeenCalled();
    expect(loadCopyStyle).not.toHaveBeenCalled();
    expect(prepareKiwiMorphology).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledOnce();
    expect(runLoop).not.toHaveBeenCalled();
    expect(audit.mock.calls[0]?.[0]).not.toHaveProperty("copyStyle");
    expect(audit.mock.calls[0]?.[0]).not.toHaveProperty("fontFamilyPolicy");
    expect(audit.mock.calls[0]?.[0]).not.toHaveProperty("colorPolicy");
    expect(audit.mock.calls[0]?.[0]).not.toHaveProperty("spacingPolicy");
    expect(audit.mock.calls[0]?.[0]).not.toHaveProperty("typographyVariantsPolicy");
    expect(audit.mock.calls[0]?.[0]).not.toHaveProperty("paletteDisciplinePolicy");
    expect(audit.mock.calls[0]?.[0]).not.toHaveProperty("densityComplexityPolicy");
    expect(audit.mock.calls[0]?.[0]).not.toHaveProperty("morphologyCopyAnalyzer");
    expect(audit.mock.calls[0]?.[0]).not.toHaveProperty("guide");
    expect(audit.mock.calls[0]?.[0]).not.toHaveProperty("designGuide");
    expect(writeArtifacts).toHaveBeenCalledOnce();
  });

  it("loads and projects the explicit guide before copy regardless of argv order", async () => {
    const guide = createExampleDesignGuide();
    guide.audit = {
      fontFamily: {
        additionalAllowedFamilies: [{ value: "Rogue", kind: "named" }],
        ignoreSelectors: [".third-party-widget"]
      }
    };
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
    expect(audit.mock.calls[0]?.[0].colorPolicy).toEqual(projectColorAdherencePolicy(guide));
    expect(audit.mock.calls[0]?.[0].spacingPolicy).toEqual(projectSpacingAdherencePolicy(guide));
    expect(audit.mock.calls[0]?.[0].copyStyle).toBe(copyStyle);
    expect(audit.mock.calls[0]?.[0]).not.toHaveProperty("guide");
    expect(audit.mock.calls[0]?.[0]).not.toHaveProperty("designGuide");
  });

  it("passes only the projected policy for a guide-only audit", async () => {
    const guide = createExampleDesignGuide();
    guide.audit = {
      fontFamily: {
        additionalAllowedFamilies: [
          { value: "Rogue", kind: "named" },
          { value: "system-ui", kind: "named" }
        ]
      }
    };
    const { dependencies, audit, loadDesignGuide, loadCopyStyle } = successfulDependencies();
    loadDesignGuide.mockResolvedValue(guide);

    await expect(runCli([...baseArgv, "--guide", "config/design-guide.yaml"], dependencies)).resolves.toBe(0);

    expect(loadDesignGuide).toHaveBeenCalledOnce();
    expect(loadCopyStyle).not.toHaveBeenCalled();
    expect(audit.mock.calls[0]?.[0].fontFamilyPolicy).toEqual({
      allowedFamilies: [
        { value: "Example Sans", kind: "named" },
        { value: "sans-serif", kind: "generic" },
        { value: "Rogue", kind: "named" },
        { value: "system-ui", kind: "named" }
      ],
      ignoreSelectors: [],
      policyId: "font-family-adherence-v1"
    });
    expect(audit.mock.calls[0]?.[0]).not.toHaveProperty("copyStyle");
  });

  it("routes configured visual-metric policies into ordinary audit without exposing the guide", async () => {
    const guide = createExampleDesignGuide();
    guide.audit = {
      typographyVariants: {
        maxDistinctVariants: 8,
        ignoreSelectors: [".vendor-type"]
      },
      paletteDiscipline: {
        maxDistinctColors: 24,
        maxChromaticHueFamilies: 4,
        ignoreSelectors: [".vendor-palette"]
      },
      densityComplexity: {
        maxVisibleElements: 120,
        maxTextClusters: 48,
        ignoreSelectors: [".vendor-density"]
      }
    };
    const { dependencies, audit, loadDesignGuide } = successfulDependencies();
    loadDesignGuide.mockResolvedValue(guide);

    await expect(runCli([
      ...baseArgv,
      "--guide",
      "config/design-guide.yaml"
    ], dependencies)).resolves.toBe(0);

    const projected = projectVisualMetricsRuntimePolicies(guide);
    expect(audit.mock.calls[0]?.[0]).toMatchObject({
      typographyVariantsPolicy: projected.typographyVariants,
      paletteDisciplinePolicy: projected.paletteDiscipline,
      densityComplexityPolicy: projected.densityComplexity
    });
    expect(audit.mock.calls[0]?.[0]).not.toHaveProperty("guide");
    expect(audit.mock.calls[0]?.[0]).not.toHaveProperty("designGuide");
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

  it("preflights and forwards one prepared Kiwi analyzer by identity", async () => {
    const copyStyle = createMinimalCopyStyle();
    const {
      dependencies,
      audit,
      loadCopyStyle,
      prepareKiwiMorphology,
      morphologyCopyAnalyzer,
      cwd
    } = successfulDependencies();
    loadCopyStyle.mockResolvedValue(copyStyle);

    await expect(runCli([
      ...baseArgv,
      "--copy",
      "config/style.yaml",
      "--kiwi-model-dir",
      "models/kiwi"
    ], dependencies)).resolves.toBe(0);

    expect(cwd).toHaveBeenCalledOnce();
    expect(loadCopyStyle).toHaveBeenCalledWith("config/style.yaml", { cwd: "/project" });
    expect(prepareKiwiMorphology).toHaveBeenCalledWith("models/kiwi", { cwd: "/project" });
    expect(audit).toHaveBeenCalledOnce();
    expect(audit.mock.calls[0]?.[0].copyStyle).toBe(copyStyle);
    expect(audit.mock.calls[0]?.[0].morphologyCopyAnalyzer).toBe(morphologyCopyAnalyzer);
  });

  it("rejects Kiwi without copy or with a non-Korean copy locale before audit and output", async () => {
    const first = successfulDependencies();
    await expect(runCli([
      ...baseArgv,
      "--kiwi-model-dir",
      "models/kiwi"
    ], first.dependencies)).resolves.toBe(1);
    expect(first.stderr).toHaveBeenCalledWith("--kiwi-model-dir requires --copy.");
    expect(first.prepareKiwiMorphology).not.toHaveBeenCalled();
    expect(first.audit).not.toHaveBeenCalled();
    expect(first.writeArtifacts).not.toHaveBeenCalled();

    const second = successfulDependencies();
    second.loadCopyStyle.mockResolvedValue({
      schemaVersion: "0.2",
      locale: "en"
    });
    await expect(runCli([
      ...baseArgv,
      "--copy",
      "config/style.yaml",
      "--kiwi-model-dir",
      "models/kiwi"
    ], second.dependencies)).resolves.toBe(1);
    expect(second.stderr).toHaveBeenCalledWith(
      "--kiwi-model-dir requires a --copy file whose locale is ko or ko-KR."
    );
    expect(second.prepareKiwiMorphology).not.toHaveBeenCalled();
    expect(second.audit).not.toHaveBeenCalled();
    expect(second.writeArtifacts).not.toHaveBeenCalled();
  });

  it("fails model preflight before browser or artifact side effects", async () => {
    const harness = successfulDependencies();
    harness.prepareKiwiMorphology.mockRejectedValue(new Error("Kiwi model digest mismatch"));
    const outDir = join(tmpdir(), `design-harness-run-kiwi-preflight-${Date.now()}`);

    await expect(runCli([
      "audit",
      "--url",
      "http://localhost:3000",
      "--out",
      outDir,
      "--copy",
      "config/style.yaml",
      "--kiwi-model-dir",
      "models/kiwi"
    ], harness.dependencies)).resolves.toBe(1);

    expect(harness.audit).not.toHaveBeenCalled();
    expect(harness.writeArtifacts).not.toHaveBeenCalled();
    await expect(stat(outDir)).rejects.toMatchObject({ code: "ENOENT" });
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

  it("preflights loop URL and explicit configs once before dispatching the bounded runner", async () => {
    const guide = createExampleDesignGuide();
    guide.audit = {
      typographyVariants: { maxDistinctVariants: 8 },
      paletteDiscipline: {
        maxDistinctColors: 24,
        maxChromaticHueFamilies: 4
      },
      densityComplexity: {
        maxVisibleElements: 120,
        maxTextClusters: 48
      }
    };
    const copyStyle = createMinimalCopyStyle();
    const {
      dependencies,
      audit,
      loadDesignGuide,
      loadCopyStyle,
      prepareKiwiMorphology,
      morphologyCopyAnalyzer,
      runLoop,
      writeArtifacts,
      cwd,
      stderr,
      stdout
    } = successfulDependencies();
    loadDesignGuide.mockResolvedValue(guide);
    loadCopyStyle.mockResolvedValue(copyStyle);

    await expect(runCli([
      ...baseLoopArgv,
      "--copy",
      "config/copy-style.yaml",
      "--kiwi-model-dir",
      "models/kiwi",
      "--guide",
      "config/design-guide.yaml",
      "--timeout-ms",
      "2500",
      "--agent-timeout-ms",
      "5000"
    ], dependencies)).resolves.toBe(0);

    expect(cwd).toHaveBeenCalledOnce();
    expect(loadDesignGuide).toHaveBeenCalledWith("config/design-guide.yaml", { cwd: "/project" });
    expect(loadCopyStyle).toHaveBeenCalledWith("config/copy-style.yaml", { cwd: "/project" });
    expect(prepareKiwiMorphology).toHaveBeenCalledWith("models/kiwi", { cwd: "/project" });
    expect(loadDesignGuide.mock.invocationCallOrder[0]).toBeLessThan(loadCopyStyle.mock.invocationCallOrder[0]);
    expect(runLoop).toHaveBeenCalledOnce();
    expect(runLoop.mock.calls[0]?.[0]).toMatchObject({
      url: "http://localhost:3000/",
      outDir: "runs/loop",
      until: "deterministic-failures==0",
      maxIters: 3,
      agentCmd: "repair --non-interactive",
      agentTimeoutMs: 5000,
      timeoutMs: 2500,
      cwd: "/project",
      copyStyle,
      morphologyCopyAnalyzer,
      fontFamilyPolicy: projectFontFamilyAdherencePolicy(guide),
      colorPolicy: projectColorAdherencePolicy(guide),
      spacingPolicy: projectSpacingAdherencePolicy(guide),
      typographyVariantsPolicy: projectVisualMetricsRuntimePolicies(guide).typographyVariants,
      paletteDisciplinePolicy: projectVisualMetricsRuntimePolicies(guide).paletteDiscipline,
      densityComplexityPolicy: projectVisualMetricsRuntimePolicies(guide).densityComplexity
    });
    expect(audit).not.toHaveBeenCalled();
    expect(writeArtifacts).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("arbitrary code"));
    expect(stdout).toHaveBeenCalledWith("Design Harness loop already-clean: runs/loop");
    expect(stdout).toHaveBeenCalledWith("Summary: runs/loop/loop-summary.json");
  });

  it("rejects a loop URL before cwd, config, output, browser, or agent orchestration", async () => {
    const {
      dependencies,
      audit,
      loadDesignGuide,
      loadCopyStyle,
      runLoop,
      writeArtifacts,
      cwd
    } = successfulDependencies();
    dependencies.assertUrl = vi.fn(() => {
      throw new Error("Only local http(s) URLs are allowed");
    });

    await expect(runCli([
      ...baseLoopArgv,
      "--guide",
      "design-guide.yaml",
      "--copy",
      "copy-style.yaml"
    ], dependencies)).resolves.toBe(1);

    expect(cwd).not.toHaveBeenCalled();
    expect(loadDesignGuide).not.toHaveBeenCalled();
    expect(loadCopyStyle).not.toHaveBeenCalled();
    expect(runLoop).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    expect(writeArtifacts).not.toHaveBeenCalled();
  });

  it("preserves the loop runner's unmet-condition exit class", async () => {
    const { dependencies, runLoop, stderr } = successfulDependencies();
    runLoop.mockResolvedValue(loopResult("no-progress", 3));

    await expect(runCli(baseLoopArgv, dependencies)).resolves.toBe(3);

    expect(runLoop.mock.calls[0]?.[0]).not.toHaveProperty("colorPolicy");
    expect(runLoop.mock.calls[0]?.[0]).not.toHaveProperty("spacingPolicy");
    expect(runLoop.mock.calls[0]?.[0]).not.toHaveProperty("typographyVariantsPolicy");
    expect(runLoop.mock.calls[0]?.[0]).not.toHaveProperty("paletteDisciplinePolicy");
    expect(runLoop.mock.calls[0]?.[0]).not.toHaveProperty("densityComplexityPolicy");
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("condition was reached"));
  });

  it("dispatches compare before all audit, configuration, URL, browser, and output setup", async () => {
    const {
      dependencies,
      runCompare,
      audit,
      loadDesignGuide,
      loadCopyStyle,
      prepareKiwiMorphology,
      runGuide,
      runLoop,
      writeArtifacts,
      assertUrl,
      cwd,
      stdout
    } = successfulDependencies();

    await expect(runCli([
      "compare",
      "--before",
      "runs/before/audit.json",
      "--after",
      "runs/after/audit.json"
    ], dependencies)).resolves.toBe(0);

    expect(runCompare).toHaveBeenCalledWith({
      command: "compare",
      beforePath: "runs/before/audit.json",
      afterPath: "runs/after/audit.json"
    });
    expect(stdout).toHaveBeenCalledWith("# comparison output");
    expect(assertUrl).not.toHaveBeenCalled();
    expect(cwd).not.toHaveBeenCalled();
    expect(loadDesignGuide).not.toHaveBeenCalled();
    expect(loadCopyStyle).not.toHaveBeenCalled();
    expect(prepareKiwiMorphology).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    expect(runGuide).not.toHaveBeenCalled();
    expect(runLoop).not.toHaveBeenCalled();
    expect(writeArtifacts).not.toHaveBeenCalled();
  });

  it("returns exit 1 for compare input failure without entering audit setup", async () => {
    const { dependencies, runCompare, audit, assertUrl, writeArtifacts, stderr } = successfulDependencies();
    runCompare.mockRejectedValue(new Error("Compare parse error at broken.json: invalid JSON"));

    await expect(runCli([
      "compare",
      "--before",
      "broken.json",
      "--after",
      "after.json"
    ], dependencies)).resolves.toBe(1);

    expect(stderr).toHaveBeenCalledWith("Compare parse error at broken.json: invalid JSON");
    expect(assertUrl).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    expect(writeArtifacts).not.toHaveBeenCalled();
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
  const morphologyCopyAnalyzer: MorphologyCopyAnalyzer = vi.fn(async () => ({
    findings: [],
    notices: []
  }));
  const prepareKiwiMorphology = vi.fn(async () => morphologyCopyAnalyzer);
  const writeArtifacts = vi.fn(async () => undefined);
  const stdout = vi.fn();
  const stderr = vi.fn();
  const runGuide = vi.fn(async (
    args: { action: "compile" | "check" },
    _guideDependencies?: GuideRunDependencies
  ) => guideResult(args.action));
  const runLoop = vi.fn(async (_input: LoopRunInput) => loopResult("already-clean", 0));
  const runCompare = vi.fn(async () => comparisonResult());
  const cwd = vi.fn(() => "/project");
  const assertUrl = vi.fn((url: string) => `${url}/`);
  const dependencies: RunCliDependencies = {
    audit,
    loadDesignGuide,
    loadCopyStyle,
    prepareKiwiMorphology,
    runGuide,
    runLoop,
    runCompare,
    writeArtifacts,
    assertUrl,
    cwd,
    stdout,
    stderr
  };
  return {
    dependencies,
    audit,
    loadDesignGuide,
    loadCopyStyle,
    prepareKiwiMorphology,
    morphologyCopyAnalyzer,
    runGuide,
    runLoop,
    runCompare,
    writeArtifacts,
    assertUrl,
    cwd,
    stdout,
    stderr
  };
}

function comparisonResult(): AuditComparison {
  return {
    beforeCount: 1,
    afterCount: 2,
    sameKeyCount: 1,
    beforeOnlyCount: 0,
    afterOnlyCount: 1,
    sameKey: [],
    beforeOnly: [],
    afterOnly: [],
    markdown: "# comparison output"
  };
}

function loopResult(status: LoopRunResult["summary"]["status"], exitCode: 0 | 1 | 2 | 3): LoopRunResult {
  return {
    exitCode,
    summary: { status } as LoopRunResult["summary"]
  };
}

function guideResult(action: "compile" | "check"): GuideRunResult {
  return {
    action,
    ok: true,
    targetDir: "project",
    profileId: "design-guide-v0.5a-3",
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
    ],
    notices: []
  };
}

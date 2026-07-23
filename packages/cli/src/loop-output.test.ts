import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { computeDeterministicFailureProgress } from "./loop-progress.js";
import {
  claimLoopOutputRoot,
  loopIterationPaths,
  resolveLoopRelativePath,
  writeLoopSummaryAtomic
} from "./loop-output.js";
import {
  LOOP_CONDITION,
  LOOP_SUMMARY_SCHEMA_VERSION,
  hashLoopAgentCommand,
  type LoopSummary
} from "./loop-summary.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("loop output ownership", () => {
  it.each([
    { cwd: "/workspace\0escape", outDir: "runs/loop" },
    { cwd: "/workspace", outDir: "runs\0/loop" }
  ])("rejects NUL paths before creating parent directories", async (input) => {
    let mkdirCalls = 0;
    await expect(claimLoopOutputRoot(input, {
      mkdir: async () => {
        mkdirCalls += 1;
        return undefined;
      }
    })).rejects.toThrow(/NUL/u);
    expect(mkdirCalls).toBe(0);
  });

  it("creates missing parents and claims the final root exclusively", async () => {
    const cwd = await tempDir();
    const outDir = "missing/parents/loop-run";
    const root = await claimLoopOutputRoot({ cwd, outDir });
    await writeFile(join(root.absolutePath, "sentinel"), "preserve");

    await expect(stat(root.absolutePath)).resolves.toMatchObject({});
    await expect(claimLoopOutputRoot({ cwd, outDir })).rejects.toMatchObject({ code: "EEXIST" });
    await expect(readFile(join(root.absolutePath, "sentinel"), "utf8")).resolves.toBe("preserve");
  });

  it("derives fixed normalized iteration paths inside the claimed root", async () => {
    const root = await claimLoopOutputRoot({ cwd: await tempDir(), outDir: "loop" });

    expect(loopIterationPaths(root, 0)).toMatchObject({
      relativeDir: "iterations/000-baseline",
      auditRelativePath: "iterations/000-baseline/audit.json",
      reportRelativePath: "iterations/000-baseline/report.md"
    });
    expect(loopIterationPaths(root, 3)).toMatchObject({
      relativeDir: "iterations/003",
      metadataRelativePath: "iterations/003/metadata.json",
      reportManifestRelativePath: "iterations/003/report-manifest.json"
    });
    expect(loopIterationPaths(root, 3).absoluteDir.startsWith(`${root.absolutePath}/`)).toBe(true);
  });

  it.each([
    "",
    ".",
    "../escape",
    "iterations/../escape",
    "iterations//001",
    "./iterations/001",
    "/absolute",
    "iterations\\001"
  ])("rejects escaping or non-normalized relative path %s", async (relativePath) => {
    const root = await claimLoopOutputRoot({ cwd: await tempDir(), outDir: "loop" });
    expect(() => resolveLoopRelativePath(root, relativePath)).toThrow(/normalized relative path|escapes/u);
  });

  it("atomically replaces the summary with validated JSON", async () => {
    const root = await claimLoopOutputRoot({ cwd: await tempDir(), outDir: "loop" });
    const running = summaryFor("running");
    await writeLoopSummaryAtomic(root, running, { uniqueSuffix: () => "running" });
    const terminal = summaryFor("already-clean");
    await writeLoopSummaryAtomic(root, terminal, { uniqueSuffix: () => "terminal" });

    const stored = JSON.parse(await readFile(root.summaryPath, "utf8")) as LoopSummary;
    expect(stored).toEqual(terminal);
    expect((await readdir(root.absolutePath)).filter((name) => name.startsWith(".loop-summary-"))).toEqual([]);
  });

  it("cleans the unique temporary sibling when rename fails", async () => {
    const root = await claimLoopOutputRoot({ cwd: await tempDir(), outDir: "loop" });
    await expect(writeLoopSummaryAtomic(root, summaryFor("already-clean"), {
      uniqueSuffix: () => "rename-failure",
      rename: async () => {
        throw new Error("rename failed");
      }
    })).rejects.toThrow("rename failed");

    expect((await readdir(root.absolutePath)).filter((name) => name.includes("loop-summary"))).toEqual([]);
  });

  it("validates before creating a temporary file", async () => {
    const root = await claimLoopOutputRoot({ cwd: await tempDir(), outDir: "loop" });
    const invalid = { ...summaryFor("already-clean"), commandSha256: "raw-command" } as LoopSummary;
    await expect(writeLoopSummaryAtomic(root, invalid)).rejects.toThrow(/commandSha256/u);
    expect(await readdir(root.absolutePath)).toEqual([]);
  });
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "design-harness-loop-output-"));
  tempDirs.push(dir);
  return dir;
}

function summaryFor(status: "running" | "already-clean"): LoopSummary {
  const progress = computeDeterministicFailureProgress([]);
  return {
    schemaVersion: LOOP_SUMMARY_SCHEMA_VERSION,
    harnessVersion: "0.6.0",
    loopRunId: "loop-output-test",
    target: { kind: "url", url: "http://localhost:3000/" },
    condition: LOOP_CONDITION,
    budget: { maxIters: 3, agentTimeoutMs: 3_000 },
    status,
    exitCode: status === "running" ? null : 0,
    commandSha256: hashLoopAgentCommand("repair"),
    artifacts: { summaryPath: "loop-summary.json" },
    audits: status === "running" ? [] : [{
      iteration: 0,
      runId: "loop-output-test-baseline",
      status: "success",
      deterministicFailureCount: 0,
      progress: { version: progress.version, fingerprint: progress.fingerprint },
      artifacts: {
        directory: "iterations/000-baseline",
        metadata: "iterations/000-baseline/metadata.json",
        audit: "iterations/000-baseline/audit.json",
        report: "iterations/000-baseline/report.md",
        reportManifest: "iterations/000-baseline/report-manifest.json"
      }
    }],
    agents: []
  };
}

import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createExampleAuditResult, createExampleMetadata } from "@design-harness/core";
import { writeAuditArtifacts } from "./output.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((tempDir) => rm(tempDir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("writeAuditArtifacts", () => {
  it("writes metadata, audit, report, and report manifest", async () => {
    const outDir = await tempDir();
    await writeAuditArtifacts({
      outDir,
      auditResult: createExampleAuditResult(),
      metadata: createExampleMetadata()
    });

    await expect(stat(join(outDir, "metadata.json"))).resolves.toBeTruthy();
    await expect(stat(join(outDir, "audit.json"))).resolves.toBeTruthy();
    await expect(stat(join(outDir, "report.md"))).resolves.toBeTruthy();
    await expect(stat(join(outDir, "report-manifest.json"))).resolves.toBeTruthy();

    const report = await readFile(join(outDir, "report.md"), "utf8");
    const reportManifest = JSON.parse(await readFile(join(outDir, "report-manifest.json"), "utf8")) as {
      sections: string[];
    };
    expect(reportManifest.sections).toEqual([
      "Run Summary",
      "Advisory Score",
      "Findings",
      "Source-Backed Criteria",
      "Evidence Links",
      "Recommendations",
      "Iteration Prompt Scaffold",
      "Optional Subjective Critique"
    ]);
    expect(report).not.toContain("## Notices");
    expect(report).toContain("## Optional Subjective Critique");
  });

  it("keeps notice-bearing report content and manifest sections in parity", async () => {
    const outDir = await tempDir();
    const auditResult = createExampleAuditResult();
    auditResult.status = "partial";
    auditResult.failedChecks = ["desktop:screenshot"];
    auditResult.notices = [{
      code: "copy-surface-unsupported-adapter",
      message: "A configured surface adapter is unavailable."
    }];
    const metadata = createExampleMetadata();
    metadata.status = auditResult.status;
    metadata.failedChecks = [...auditResult.failedChecks];

    await writeAuditArtifacts({
      outDir,
      auditResult,
      metadata
    });

    const report = await readFile(join(outDir, "report.md"), "utf8");
    const reportManifest = JSON.parse(await readFile(join(outDir, "report-manifest.json"), "utf8")) as {
      sections: string[];
    };
    expect(reportManifest.sections).toEqual([
      "Run Summary",
      "Failed Checks",
      "Notices",
      "Advisory Score",
      "Findings",
      "Source-Backed Criteria",
      "Evidence Links",
      "Recommendations",
      "Iteration Prompt Scaffold",
      "Optional Subjective Critique"
    ]);
    expect(report).toContain("## Failed Checks");
    expect(report).toContain("## Notices");
    expect(reportManifest.sections).toContain("Optional Subjective Critique");
  });

  it("rejects schema-invalid audit artifacts", async () => {
    const auditResult = createExampleAuditResult();
    delete (auditResult as unknown as { failedChecks?: string[] }).failedChecks;

    await expect(
      writeAuditArtifacts({
        outDir: await tempDir(),
        auditResult,
        metadata: createExampleMetadata()
      })
    ).rejects.toThrow("Validation failed");
  });

  it("rejects integrity-invalid audit artifacts", async () => {
    const auditResult = createExampleAuditResult();
    auditResult.findings[0].evidenceRefs = ["missing-evidence"];

    await expect(
      writeAuditArtifacts({
        outDir: await tempDir(),
        auditResult,
        metadata: createExampleMetadata()
      })
    ).rejects.toThrow("integrity failed");
  });
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "design-harness-output-"));
  tempDirs.push(dir);
  return dir;
}

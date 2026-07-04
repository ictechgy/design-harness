import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  HARNESS_VERSION,
  SCHEMA_VERSION,
  assertAuditResultIntegrity,
  assertValidSchema,
  renderMarkdownReport,
  type AuditResult,
  type ReportManifest,
  type RunMetadata
} from "@design-harness/core";

export interface WriteAuditArtifactsInput {
  outDir: string;
  auditResult: AuditResult;
  metadata: RunMetadata;
}

export async function writeAuditArtifacts(input: WriteAuditArtifactsInput): Promise<void> {
  await mkdir(input.outDir, { recursive: true });
  assertValidSchema("audit-result", input.auditResult);
  assertAuditResultIntegrity(input.auditResult);
  assertValidSchema("metadata", input.metadata);

  const metadataPath = join(input.outDir, "metadata.json");
  const auditPath = join(input.outDir, "audit.json");
  const reportPath = join(input.outDir, "report.md");
  const reportManifestPath = join(input.outDir, "report-manifest.json");
  const reportManifest: ReportManifest = {
    schemaVersion: SCHEMA_VERSION,
    harnessVersion: HARNESS_VERSION,
    runId: input.auditResult.runId,
    format: "markdown",
    reportPath: "report.md",
    sourceAuditPath: "audit.json",
    sections: [
      "Run Summary",
      "Advisory Score",
      "Deterministic Findings",
      "Evidence Links",
      "Recommendations",
      "Iteration Prompt Scaffold",
      "Optional Subjective Critique"
    ],
    createdAt: new Date().toISOString()
  };
  assertValidSchema("report", reportManifest);

  await writeFile(metadataPath, `${JSON.stringify(input.metadata, null, 2)}\n`);
  await writeFile(auditPath, `${JSON.stringify(input.auditResult, null, 2)}\n`);
  await writeFile(reportPath, renderMarkdownReport({ auditResult: input.auditResult }));
  await writeFile(reportManifestPath, `${JSON.stringify(reportManifest, null, 2)}\n`);
}

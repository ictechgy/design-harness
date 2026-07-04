import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assertValidSchema, renderMarkdownReport, type AuditResult, type RunMetadata } from "@design-harness/core";

export interface WriteAuditArtifactsInput {
  outDir: string;
  auditResult: AuditResult;
  metadata: RunMetadata;
}

export async function writeAuditArtifacts(input: WriteAuditArtifactsInput): Promise<void> {
  await mkdir(input.outDir, { recursive: true });
  assertValidSchema("audit-result", input.auditResult);

  const metadataPath = join(input.outDir, "metadata.json");
  const auditPath = join(input.outDir, "audit.json");
  const reportPath = join(input.outDir, "report.md");

  await writeFile(metadataPath, `${JSON.stringify(input.metadata, null, 2)}\n`);
  await writeFile(auditPath, `${JSON.stringify(input.auditResult, null, 2)}\n`);
  await writeFile(reportPath, renderMarkdownReport({ auditResult: input.auditResult }));
}

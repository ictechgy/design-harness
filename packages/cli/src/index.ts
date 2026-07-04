#!/usr/bin/env node
import { auditUrl, BrowserUnavailableError } from "@design-harness/visual-audit";
import { helpText, parseArgs } from "./args.js";
import { writeAuditArtifacts } from "./output.js";
import { assertLocalHttpUrl } from "./url.js";

async function main(argv: string[]): Promise<number> {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error("");
    console.error(helpText());
    return 1;
  }

  if (args.command === "help") {
    console.log(helpText());
    return 0;
  }

  try {
    const url = assertLocalHttpUrl(args.url);
    const result = await auditUrl({
      url,
      outDir: args.outDir,
      timeoutMs: args.timeoutMs
    });
    await writeAuditArtifacts({
      outDir: args.outDir,
      auditResult: result.auditResult,
      metadata: result.metadata
    });
    const partial = result.auditResult.status === "partial";
    console.log(`Design Harness audit ${result.auditResult.status}: ${args.outDir}`);
    console.log(`Report: ${args.outDir}/report.md`);
    if (partial && !args.allowPartial) {
      console.error("Audit completed with partial artifacts. Re-run with --allow-partial to treat this as success.");
      return 2;
    }
    return 0;
  } catch (error) {
    if (error instanceof BrowserUnavailableError) {
      console.error(error.message);
      return 1;
    }
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

main(process.argv.slice(2))
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });

import type { CopyStyle } from "@design-harness/core";
import {
  BrowserUnavailableError,
  auditUrl,
  type AuditUrlOptions,
  type AuditUrlResult
} from "@design-harness/visual-audit";
import { helpText, parseArgs } from "./args.js";
import { loadCopyStyleFile, type LoadCopyStyleOptions } from "./copy-style.js";
import {
  runGuideCommand,
  type GuideCommandArgs,
  type GuideRunDependencies,
  type GuideRunResult
} from "./guide-run.js";
import { writeAuditArtifacts, type WriteAuditArtifactsInput } from "./output.js";
import { assertLocalHttpUrl } from "./url.js";

export interface RunCliDependencies {
  audit?: (options: AuditUrlOptions) => Promise<AuditUrlResult>;
  loadCopyStyle?: (path: string, options?: LoadCopyStyleOptions) => Promise<CopyStyle>;
  runGuide?: (args: GuideCommandArgs, dependencies?: GuideRunDependencies) => Promise<GuideRunResult>;
  writeArtifacts?: (input: WriteAuditArtifactsInput) => Promise<void>;
  assertUrl?: (url: string) => string;
  cwd?: () => string;
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
}

export async function runCli(argv: string[], dependencies: RunCliDependencies = {}): Promise<number> {
  const stdout = dependencies.stdout ?? console.log;
  const stderr = dependencies.stderr ?? console.error;
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    stderr(errorMessage(error));
    stderr("");
    stderr(helpText());
    return 1;
  }

  if (args.command === "help") {
    stdout(helpText(args.scope));
    return 0;
  }

  if (args.command === "guide") {
    try {
      const result = await (dependencies.runGuide ?? runGuideCommand)(args, {
        cwd: dependencies.cwd ?? process.cwd
      });
      renderGuideResult(result, stdout, stderr);
      return result.ok ? 0 : 1;
    } catch (error) {
      stderr(errorMessage(error));
      return 1;
    }
  }

  try {
    const url = (dependencies.assertUrl ?? assertLocalHttpUrl)(args.url);
    const copyStyle = args.copyStylePath
      ? await (dependencies.loadCopyStyle ?? loadCopyStyleFile)(args.copyStylePath, {
          cwd: (dependencies.cwd ?? process.cwd)()
        })
      : undefined;
    const auditOptions: AuditUrlOptions = {
      url,
      outDir: args.outDir,
      timeoutMs: args.timeoutMs
    };
    if (copyStyle) {
      auditOptions.copyStyle = copyStyle;
    }

    const result = await (dependencies.audit ?? auditUrl)(auditOptions);
    await (dependencies.writeArtifacts ?? writeAuditArtifacts)({
      outDir: args.outDir,
      auditResult: result.auditResult,
      metadata: result.metadata
    });
    const partial = result.auditResult.status === "partial";
    stdout(`Design Harness audit ${result.auditResult.status}: ${args.outDir}`);
    stdout(`Report: ${args.outDir}/report.md`);
    if (partial && !args.allowPartial) {
      stderr("Audit completed with partial artifacts. Re-run with --allow-partial to treat this as success.");
      return 2;
    }
    return 0;
  } catch (error) {
    if (error instanceof BrowserUnavailableError) {
      stderr(error.message);
      return 1;
    }
    stderr(errorMessage(error));
    return 1;
  }
}

function renderGuideResult(
  result: GuideRunResult,
  stdout: (message: string) => void,
  stderr: (message: string) => void
): void {
  stdout(`Design Harness guide ${result.action} ${result.ok ? "ok" : "drift"}: ${result.targetDir}`);
  stdout(`Profile: ${result.profileId}; catalog: ${result.catalogVersion}; source: sha256:${result.sourceHash.slice(0, 12)}`);
  for (const artifact of result.artifacts) {
    stdout(`${artifact.name}: ${artifact.checkStatus ?? artifact.status}`);
  }
  stdout(`${result.tokenEstimate.method}: ${result.tokenEstimate.estimated}/${result.tokenEstimate.ceiling}`);
  if (!result.ok) {
    stderr("Guide check found stale or missing owned artifacts.");
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

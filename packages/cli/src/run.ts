import {
  projectColorAdherencePolicy,
  projectFontFamilyAdherencePolicy,
  projectSpacingAdherencePolicy,
  projectVisualMetricsRuntimePolicies,
  type ColorAdherencePolicy,
  type CopyStyle,
  type DensityComplexityBudgetPolicy,
  type DesignGuide,
  type FontFamilyAdherencePolicy,
  type PaletteDisciplineBudgetPolicy,
  type SpacingAdherencePolicy,
  type TypographyVariantBudgetPolicy
} from "@design-harness/core";
import {
  BrowserUnavailableError,
  auditUrl,
  prepareKiwiMorphologyAnalyzer,
  type AuditUrlOptions,
  type AuditUrlResult,
  type MorphologyCopyAnalyzer,
  type PrepareKiwiMorphologyAnalyzerOptions
} from "@design-harness/visual-audit";
import {
  helpText,
  parseArgs,
  type AuditCommandArgs,
  type LoopCommandArgs
} from "./args.js";
import { loadCopyStyleFile, type LoadCopyStyleOptions } from "./copy-style.js";
import { loadDesignGuideFile, type LoadDesignGuideOptions } from "./design-guide.js";
import {
  runGuideCommand,
  type GuideCommandArgs,
  type GuideRunDependencies,
  type GuideRunResult
} from "./guide-run.js";
import {
  runLoop,
  type LoopRunDependencies,
  type LoopRunInput,
  type LoopRunResult
} from "./loop-run.js";
import { writeAuditArtifacts, type WriteAuditArtifactsInput } from "./output.js";
import { assertLocalHttpUrl } from "./url.js";

export interface RunCliDependencies {
  audit?: (options: AuditUrlOptions) => Promise<AuditUrlResult>;
  loadDesignGuide?: (path: string, options?: LoadDesignGuideOptions) => Promise<DesignGuide>;
  loadCopyStyle?: (path: string, options?: LoadCopyStyleOptions) => Promise<CopyStyle>;
  prepareKiwiMorphology?: (
    modelDir: string,
    options?: PrepareKiwiMorphologyAnalyzerOptions
  ) => Promise<MorphologyCopyAnalyzer>;
  runGuide?: (args: GuideCommandArgs, dependencies?: GuideRunDependencies) => Promise<GuideRunResult>;
  runLoop?: (input: LoopRunInput, dependencies?: LoopRunDependencies) => Promise<LoopRunResult>;
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
    const prepared = await prepareAuditConfiguration(args, dependencies);
    if (args.command === "loop") {
      const loopInput: LoopRunInput = {
        url: prepared.url,
        outDir: args.outDir,
        until: args.until,
        maxIters: args.maxIters,
        agentCmd: args.agentCmd,
        agentTimeoutMs: args.agentTimeoutMs,
        cwd: prepared.invocationCwd as string,
        timeoutMs: args.timeoutMs
      };
      if (prepared.copyStyle) {
        loopInput.copyStyle = prepared.copyStyle;
      }
      if (prepared.morphologyCopyAnalyzer) {
        loopInput.morphologyCopyAnalyzer = prepared.morphologyCopyAnalyzer;
      }
      if (prepared.fontFamilyPolicy) {
        loopInput.fontFamilyPolicy = prepared.fontFamilyPolicy;
      }
      if (prepared.colorPolicy) {
        loopInput.colorPolicy = prepared.colorPolicy;
      }
      if (prepared.spacingPolicy) {
        loopInput.spacingPolicy = prepared.spacingPolicy;
      }
      if (prepared.typographyVariantsPolicy) {
        loopInput.typographyVariantsPolicy = prepared.typographyVariantsPolicy;
      }
      if (prepared.paletteDisciplinePolicy) {
        loopInput.paletteDisciplinePolicy = prepared.paletteDisciplinePolicy;
      }
      if (prepared.densityComplexityPolicy) {
        loopInput.densityComplexityPolicy = prepared.densityComplexityPolicy;
      }
      const loopDependencies: LoopRunDependencies = {};
      if (dependencies.audit) {
        loopDependencies.audit = dependencies.audit;
      }
      if (dependencies.writeArtifacts) {
        loopDependencies.writeArtifacts = dependencies.writeArtifacts;
      }

      stderr(
        "Warning: --agent-cmd executes arbitrary code with the caller's permissions and inherited environment; "
        + "Design Harness provides no sandbox or network boundary."
      );
      const result = await (dependencies.runLoop ?? runLoop)(loopInput, loopDependencies);
      stdout(`Design Harness loop ${result.summary.status}: ${args.outDir}`);
      stdout(`Summary: ${args.outDir}/loop-summary.json`);
      if (result.exitCode === 2) {
        stderr("Loop stopped because the latest audit is partial; no later agent pass was run.");
      } else if (result.exitCode === 3) {
        stderr("Loop stopped with valid evidence before the deterministic-failure condition was reached.");
      } else if (result.exitCode === 1) {
        stderr("Loop stopped after an audit, agent, timeout, or summary error.");
      }
      return result.exitCode;
    }

    const auditOptions: AuditUrlOptions = {
      url: prepared.url,
      outDir: args.outDir,
      timeoutMs: args.timeoutMs
    };
    if (prepared.copyStyle) {
      auditOptions.copyStyle = prepared.copyStyle;
    }
    if (prepared.morphologyCopyAnalyzer) {
      auditOptions.morphologyCopyAnalyzer = prepared.morphologyCopyAnalyzer;
    }
    if (prepared.fontFamilyPolicy) {
      auditOptions.fontFamilyPolicy = prepared.fontFamilyPolicy;
    }
    if (prepared.colorPolicy) {
      auditOptions.colorPolicy = prepared.colorPolicy;
    }
    if (prepared.spacingPolicy) {
      auditOptions.spacingPolicy = prepared.spacingPolicy;
    }
    if (prepared.typographyVariantsPolicy) {
      auditOptions.typographyVariantsPolicy = prepared.typographyVariantsPolicy;
    }
    if (prepared.paletteDisciplinePolicy) {
      auditOptions.paletteDisciplinePolicy = prepared.paletteDisciplinePolicy;
    }
    if (prepared.densityComplexityPolicy) {
      auditOptions.densityComplexityPolicy = prepared.densityComplexityPolicy;
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

interface PreparedAuditConfiguration {
  url: string;
  invocationCwd?: string;
  copyStyle?: CopyStyle;
  morphologyCopyAnalyzer?: MorphologyCopyAnalyzer;
  fontFamilyPolicy?: FontFamilyAdherencePolicy;
  colorPolicy?: ColorAdherencePolicy;
  spacingPolicy?: SpacingAdherencePolicy;
  typographyVariantsPolicy?: TypographyVariantBudgetPolicy;
  paletteDisciplinePolicy?: PaletteDisciplineBudgetPolicy;
  densityComplexityPolicy?: DensityComplexityBudgetPolicy;
}

async function prepareAuditConfiguration(
  args: AuditCommandArgs | LoopCommandArgs,
  dependencies: RunCliDependencies
): Promise<PreparedAuditConfiguration> {
  const url = (dependencies.assertUrl ?? assertLocalHttpUrl)(args.url);
  const needsInvocationCwd = args.command === "loop"
    || Boolean(args.guidePath || args.copyStylePath || args.kiwiModelDir);
  const invocationCwd = needsInvocationCwd
    ? (dependencies.cwd ?? process.cwd)()
    : undefined;
  const designGuide = args.guidePath
    ? await (dependencies.loadDesignGuide ?? loadDesignGuideFile)(args.guidePath, { cwd: invocationCwd })
    : undefined;
  const fontFamilyPolicy = designGuide
    ? projectFontFamilyAdherencePolicy(designGuide)
    : undefined;
  const colorPolicy = designGuide
    ? projectColorAdherencePolicy(designGuide)
    : undefined;
  const spacingPolicy = designGuide
    ? projectSpacingAdherencePolicy(designGuide)
    : undefined;
  const visualMetricsPolicies = designGuide
    ? projectVisualMetricsRuntimePolicies(designGuide)
    : {};
  const copyStyle = args.copyStylePath
    ? await (dependencies.loadCopyStyle ?? loadCopyStyleFile)(args.copyStylePath, { cwd: invocationCwd })
    : undefined;
  if (args.kiwiModelDir && !copyStyle) {
    throw new Error("--kiwi-model-dir requires --copy.");
  }
  if (
    args.kiwiModelDir
    && copyStyle
    && copyStyle.locale !== "ko"
    && copyStyle.locale !== "ko-KR"
  ) {
    throw new Error("--kiwi-model-dir requires a --copy file whose locale is ko or ko-KR.");
  }
  const morphologyCopyAnalyzer = args.kiwiModelDir
    ? await (dependencies.prepareKiwiMorphology ?? prepareKiwiMorphologyAnalyzer)(
        args.kiwiModelDir,
        { cwd: invocationCwd }
      )
    : undefined;
  return {
    url,
    invocationCwd,
    copyStyle,
    morphologyCopyAnalyzer,
    fontFamilyPolicy,
    colorPolicy,
    spacingPolicy,
    ...(visualMetricsPolicies.typographyVariants
      ? { typographyVariantsPolicy: visualMetricsPolicies.typographyVariants }
      : {}),
    ...(visualMetricsPolicies.paletteDiscipline
      ? { paletteDisciplinePolicy: visualMetricsPolicies.paletteDiscipline }
      : {}),
    ...(visualMetricsPolicies.densityComplexity
      ? { densityComplexityPolicy: visualMetricsPolicies.densityComplexity }
      : {})
  };
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
  for (const notice of result.notices) {
    stdout(`notice ${notice.code}: ${notice.message}`);
  }
  if (!result.ok) {
    stderr("Guide check found stale or missing owned artifacts.");
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

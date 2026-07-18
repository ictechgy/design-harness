import {
  GUIDE_TOKEN_HARD_CEILING,
  GuideCompileError,
  assertGuideTokenCeiling,
  compileDesignGuide,
  type CopyStyle,
  type DesignGuide,
  type GuideCompilationResult
} from "@design-harness/core";
import type { GuideCheckCommandArgs, GuideCompileCommandArgs } from "./args.js";
import {
  CopyStyleLoadError,
  loadCopyStyleFile,
  type LoadCopyStyleOptions
} from "./copy-style.js";
import {
  DesignGuideLoadError,
  loadDesignGuideFile,
  type LoadDesignGuideOptions
} from "./design-guide.js";
import { GuideOperationError } from "./guide-errors.js";
import {
  checkGuideTargets,
  defaultGuideFileSystem,
  planGuideTargets,
  recheckGuideTargetPlans,
  recheckResolvedGuideInputs,
  resolveGuidePaths,
  type GuideCheckResult,
  type GuideFileSystem,
  type GuideTargetName,
  type GuideTargetPlan,
  type ResolveGuidePathsInput,
  type ResolvedGuidePaths
} from "./guide-targets.js";
import {
  materializeGuideTargets,
  type GuideMaterializationResult
} from "./guide-transaction.js";

export type GuideCommandArgs = GuideCompileCommandArgs | GuideCheckCommandArgs;

export interface GuideRunArtifactResult {
  name: GuideTargetName;
  status: "changed" | "unchanged";
  checkStatus?: "current" | "stale" | "missing";
}

export interface GuideRunResult {
  action: GuideCommandArgs["action"];
  ok: boolean;
  targetDir: string;
  profileId: string;
  catalogVersion: string;
  sourceHash: string;
  tokenEstimate: {
    method: string;
    estimated: number;
    ceiling: number;
  };
  artifacts: readonly GuideRunArtifactResult[];
}

export interface GuideRunDependencies {
  cwd?: () => string;
  fileSystem?: GuideFileSystem;
  resolvePaths?: (
    input: ResolveGuidePathsInput,
    fileSystem?: GuideFileSystem
  ) => Promise<ResolvedGuidePaths>;
  loadDesignGuide?: (
    path: string,
    options?: LoadDesignGuideOptions
  ) => Promise<DesignGuide>;
  loadCopyStyle?: (
    path: string,
    options?: LoadCopyStyleOptions
  ) => Promise<CopyStyle>;
  compile?: (guide: DesignGuide, copyStyle?: CopyStyle) => GuideCompilationResult;
  planTargets?: (
    input: Parameters<typeof planGuideTargets>[0],
    fileSystem?: GuideFileSystem
  ) => Promise<GuideTargetPlan[]>;
  recheckInputs?: (
    paths: ResolvedGuidePaths,
    fileSystem?: GuideFileSystem
  ) => Promise<void>;
  recheckPlans?: (
    plans: readonly GuideTargetPlan[],
    fileSystem?: GuideFileSystem
  ) => Promise<void>;
  checkTargets?: (plans: readonly GuideTargetPlan[]) => GuideCheckResult;
  materialize?: (
    plans: readonly GuideTargetPlan[],
    fileSystem?: GuideFileSystem,
    options?: Parameters<typeof materializeGuideTargets>[2]
  ) => Promise<GuideMaterializationResult>;
}

/**
 * Runs one already-parsed guide command. Containment is established before a
 * config loader is called, and every read/compile/plan gate finishes before a
 * compile command is allowed to create a private transaction stage.
 */
export async function runGuideCommand(
  args: GuideCommandArgs,
  dependencies: GuideRunDependencies = {}
): Promise<GuideRunResult> {
  const cwd = (dependencies.cwd ?? process.cwd)();
  const fileSystem = dependencies.fileSystem ?? defaultGuideFileSystem();
  const paths = await (dependencies.resolvePaths ?? resolveGuidePaths)({
    cwd,
    targetDir: args.targetDir,
    guidePath: args.guidePath,
    ...(args.copyStylePath === undefined ? {} : { copyStylePath: args.copyStylePath })
  }, fileSystem);

  let guide: DesignGuide;
  let copyStyle: CopyStyle | undefined;
  try {
    guide = await (dependencies.loadDesignGuide ?? loadDesignGuideFile)(
      paths.guidePath,
      { cwd: paths.cwd, requireRealPath: true, expectedIdentity: paths.guideIdentity }
    );
    copyStyle = paths.copyStylePath === undefined
      ? undefined
      : await (dependencies.loadCopyStyle ?? loadCopyStyleFile)(paths.copyStylePath, {
        cwd: paths.cwd,
        requireRealPath: true,
        expectedIdentity: paths.copyStyleIdentity
      });
  } catch (error) {
    if (error instanceof DesignGuideLoadError) {
      throw new GuideOperationError(error.stage, "--guide", error.detail);
    }
    if (error instanceof CopyStyleLoadError) {
      throw new GuideOperationError(error.stage, "--copy", error.detail);
    }
    throw error;
  }

  let compilation: GuideCompilationResult;
  try {
    compilation = (dependencies.compile ?? compileDesignGuide)(guide, copyStyle);
    assertGuideTokenCeiling(
      compilation.tokenEstimate,
      args.action === "check" ? args.maxTokens : GUIDE_TOKEN_HARD_CEILING
    );
  } catch (error) {
    if (error instanceof GuideCompileError) {
      throw new GuideOperationError(error.phase, "design-guide", error.message);
    }
    throw error;
  }

  const plans = await (dependencies.planTargets ?? planGuideTargets)({
    paths,
    markdown: compilation.markdown,
    designTokensJson: compilation.designTokensJson
  }, fileSystem);
  const ceiling = args.action === "check" ? args.maxTokens : GUIDE_TOKEN_HARD_CEILING;

  if (args.action === "check") {
    await (dependencies.recheckInputs ?? recheckResolvedGuideInputs)(paths, fileSystem);
    await (dependencies.recheckPlans ?? recheckGuideTargetPlans)(plans, fileSystem);
    await (dependencies.recheckInputs ?? recheckResolvedGuideInputs)(paths, fileSystem);
    const check = (dependencies.checkTargets ?? checkGuideTargets)(plans);
    return resultFromCheck(args, compilation, ceiling, plans, check);
  }

  const materialized = await (dependencies.materialize ?? materializeGuideTargets)(plans, fileSystem, {
    revalidateInputs: () => (dependencies.recheckInputs ?? recheckResolvedGuideInputs)(paths, fileSystem)
  });
  return {
    action: args.action,
    ok: true,
    targetDir: args.targetDir,
    profileId: compilation.profileId,
    catalogVersion: compilation.catalogVersion,
    sourceHash: compilation.sourceHash,
    tokenEstimate: {
      method: compilation.tokenEstimate.method,
      estimated: compilation.tokenEstimate.estimated,
      ceiling
    },
    artifacts: materialized.artifacts
  };
}

function resultFromCheck(
  args: GuideCommandArgs & { action: "check" },
  compilation: GuideCompilationResult,
  ceiling: number,
  plans: readonly GuideTargetPlan[],
  check: GuideCheckResult
): GuideRunResult {
  const checkByName = new Map(check.artifacts.map((artifact) => [artifact.name, artifact.status]));
  return {
    action: args.action,
    ok: check.ok,
    targetDir: args.targetDir,
    profileId: compilation.profileId,
    catalogVersion: compilation.catalogVersion,
    sourceHash: compilation.sourceHash,
    tokenEstimate: {
      method: compilation.tokenEstimate.method,
      estimated: compilation.tokenEstimate.estimated,
      ceiling
    },
    artifacts: plans.map((plan) => ({
      name: plan.name,
      status: plan.status,
      checkStatus: checkByName.get(plan.name) ?? "stale"
    }))
  };
}

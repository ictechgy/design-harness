import { randomUUID } from "node:crypto";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { posix } from "node:path";
import { assertLoopSummaryIntegrity, type LoopSummary } from "./loop-summary.js";

export interface LoopOutputRoot {
  absolutePath: string;
  summaryPath: string;
  summaryRelativePath: "loop-summary.json";
}

export interface LoopIterationPaths {
  iteration: number;
  relativeDir: string;
  absoluteDir: string;
  metadataRelativePath: string;
  metadataPath: string;
  auditRelativePath: string;
  auditPath: string;
  reportRelativePath: string;
  reportPath: string;
  reportManifestRelativePath: string;
  reportManifestPath: string;
}

export interface ClaimLoopOutputRootInput {
  outDir: string;
  cwd: string;
}

export interface LoopOutputDependencies {
  mkdir?: typeof mkdir;
  open?: typeof open;
  rename?: typeof rename;
  unlink?: typeof unlink;
  uniqueSuffix?: () => string;
}

/**
 * Creates missing parents, then claims the final root with one non-recursive mkdir.
 * An existing root is always an error; callers never reuse or clear it.
 */
export async function claimLoopOutputRoot(
  input: ClaimLoopOutputRootInput,
  dependencies: LoopOutputDependencies = {}
): Promise<LoopOutputRoot> {
  if (input.outDir.includes("\0") || input.cwd.includes("\0")) {
    throw new Error("Loop output paths must not contain NUL characters.");
  }
  const makeDirectory = dependencies.mkdir ?? mkdir;
  const absolutePath = resolve(input.cwd, input.outDir);
  await makeDirectory(dirname(absolutePath), { recursive: true });
  await makeDirectory(absolutePath);
  return {
    absolutePath,
    summaryPath: resolveLoopRelativePath({ absolutePath }, "loop-summary.json"),
    summaryRelativePath: "loop-summary.json"
  };
}

export function loopIterationPaths(root: Pick<LoopOutputRoot, "absolutePath">, iteration: number): LoopIterationPaths {
  if (!Number.isInteger(iteration) || iteration < 0 || iteration > 10) {
    throw new Error("Loop iteration must be an integer from 0 to 10.");
  }
  const iterationName = iteration === 0 ? "000-baseline" : String(iteration).padStart(3, "0");
  const relativeDir = `iterations/${iterationName}`;
  const metadataRelativePath = `${relativeDir}/metadata.json`;
  const auditRelativePath = `${relativeDir}/audit.json`;
  const reportRelativePath = `${relativeDir}/report.md`;
  const reportManifestRelativePath = `${relativeDir}/report-manifest.json`;
  return {
    iteration,
    relativeDir,
    absoluteDir: resolveLoopRelativePath(root, relativeDir),
    metadataRelativePath,
    metadataPath: resolveLoopRelativePath(root, metadataRelativePath),
    auditRelativePath,
    auditPath: resolveLoopRelativePath(root, auditRelativePath),
    reportRelativePath,
    reportPath: resolveLoopRelativePath(root, reportRelativePath),
    reportManifestRelativePath,
    reportManifestPath: resolveLoopRelativePath(root, reportManifestRelativePath)
  };
}

export function resolveLoopRelativePath(
  root: Pick<LoopOutputRoot, "absolutePath">,
  relativePath: string
): string {
  if (
    relativePath.length === 0
    || relativePath.includes("\\")
    || isAbsolute(relativePath)
    || posix.isAbsolute(relativePath)
    || posix.normalize(relativePath) !== relativePath
    || relativePath.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error(`Loop artifact path must be a normalized relative path: ${JSON.stringify(relativePath)}.`);
  }
  const absolutePath = resolve(root.absolutePath, ...relativePath.split("/"));
  const relativeToRoot = relative(resolve(root.absolutePath), absolutePath);
  if (
    relativeToRoot === ""
    || relativeToRoot === ".."
    || relativeToRoot.startsWith(`..${sep}`)
    || isAbsolute(relativeToRoot)
  ) {
    throw new Error(`Loop artifact path escapes the output root: ${JSON.stringify(relativePath)}.`);
  }
  return absolutePath;
}

/** Writes validated JSON through an exclusive temporary sibling and same-directory rename. */
export async function writeLoopSummaryAtomic(
  root: Pick<LoopOutputRoot, "absolutePath" | "summaryPath">,
  summary: LoopSummary,
  dependencies: LoopOutputDependencies = {}
): Promise<void> {
  assertLoopSummaryIntegrity(summary);
  const openFile = dependencies.open ?? open;
  const renameFile = dependencies.rename ?? rename;
  const removeFile = dependencies.unlink ?? unlink;
  const suffix = (dependencies.uniqueSuffix ?? randomUUID)();
  if (!/^[A-Za-z0-9-]+$/u.test(suffix)) {
    throw new Error("Loop summary temporary suffix is invalid.");
  }
  const expectedSummaryPath = resolveLoopRelativePath(root, "loop-summary.json");
  if (resolve(root.summaryPath) !== expectedSummaryPath) {
    throw new Error("Loop summary path must be loop-summary.json inside the output root.");
  }
  const temporaryPath = resolveLoopRelativePath(
    root,
    `.loop-summary-${process.pid}-${suffix}.tmp`
  );
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let temporaryCreated = false;
  try {
    handle = await openFile(temporaryPath, "wx", 0o600);
    temporaryCreated = true;
    await handle.writeFile(`${JSON.stringify(summary, null, 2)}\n`, "utf8");
    if (typeof handle.sync === "function") {
      await handle.sync();
    }
    await handle.close();
    handle = undefined;
    await renameFile(temporaryPath, expectedSummaryPath);
    temporaryCreated = false;
  } catch (error) {
    if (handle) {
      try {
        await handle.close();
      } catch {
        // Preserve the original write/sync/rename failure.
      }
    }
    if (temporaryCreated) {
      try {
        await removeFile(temporaryPath);
      } catch {
        // Cleanup is best effort and must not replace the primary error.
      }
    }
    throw error;
  }
}

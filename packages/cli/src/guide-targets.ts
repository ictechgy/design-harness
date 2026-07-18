import { constants } from "node:fs";
import {
  link as nodeLink,
  lstat as nodeLstat,
  mkdir as nodeMkdir,
  open as nodeOpen,
  realpath as nodeRealpath,
  rename as nodeRename,
  rmdir as nodeRmdir,
  unlink as nodeUnlink
} from "node:fs/promises";
import {
  isAbsolute,
  join,
  relative,
  resolve,
  sep
} from "node:path";
import { DESIGN_GUIDE_PROFILE_ID, GUIDE_CATALOG_VERSION } from "@design-harness/core";
import { GuideOperationError, errorDetail, type GuideSecondaryFailure } from "./guide-errors.js";

export const GUIDE_MARKER_BEGIN = "<!-- design-harness:guide:begin -->";
export const GUIDE_MARKER_END = "<!-- design-harness:guide:end -->";
export const MAX_GUIDE_TARGET_BYTES = 1024 * 1024;
export const NEW_GUIDE_FILE_MODE = 0o644;

export type GuideTargetName = "AGENTS.md" | "CLAUDE.md" | "DESIGN.md" | "design.tokens.json";

export interface GuideFileStat {
  dev: number | bigint;
  ino: number | bigint;
  size: number | bigint;
  mode: number | bigint;
  mtimeMs: number;
  ctimeMs: number;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

export interface GuideReadHandle {
  stat(): Promise<GuideFileStat>;
  read(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number | null
  ): Promise<{ bytesRead: number }>;
  close(): Promise<void>;
}

export interface GuideWriteHandle {
  stat(): Promise<GuideFileStat>;
  writeFile(data: Uint8Array): Promise<void>;
  chmod(mode: number): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

export interface GuideFileSystem {
  lstat(path: string): Promise<GuideFileStat>;
  realpath(path: string): Promise<string>;
  openRead(path: string): Promise<GuideReadHandle>;
  openExclusive(path: string, mode: number): Promise<GuideWriteHandle>;
  link(existingPath: string, newPath: string): Promise<void>;
  mkdir(path: string, mode: number): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  rmdir(path: string): Promise<void>;
  unlink(path: string): Promise<void>;
}

export interface ResolveGuidePathsInput {
  cwd: string;
  targetDir: string;
  guidePath: string;
  copyStylePath?: string;
}

export interface ResolvedGuidePaths {
  cwd: string;
  targetDir: string;
  targetIdentity: GuideNodeIdentity;
  guidePath: string;
  guideIdentity: GuideFileIdentity;
  copyStylePath?: string;
  copyStyleIdentity?: GuideFileIdentity;
  outputs: Record<GuideTargetName, string>;
}

export interface GuideNodeIdentity {
  dev: number | bigint;
  ino: number | bigint;
}

export interface GuideFileIdentity {
  dev: number | bigint;
  ino: number | bigint;
  size: number | bigint;
  mode: number | bigint;
  mtimeMs: number;
  ctimeMs: number;
}

export interface GuideTargetSnapshot {
  exists: boolean;
  content: Buffer;
  mode: number;
  identity?: GuideFileIdentity;
}

export interface GuideTargetPlan {
  name: GuideTargetName;
  path: string;
  relativePath: GuideTargetName;
  targetDir: string;
  targetIdentity: GuideNodeIdentity;
  status: "changed" | "unchanged";
  snapshot: GuideTargetSnapshot;
  nextContent: Buffer;
}

export interface PlanGuideTargetsInput {
  paths: ResolvedGuidePaths;
  markdown: string;
  designTokensJson: string;
}

export interface GuideCheckResult {
  ok: boolean;
  artifacts: ReadonlyArray<{ name: GuideTargetName; status: "current" | "stale" | "missing" }>;
}

const nodeGuideFileSystem: GuideFileSystem = {
  lstat: async (path) => nodeLstat(path) as unknown as GuideFileStat,
  realpath: nodeRealpath,
  openRead: async (path) => nodeOpen(path, readOpenFlags()) as unknown as GuideReadHandle,
  openExclusive: async (path, mode) => nodeOpen(path, exclusiveWriteOpenFlags(), mode) as unknown as GuideWriteHandle,
  link: nodeLink,
  mkdir: async (path, mode) => {
    await nodeMkdir(path, { mode });
  },
  rename: nodeRename,
  rmdir: nodeRmdir,
  unlink: nodeUnlink
};

export function defaultGuideFileSystem(): GuideFileSystem {
  return nodeGuideFileSystem;
}

export async function resolveGuidePaths(
  input: ResolveGuidePathsInput,
  fileSystem: GuideFileSystem = defaultGuideFileSystem()
): Promise<ResolvedGuidePaths> {
  assertRelativeArgument("--target", input.targetDir);
  assertRelativeArgument("--guide", input.guidePath);
  if (input.copyStylePath !== undefined) {
    assertRelativeArgument("--copy", input.copyStylePath);
  }

  let realCwd: string;
  try {
    realCwd = await fileSystem.realpath(resolve(input.cwd));
  } catch (error) {
    throw containmentError("--target", `cannot resolve invocation directory: ${errorDetail(error)}`);
  }

  const targetCandidate = resolve(realCwd, input.targetDir);
  assertWithin(realCwd, targetCandidate, "--target");
  await assertNoSymlinkComponents(realCwd, targetCandidate, "--target", true, fileSystem);

  let targetStats: GuideFileStat;
  try {
    targetStats = await fileSystem.lstat(targetCandidate);
  } catch (error) {
    throw containmentError("--target", `target directory must already exist: ${errorDetail(error)}`);
  }
  if (!targetStats.isDirectory() || targetStats.isSymbolicLink()) {
    throw containmentError("--target", "target must be an existing real directory");
  }

  let realTarget: string;
  try {
    realTarget = await fileSystem.realpath(targetCandidate);
  } catch (error) {
    throw containmentError("--target", `cannot resolve target directory: ${errorDetail(error)}`);
  }
  if (realTarget !== targetCandidate) {
    throw containmentError("--target", "target must not traverse symlinks");
  }
  let stableTargetStats: GuideFileStat;
  try {
    stableTargetStats = await fileSystem.lstat(targetCandidate);
  } catch (error) {
    throw containmentError("--target", `target directory changed during resolution: ${errorDetail(error)}`);
  }
  if (!stableTargetStats.isDirectory()
    || stableTargetStats.isSymbolicLink()
    || !sameNodeIdentity(nodeIdentityOf(targetStats), nodeIdentityOf(stableTargetStats))) {
    throw containmentError("--target", "target directory changed during resolution");
  }
  const targetIdentity = nodeIdentityOf(stableTargetStats);

  const guideInput = await resolveContainedInput(
    "--guide",
    input.guidePath,
    realCwd,
    realTarget,
    fileSystem
  );
  const copyStyleInput = input.copyStylePath === undefined
    ? undefined
    : await resolveContainedInput("--copy", input.copyStylePath, realCwd, realTarget, fileSystem);
  const guidePath = guideInput.path;
  const copyStylePath = copyStyleInput?.path;

  const outputs = Object.fromEntries(
    (["AGENTS.md", "CLAUDE.md", "DESIGN.md", "design.tokens.json"] as const).map((name) => [
      name,
      join(realTarget, name)
    ])
  ) as Record<GuideTargetName, string>;
  for (const [name, outputPath] of Object.entries(outputs) as Array<[GuideTargetName, string]>) {
    if (guidePath === outputPath || copyStylePath === outputPath) {
      throw containmentError(name, "configuration inputs must not overlap generated outputs inside --target");
    }
  }
  for (const [name, path] of Object.entries(outputs) as Array<[GuideTargetName, string]>) {
    await assertNoSymlinkComponents(realTarget, path, name, false, fileSystem);
  }

  return {
    cwd: realCwd,
    targetDir: realTarget,
    targetIdentity,
    guidePath,
    guideIdentity: guideInput.identity,
    ...(copyStyleInput === undefined
      ? {}
      : { copyStylePath: copyStyleInput.path, copyStyleIdentity: copyStyleInput.identity }),
    outputs
  };
}

export async function planGuideTargets(
  input: PlanGuideTargetsInput,
  fileSystem: GuideFileSystem = defaultGuideFileSystem()
): Promise<GuideTargetPlan[]> {
  await assertGuideTargetDirectory(input.paths, fileSystem);
  const markdown = input.markdown.replace(/\n+$/u, "");
  const guideBlock = markerBlock(markdown);
  const claudeBlock = markerBlock("@AGENTS.md");
  assertOwnedTokenJson(input.designTokensJson, "generated design.tokens.json");

  const plans: GuideTargetPlan[] = [];
  for (const name of ["AGENTS.md", "CLAUDE.md", "DESIGN.md", "design.tokens.json"] as const) {
    await assertGuideTargetDirectory(input.paths, fileSystem);
    const path = input.paths.outputs[name];
    const snapshot = await readGuideTargetSnapshot(path, name, fileSystem);
    const current = snapshot.exists ? decodeTarget(snapshot.content, name) : "";
    let next: string;
    if (name === "AGENTS.md" || name === "DESIGN.md") {
      next = planMarkerFile(current, guideBlock, name);
    } else if (name === "CLAUDE.md") {
      next = planClaudeFile(current, claudeBlock);
    } else {
      if (snapshot.exists) {
        assertOwnedTokenJson(current, name);
      }
      next = input.designTokensJson;
    }
    const nextContent = Buffer.from(next, "utf8");
    plans.push({
      name,
      path,
      relativePath: name,
      targetDir: input.paths.targetDir,
      targetIdentity: input.paths.targetIdentity,
      status: snapshot.exists && snapshot.content.equals(nextContent) ? "unchanged" : "changed",
      snapshot,
      nextContent
    });
  }
  await assertGuideTargetDirectory(input.paths, fileSystem);
  return plans;
}

export function checkGuideTargets(plans: readonly GuideTargetPlan[]): GuideCheckResult {
  const artifacts = plans.map((plan) => ({
    name: plan.name,
    status: !plan.snapshot.exists ? "missing" as const : plan.status === "changed" ? "stale" as const : "current" as const
  }));
  return {
    ok: artifacts.every((artifact) => artifact.status === "current"),
    artifacts
  };
}

export async function recheckResolvedGuideInputs(
  paths: ResolvedGuidePaths,
  fileSystem: GuideFileSystem = defaultGuideFileSystem()
): Promise<void> {
  await assertGuideTargetDirectory(paths, fileSystem);
  await recheckResolvedInput("--guide", paths.guidePath, paths.guideIdentity, paths, fileSystem);
  if (paths.copyStylePath && paths.copyStyleIdentity) {
    await recheckResolvedInput("--copy", paths.copyStylePath, paths.copyStyleIdentity, paths, fileSystem);
  }
  await assertGuideTargetDirectory(paths, fileSystem);
}

export async function recheckGuideTargetPlans(
  plans: readonly GuideTargetPlan[],
  fileSystem: GuideFileSystem = defaultGuideFileSystem()
): Promise<void> {
  if (plans.length === 0) {
    throw new TypeError("guide target plans must not be empty");
  }
  const root = plans[0];
  await assertGuideTargetDirectory(root, fileSystem);
  for (const plan of plans) {
    if (plan.targetDir !== root.targetDir
      || !sameNodeIdentity(plan.targetIdentity, root.targetIdentity)) {
      throw new TypeError("guide target plans must share one target directory identity");
    }
    await assertGuideTargetDirectory(plan, fileSystem);
    let stats: GuideFileStat;
    try {
      stats = await fileSystem.lstat(plan.path);
    } catch (error) {
      if (!plan.snapshot.exists && isMissing(error)) {
        continue;
      }
      throw new GuideOperationError(
        "concurrent-change",
        plan.relativePath,
        `target could not be rechecked: ${errorDetail(error)}`
      );
    }
    if (!plan.snapshot.exists) {
      throw new GuideOperationError(
        "concurrent-change",
        plan.relativePath,
        "target was created after preflight"
      );
    }
    if (stats.isSymbolicLink() || !stats.isFile() || !plan.snapshot.identity
      || !sameIdentity(plan.snapshot.identity, identityOf(stats))) {
      throw new GuideOperationError(
        "concurrent-change",
        plan.relativePath,
        "target identity changed after preflight"
      );
    }
  }
  await assertGuideTargetDirectory(root, fileSystem);
}

export async function assertGuideTargetDirectory(
  target: Pick<ResolvedGuidePaths, "targetDir" | "targetIdentity">,
  fileSystem: GuideFileSystem = defaultGuideFileSystem()
): Promise<void> {
  let stats: GuideFileStat;
  let realPath: string;
  try {
    stats = await fileSystem.lstat(target.targetDir);
    realPath = await fileSystem.realpath(target.targetDir);
  } catch (error) {
    throw new GuideOperationError(
      "concurrent-change",
      "--target",
      `target directory could not be rechecked: ${errorDetail(error)}`
    );
  }
  if (stats.isSymbolicLink()
    || !stats.isDirectory()
    || realPath !== target.targetDir
    || !sameNodeIdentity(target.targetIdentity, nodeIdentityOf(stats))) {
    throw new GuideOperationError(
      "concurrent-change",
      "--target",
      "target directory identity changed after containment"
    );
  }
}

async function recheckResolvedInput(
  label: "--guide" | "--copy",
  path: string,
  expected: GuideFileIdentity,
  target: ResolvedGuidePaths,
  fileSystem: GuideFileSystem
): Promise<void> {
  await assertGuideTargetDirectory(target, fileSystem);
  try {
    await assertNoSymlinkComponents(target.targetDir, path, label, true, fileSystem);
    const stats = await fileSystem.lstat(path);
    const realPath = await fileSystem.realpath(path);
    if (stats.isSymbolicLink()
      || !stats.isFile()
      || realPath !== path
      || !sameIdentity(expected, identityOf(stats))) {
      throw new Error("input identity changed");
    }
  } catch (error) {
    throw new GuideOperationError(
      "concurrent-change",
      label,
      `configuration input changed after containment: ${errorDetail(error)}`
    );
  }
}

export async function readGuideTargetSnapshot(
  path: string,
  displayPath: string,
  fileSystem: GuideFileSystem = defaultGuideFileSystem()
): Promise<GuideTargetSnapshot> {
  let pathStats: GuideFileStat;
  try {
    pathStats = await fileSystem.lstat(path);
  } catch (error) {
    if (isMissing(error)) {
      return { exists: false, content: Buffer.alloc(0), mode: NEW_GUIDE_FILE_MODE };
    }
    throw new GuideOperationError("read", displayPath, errorDetail(error));
  }
  if (pathStats.isSymbolicLink()) {
    throw containmentError(displayPath, "output must not be a symlink");
  }
  if (!pathStats.isFile()) {
    throw new GuideOperationError("read", displayPath, "target must be a regular file");
  }
  if (numericSize(pathStats.size) > MAX_GUIDE_TARGET_BYTES) {
    throw new GuideOperationError("size", displayPath, `file exceeds ${MAX_GUIDE_TARGET_BYTES} bytes`);
  }

  let handle: GuideReadHandle | undefined;
  let primary: GuideOperationError | undefined;
  let content: Buffer | undefined;
  try {
    handle = await fileSystem.openRead(path);
    const handleStats = await handle.stat();
    if (!handleStats.isFile() || !sameIdentity(identityOf(pathStats), identityOf(handleStats))) {
      throw new GuideOperationError("concurrent-change", displayPath, "target changed while it was opened");
    }
    const buffer = Buffer.allocUnsafe(MAX_GUIDE_TARGET_BYTES + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.byteLength) {
      const result = await handle.read(buffer, bytesRead, buffer.byteLength - bytesRead, null);
      if (result.bytesRead === 0) {
        break;
      }
      bytesRead += result.bytesRead;
    }
    if (bytesRead > MAX_GUIDE_TARGET_BYTES) {
      throw new GuideOperationError("size", displayPath, `file exceeds ${MAX_GUIDE_TARGET_BYTES} bytes`);
    }
    content = buffer.subarray(0, bytesRead);
    const afterStats = await fileSystem.lstat(path);
    if (!sameIdentity(identityOf(pathStats), identityOf(afterStats))) {
      throw new GuideOperationError("concurrent-change", displayPath, "target changed while it was read");
    }
  } catch (error) {
    primary = error instanceof GuideOperationError
      ? error
      : new GuideOperationError("read", displayPath, errorDetail(error));
  }

  let closeFailure: GuideSecondaryFailure | undefined;
  if (handle) {
    try {
      await handle.close();
    } catch (error) {
      closeFailure = { phase: "read", path: displayPath, detail: `failed to close target: ${errorDetail(error)}` };
    }
  }
  if (primary) {
    if (!closeFailure) {
      throw primary;
    }
    throw new GuideOperationError(
      primary.phase,
      primary.path,
      primary.detail,
      [...primary.secondaryFailures, closeFailure]
    );
  }
  if (closeFailure) {
    throw new GuideOperationError(closeFailure.phase, closeFailure.path, closeFailure.detail);
  }
  if (!content) {
    throw new GuideOperationError("read", displayPath, "target read produced no content");
  }
  return {
    exists: true,
    content,
    mode: numericMode(pathStats.mode) & 0o777,
    identity: identityOf(pathStats)
  };
}

export function sameIdentity(left: GuideFileIdentity, right: GuideFileIdentity): boolean {
  return String(left.dev) === String(right.dev)
    && String(left.ino) === String(right.ino)
    && String(left.size) === String(right.size)
    && String(left.mode) === String(right.mode)
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

export function sameNodeIdentity(left: GuideNodeIdentity, right: GuideNodeIdentity): boolean {
  return String(left.dev) === String(right.dev) && String(left.ino) === String(right.ino);
}

export function nodeIdentityOf(stats: GuideFileStat): GuideNodeIdentity {
  return { dev: stats.dev, ino: stats.ino };
}

export function identityOf(stats: GuideFileStat): GuideFileIdentity {
  return {
    dev: stats.dev,
    ino: stats.ino,
    size: stats.size,
    mode: stats.mode,
    mtimeMs: stats.mtimeMs,
    ctimeMs: stats.ctimeMs
  };
}

export function readOpenFlags(): number {
  const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
  const nonBlocking = typeof constants.O_NONBLOCK === "number" ? constants.O_NONBLOCK : 0;
  return constants.O_RDONLY | noFollow | nonBlocking;
}

export function exclusiveWriteOpenFlags(): number {
  const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
  return constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow;
}

function assertRelativeArgument(label: string, value: string): void {
  if (value.length === 0 || isAbsolute(value) || value.split(/[\\/]/u).includes("..")) {
    throw containmentError(label, `${label} must be a relative path without '..' components inside --target`);
  }
}

async function resolveContainedInput(
  label: "--guide" | "--copy",
  value: string,
  realCwd: string,
  realTarget: string,
  fileSystem: GuideFileSystem
): Promise<{ path: string; identity: GuideFileIdentity }> {
  const candidate = resolve(realCwd, value);
  assertWithin(realTarget, candidate, label);
  await assertNoSymlinkComponents(realTarget, candidate, label, true, fileSystem);
  let stats: GuideFileStat;
  try {
    stats = await fileSystem.lstat(candidate);
  } catch (error) {
    throw containmentError(label, `${label} file must exist inside --target: ${errorDetail(error)}`);
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw containmentError(label, `${label} must name a regular file inside --target`);
  }
  let realPath: string;
  try {
    realPath = await fileSystem.realpath(candidate);
  } catch (error) {
    throw containmentError(label, `cannot resolve ${label} inside --target: ${errorDetail(error)}`);
  }
  assertWithin(realTarget, realPath, label);
  if (realPath !== candidate) {
    throw containmentError(label, `${label} must not traverse symlinks and must be inside --target`);
  }
  let stableStats: GuideFileStat;
  try {
    stableStats = await fileSystem.lstat(candidate);
  } catch (error) {
    throw containmentError(label, `${label} changed during containment validation: ${errorDetail(error)}`);
  }
  if (stableStats.isSymbolicLink()
    || !stableStats.isFile()
    || !sameIdentity(identityOf(stats), identityOf(stableStats))) {
    throw containmentError(label, `${label} changed during containment validation`);
  }
  return { path: realPath, identity: identityOf(stableStats) };
}

async function assertNoSymlinkComponents(
  root: string,
  candidate: string,
  label: string,
  requireLeaf: boolean,
  fileSystem: GuideFileSystem
): Promise<void> {
  assertWithin(root, candidate, label);
  const suffix = relative(root, candidate);
  if (suffix === "") {
    return;
  }
  const components = suffix.split(sep);
  let current = root;
  for (let index = 0; index < components.length; index += 1) {
    current = join(current, components[index]);
    let stats: GuideFileStat;
    try {
      stats = await fileSystem.lstat(current);
    } catch (error) {
      if (isMissing(error) && !requireLeaf && index === components.length - 1) {
        return;
      }
      throw containmentError(label, `${label} must resolve through existing real components inside --target`);
    }
    if (stats.isSymbolicLink()) {
      throw containmentError(label, `${label} must not traverse symlinks and must be inside --target`);
    }
    if (index < components.length - 1 && !stats.isDirectory()) {
      throw containmentError(label, `${label} has a non-directory path component inside --target`);
    }
  }
}

function assertWithin(root: string, candidate: string, label: string): void {
  const suffix = relative(root, candidate);
  if (suffix === "" || (!suffix.startsWith(`..${sep}`) && suffix !== ".." && !isAbsolute(suffix))) {
    return;
  }
  throw containmentError(label, `${label} must resolve inside --target`);
}

function containmentError(path: string, detail: string): GuideOperationError {
  return new GuideOperationError("containment", path, detail.includes("inside --target") ? detail : `${detail}; path must be inside --target`);
}

function markerBlock(body: string): string {
  return `${GUIDE_MARKER_BEGIN}\n${body}\n${GUIDE_MARKER_END}\n`;
}

function planMarkerFile(source: string, block: string, name: "AGENTS.md" | "DESIGN.md"): string {
  const markers = markerSpan(source, name);
  if (!markers) {
    return appendBlock(source, block);
  }
  return `${source.slice(0, markers.begin)}${block.replace(/\n$/u, "")}${source.slice(markers.end)}`;
}

function planClaudeFile(source: string, block: string): string {
  const markers = markerSpan(source, "CLAUDE.md");
  if (!markers) {
    const importCount = countStandaloneAgentsImports(source);
    if (importCount > 1) {
      throw new GuideOperationError("ownership", "CLAUDE.md", "multiple standalone @AGENTS.md imports are ambiguous");
    }
    if (importCount === 1) {
      return source;
    }
    return appendBlock(source, block);
  }
  const outside = `${source.slice(0, markers.begin)}${source.slice(markers.end)}`;
  if (countStandaloneAgentsImports(outside) > 0) {
    throw new GuideOperationError(
      "ownership",
      "CLAUDE.md",
      "standalone @AGENTS.md and a generated import block are both present"
    );
  }
  const owned = source.slice(markers.begin, markers.end);
  if (owned !== block.replace(/\n$/u, "")) {
    throw new GuideOperationError(
      "ownership",
      "CLAUDE.md",
      "generated import block must contain only the exact @AGENTS.md instruction"
    );
  }
  return source;
}

function markerSpan(source: string, name: GuideTargetName): { begin: number; end: number } | undefined {
  const begins = indexesOf(source, GUIDE_MARKER_BEGIN);
  const ends = indexesOf(source, GUIDE_MARKER_END);
  if (begins.length === 0 && ends.length === 0) {
    return undefined;
  }
  if (begins.length !== 1 || ends.length !== 1 || begins[0] >= ends[0]) {
    throw new GuideOperationError("marker", name, "expected zero markers or exactly one well-ordered marker pair");
  }
  return { begin: begins[0], end: ends[0] + GUIDE_MARKER_END.length };
}

function appendBlock(source: string, block: string): string {
  if (source.length === 0) {
    return block;
  }
  return `${source}${source.endsWith("\n") ? "\n" : "\n\n"}${block}`;
}

function countStandaloneAgentsImports(source: string): number {
  let fence: "`" | "~" | undefined;
  let count = 0;
  for (const line of source.split(/\n/u)) {
    const trimmed = line.endsWith("\r") ? line.slice(0, -1).trim() : line.trim();
    const fenceMatch = /^(`{3,}|~{3,})/u.exec(trimmed);
    if (fenceMatch) {
      const kind = fenceMatch[1][0] as "`" | "~";
      if (!fence) {
        fence = kind;
      } else if (fence === kind) {
        fence = undefined;
      }
      continue;
    }
    if (!fence && trimmed === "@AGENTS.md") {
      count += 1;
    }
  }
  return count;
}

function assertOwnedTokenJson(source: string, path: string): void {
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch {
    throw new GuideOperationError("ownership", path, "token JSON is not valid generated JSON");
  }
  if (!isRecord(value) || !isRecord(value.$extensions)) {
    throw new GuideOperationError("ownership", path, "token JSON lacks Design Harness ownership");
  }
  const ownership = value.$extensions["dev.design-harness"];
  if (!isRecord(ownership)
    || ownership.profile !== DESIGN_GUIDE_PROFILE_ID
    || ownership.catalogVersion !== GUIDE_CATALOG_VERSION
    || typeof ownership.sourceHash !== "string"
    || !/^[a-f0-9]{64}$/u.test(ownership.sourceHash)) {
    throw new GuideOperationError("ownership", path, "token JSON has malformed Design Harness ownership");
  }
}

function decodeTarget(bytes: Buffer, path: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new GuideOperationError("decode", path, "target is not valid UTF-8");
  }
}

function indexesOf(source: string, needle: string): number[] {
  const indexes: number[] = [];
  let offset = 0;
  while (offset <= source.length - needle.length) {
    const index = source.indexOf(needle, offset);
    if (index < 0) {
      break;
    }
    indexes.push(index);
    offset = index + needle.length;
  }
  return indexes;
}

function numericSize(value: number | bigint): number {
  const size = Number(value);
  return Number.isSafeInteger(size) ? size : Number.POSITIVE_INFINITY;
}

function numericMode(value: number | bigint): number {
  return Number(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissing(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

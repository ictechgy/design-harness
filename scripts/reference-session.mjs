#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rmdir,
  unlink
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  REFERENCE_SESSION_LIMITS,
  ReferenceSessionError,
  canonicalizeAssets,
  compareInventories,
  enforceAssetCaps,
  mediaTypeFromSignature,
  parseCanonicalInventory,
  parseSessionSlug,
  renderInventory,
  renderWorksheet,
  sha256Hex,
  validateAssetBasename
} from "./reference-session-lib.mjs";

const DEFAULT_REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOCAL_ASSET_SEGMENTS = ["datasets", "midjourney-reference-lab", "local-assets"];
const OUTPUT_NAMES = new Set(["inventory.json", "session.md"]);
const STAGE_PREFIX = ".reference-session-stage-";
const READ_FLAGS = constants.O_RDONLY
  | (typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0)
  | (typeof constants.O_NONBLOCK === "number" ? constants.O_NONBLOCK : 0);
const WRITE_FLAGS = constants.O_WRONLY
  | constants.O_CREAT
  | constants.O_EXCL
  | (typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0);
let anchoredSessionOperationActive = false;

export async function prepareReferenceSession(options) {
  return withAnchoredSession(options, (context) => prepareAnchoredSession(context, options.hooks ?? {}));
}

export async function checkReferenceSession(options) {
  return withAnchoredSession(options, (context) => checkAnchoredSession(context, options.hooks ?? {}));
}

async function prepareAnchoredSession(context, hooks) {
  await assertOutputsAbsent(context);
  const initialInventory = await inventorySession(context, hooks);
  const inventorySource = renderInventory(initialInventory.assets);
  const worksheetSource = renderWorksheet(initialInventory.assets, inventorySource);
  const stage = await createStage(context, hooks);
  const createdOutputs = [];

  try {
    await assertSessionStable(context);
    const afterStage = await discoverAssets(context, { allowedStage: stage.basename });
    assertSameSourceSet(initialInventory.identities, afterStage.identities);

    await writeStagedFile(stage, "inventory.json", inventorySource, hooks);
    await writeStagedFile(stage, "session.md", worksheetSource, hooks);
    await assertSessionStable(context);
    const beforeFinalWrites = await discoverAssets(context, { allowedStage: stage.basename });
    assertSameSourceSet(initialInventory.identities, beforeFinalWrites.identities);
    createdOutputs.push(await writeFinalFile(context, "inventory.json", inventorySource, hooks));
    createdOutputs.push(await writeFinalFile(context, "session.md", worksheetSource, hooks));
    await assertSessionStable(context);
    const afterFinalWrites = await discoverAssets(context, { allowedStage: stage.basename });
    assertSameSourceSet(initialInventory.identities, afterFinalWrites.identities);
    await removeStage(stage, hooks);
  } catch (error) {
    let cleanupFailed = false;
    try {
      await rollbackCreatedOutputs(createdOutputs, hooks);
    } catch {
      cleanupFailed = true;
    }
    try {
      await removeStage(stage, hooks);
    } catch {
      cleanupFailed = true;
    }
    if (cleanupFailed) {
      throw new ReferenceSessionError("write", "prepare failed and cleanup was incomplete");
    }
    throw normalizeError(error, "write", "prepare failed");
  }

  return {
    action: "prepared",
    scope: "repo-local-experimental",
    session: context.slug,
    assetCount: initialInventory.assets.length,
    inventorySha256: sha256Hex(Buffer.from(inventorySource, "utf8")),
    outputs: ["inventory.json", "session.md"]
  };
}

async function checkAnchoredSession(context, hooks) {
  const source = await readInventoryFile(context, hooks);
  const expectedAssets = parseCanonicalInventory(source);
  const actual = await inventorySession(context, hooks);
  const finalSource = await readInventoryFile(context, hooks);
  if (finalSource !== source) {
    throw new ReferenceSessionError("check", "inventory changed during check", "inventory.json");
  }
  await assertSessionStable(context);
  const diagnostics = compareInventories(expectedAssets, actual.assets);
  if (diagnostics.length > 0) {
    const first = diagnostics[0];
    throw new ReferenceSessionError("check", `asset ${first.kind}`, first.basename);
  }
  return {
    action: "current",
    scope: "repo-local-experimental",
    session: context.slug,
    assetCount: actual.assets.length,
    inventorySha256: sha256Hex(Buffer.from(source, "utf8"))
  };
}

export function parseReferenceSessionArguments(args) {
  if (
    args.length !== 3
    || !["prepare", "check"].includes(args[0])
    || args[1] !== "--session"
  ) {
    throw new ReferenceSessionError(
      "arguments",
      "usage: pnpm reference:session -- <prepare|check> --session <lowercase-slug>"
    );
  }
  return { command: args[0], sessionSlug: parseSessionSlug(args[2]) };
}

async function resolveSession(options) {
  const slug = parseSessionSlug(options.sessionSlug);
  const repositoryRoot = resolve(options.repositoryRoot ?? DEFAULT_REPOSITORY_ROOT);
  const realRepositoryRoot = await safeRealpath(repositoryRoot, "repository root");
  if (realRepositoryRoot !== repositoryRoot) {
    throw new ReferenceSessionError("resolve", "repository root must not traverse symlinks");
  }

  let current = realRepositoryRoot;
  for (const segment of LOCAL_ASSET_SEGMENTS) {
    current = join(current, segment);
    await assertRealDirectory(current, "local asset root");
  }
  const localAssetRoot = current;
  const sessionPath = join(localAssetRoot, slug);
  await assertRealDirectory(sessionPath, "session");
  assertContained(localAssetRoot, sessionPath);
  const sessionStats = await safeLstat(sessionPath, "session");
  return {
    slug,
    repositoryRoot: realRepositoryRoot,
    localAssetRoot,
    sessionPath,
    sessionIdentity: nodeIdentity(sessionStats)
  };
}

async function withAnchoredSession(options, action) {
  if (anchoredSessionOperationActive) {
    throw new ReferenceSessionError("resolve", "another reference-session operation is already active");
  }
  anchoredSessionOperationActive = true;
  const previousDirectory = process.cwd();
  let changedDirectory = false;
  let primaryError;
  try {
    const resolved = await resolveSession(options);
    try {
      process.chdir(resolved.sessionPath);
      changedDirectory = true;
    } catch {
      throw new ReferenceSessionError("resolve", "session cannot become the anchored working directory");
    }
    const context = { ...resolved, sessionDirectory: "." };
    await assertSessionStable(context);
    return await action(context);
  } catch (error) {
    primaryError = normalizeError(error, "runtime", "reference session operation failed");
    throw primaryError;
  } finally {
    let restoreError;
    if (changedDirectory) {
      try {
        process.chdir(previousDirectory);
      } catch {
        restoreError = new ReferenceSessionError("resolve", "cannot restore the invocation directory");
      }
    }
    anchoredSessionOperationActive = false;
    if (restoreError) throw restoreError;
  }
}

async function inventorySession(context, hooks) {
  const discovered = await discoverAssets(context);
  enforceAssetCaps(
    discovered.assets.map(({ basename, identity }) => ({
      basename,
      bytes: Number(identity.size)
    }))
  );
  const assets = [];
  for (const item of discovered.assets) {
    assets.push(await hashAsset(context, item, hooks));
  }
  enforceAssetCaps(assets);
  await assertSessionStable(context);
  const finalDiscovery = await discoverAssets(context);
  assertSameSourceSet(discovered.identities, finalDiscovery.identities);
  return { assets: canonicalizeAssets(assets), identities: finalDiscovery.identities };
}

async function discoverAssets(context, options = {}) {
  let entries;
  try {
    entries = await readdir(context.sessionDirectory, { withFileTypes: true });
  } catch {
    throw new ReferenceSessionError("inventory", "cannot enumerate session");
  }
  const assets = [];
  const identities = new Map();
  const normalized = new Set();

  for (const entry of entries) {
    if (OUTPUT_NAMES.has(entry.name)) {
      await assertRegularDirectChild(context, entry.name, "output");
      continue;
    }
    if (options.allowedStage === entry.name) {
      await assertOwnedStageDirectory(context, entry.name);
      continue;
    }
    const validated = validateAssetBasename(entry.name);
    if (normalized.has(validated.normalizedBasename)) {
      throw new ReferenceSessionError(
        "inventory",
        "asset basenames collide after Unicode normalization",
        entry.name
      );
    }
    normalized.add(validated.normalizedBasename);
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new ReferenceSessionError("inventory", "asset must be a direct-child regular file", entry.name);
    }
    const stats = await assertRegularDirectChild(context, entry.name, "asset");
    const identity = fileIdentity(stats);
    assets.push({ basename: entry.name, path: join(context.sessionDirectory, entry.name), identity });
    identities.set(entry.name, identity);
  }

  if (assets.length === 0) {
    throw new ReferenceSessionError("inventory", "session must contain at least one image asset");
  }
  if (assets.length > REFERENCE_SESSION_LIMITS.maxAssets) {
    throw new ReferenceSessionError(
      "inventory",
      `session exceeds the ${REFERENCE_SESSION_LIMITS.maxAssets}-asset limit`
    );
  }
  return { assets, identities };
}

async function hashAsset(context, item, hooks) {
  let handle;
  let primaryError;
  try {
    handle = await open(item.path, READ_FLAGS);
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || !sameFileIdentity(item.identity, fileIdentity(before))) {
      throw new ReferenceSessionError("read", "asset changed while opening", item.basename);
    }
    const bytes = Number(before.size);
    enforceAssetCaps([{ basename: item.basename, bytes }]);
    const hash = createHash("sha256");
    const header = Buffer.alloc(12);
    let headerBytes = 0;
    let totalRead = 0;
    const buffer = Buffer.allocUnsafe(REFERENCE_SESSION_LIMITS.maxReadBytes);

    while (totalRead < bytes) {
      const length = Math.min(buffer.byteLength, bytes - totalRead);
      hooks.onRead?.({ basename: item.basename, length });
      const result = await handle.read(buffer, 0, length, totalRead);
      if (result.bytesRead === 0) {
        break;
      }
      const chunk = buffer.subarray(0, result.bytesRead);
      if (headerBytes < header.byteLength) {
        const copied = Math.min(header.byteLength - headerBytes, chunk.byteLength);
        chunk.copy(header, headerBytes, 0, copied);
        headerBytes += copied;
      }
      hash.update(chunk);
      totalRead += result.bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (
      totalRead !== bytes
      || !after.isFile()
      || !sameFileIdentity(fileIdentity(before), fileIdentity(after))
    ) {
      throw new ReferenceSessionError("read", "asset changed while reading", item.basename);
    }
    await assertSessionStable(context);
    const pathStats = await safeLstat(item.path, "asset", item.basename);
    if (!pathStats.isFile() || pathStats.isSymbolicLink() || !sameFileIdentity(fileIdentity(after), fileIdentity(pathStats))) {
      throw new ReferenceSessionError("read", "asset path changed while reading", item.basename);
    }
    return {
      basename: item.basename,
      mediaType: mediaTypeFromSignature(item.basename, header.subarray(0, headerBytes)),
      bytes,
      sha256: hash.digest("hex")
    };
  } catch (error) {
    primaryError = normalizeError(error, "read", "cannot safely read asset", item.basename);
    throw primaryError;
  } finally {
    if (handle) {
      try {
        await handle.close();
      } catch {
        if (!primaryError) {
          throw new ReferenceSessionError("read", "cannot close asset after reading", item.basename);
        }
      }
    }
  }
}

async function readInventoryFile(context, hooks) {
  const basename = "inventory.json";
  const path = join(context.sessionDirectory, basename);
  const before = await assertRegularDirectChild(context, basename, "inventory");
  if (before.size > BigInt(REFERENCE_SESSION_LIMITS.maxInventoryBytes)) {
    throw new ReferenceSessionError("validate", "inventory exceeds the local format size limit", basename);
  }
  let handle;
  let primaryError;
  try {
    handle = await open(path, READ_FLAGS);
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || !sameFileIdentity(fileIdentity(before), fileIdentity(opened))) {
      throw new ReferenceSessionError("read", "inventory changed while opening", basename);
    }
    const bytes = Buffer.alloc(Number(opened.size));
    let offset = 0;
    while (offset < bytes.length) {
      const length = Math.min(REFERENCE_SESSION_LIMITS.maxReadBytes, bytes.length - offset);
      hooks.onRead?.({ basename, length });
      const result = await handle.read(bytes, offset, length, offset);
      if (result.bytesRead === 0) break;
      offset += result.bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (offset !== bytes.length || !sameFileIdentity(fileIdentity(opened), fileIdentity(after))) {
      throw new ReferenceSessionError("read", "inventory changed while reading", basename);
    }
    const pathStats = await safeLstat(path, "inventory", basename);
    if (!sameFileIdentity(fileIdentity(after), fileIdentity(pathStats))) {
      throw new ReferenceSessionError("read", "inventory path changed while reading", basename);
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new ReferenceSessionError("validate", "inventory is not valid UTF-8", basename);
    }
  } catch (error) {
    primaryError = normalizeError(error, "read", "cannot safely read inventory", basename);
    throw primaryError;
  } finally {
    if (handle) {
      try {
        await handle.close();
      } catch {
        if (!primaryError) {
          throw new ReferenceSessionError("read", "cannot close inventory after reading", basename);
        }
      }
    }
  }
}

async function createStage(context, hooks) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const basename = `${STAGE_PREFIX}${randomBytes(12).toString("hex")}`;
    const path = join(context.sessionDirectory, basename);
    observe(hooks, "mkdir", path, context);
    try {
      await mkdir(path, { mode: 0o700 });
      const stats = await safeLstat(path, "stage");
      if (
        !stats.isDirectory()
        || stats.isSymbolicLink()
        || Number(stats.mode & 0o777n) !== 0o700
      ) {
        throw new ReferenceSessionError("stage", "private stage directory contract failed");
      }
      return {
        basename,
        path,
        identity: nodeIdentity(stats),
        createdFiles: new Map(),
        context
      };
    } catch (error) {
      if (error?.code === "EEXIST") continue;
      throw normalizeError(error, "stage", "cannot create private stage directory");
    }
  }
  throw new ReferenceSessionError("stage", "cannot allocate a unique private stage directory");
}

async function writeStagedFile(stage, basename, source, hooks) {
  const path = join(stage.path, basename);
  observe(hooks, "write", path, stage.context);
  const identity = await writeExclusive(path, source, hooks, stage.context);
  stage.createdFiles.set(basename, identity);
}

async function writeFinalFile(context, basename, source, hooks) {
  const path = join(context.sessionDirectory, basename);
  observe(hooks, "write", path, context);
  const identity = await writeExclusive(path, source, hooks, context);
  const stats = await safeLstat(path, "write", basename);
  if (
    !stats.isFile()
    || stats.isSymbolicLink()
    || !sameFileIdentity(identity, fileIdentity(stats))
  ) {
    throw new ReferenceSessionError("write", "created output is not a regular file", basename);
  }
  return { basename, path, identity, context };
}

async function writeExclusive(path, source, hooks, context) {
  let handle;
  let createdNodeIdentity;
  let primaryError;
  let finalIdentity;
  try {
    handle = await open(path, WRITE_FLAGS, 0o600);
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile()) {
      throw new ReferenceSessionError("write", "exclusive output is not a regular file");
    }
    createdNodeIdentity = nodeIdentity(opened);
    await handle.writeFile(source, "utf8");
    await handle.sync();
    const after = await handle.stat({ bigint: true });
    if (!after.isFile() || !sameNodeIdentity(createdNodeIdentity, nodeIdentity(after))) {
      throw new ReferenceSessionError("write", "output changed while writing");
    }
    finalIdentity = fileIdentity(after);
  } catch (error) {
    primaryError = error;
  } finally {
    if (handle) {
      try {
        await handle.close();
      } catch {
        primaryError ??= new ReferenceSessionError("write", "cannot close output after writing");
      }
    }
    if (primaryError && createdNodeIdentity) {
      const current = await lstatIfExists(path, "write");
      if (
        current?.isFile()
        && !current.isSymbolicLink()
        && sameNodeIdentity(createdNodeIdentity, nodeIdentity(current))
      ) {
        observe(hooks, "unlink", path, context);
        try {
          await unlink(path);
        } catch {
          primaryError = new ReferenceSessionError("write", "output cleanup failed after write error");
        }
      }
    }
  }
  if (primaryError) throw primaryError;
  return finalIdentity;
}

async function rollbackCreatedOutputs(outputs, hooks) {
  for (const output of [...outputs].reverse()) {
    const current = await lstatIfExists(output.path, "write", output.basename);
    if (!current) continue;
    if (
      !current.isFile()
      || current.isSymbolicLink()
      || !sameFileIdentity(output.identity, fileIdentity(current))
    ) {
      throw new ReferenceSessionError("write", "created output identity changed during rollback", output.basename);
    }
    observe(hooks, "unlink", output.path, output.context);
    await unlink(output.path);
  }
}

async function removeStage(stage, hooks) {
  const current = await lstatIfExists(stage.path, "stage");
  if (!current) return;
  if (!current.isDirectory() || current.isSymbolicLink() || !sameNodeIdentity(stage.identity, nodeIdentity(current))) {
    throw new ReferenceSessionError("stage", "stage identity changed before cleanup");
  }
  for (const [basename, identity] of stage.createdFiles) {
    const path = join(stage.path, basename);
    const stats = await lstatIfExists(path, "stage", basename);
    if (
      stats?.isFile()
      && !stats.isSymbolicLink()
      && sameFileIdentity(identity, fileIdentity(stats))
    ) {
      observe(hooks, "unlink", path, stage.context);
      await unlink(path);
    } else if (stats) {
      throw new ReferenceSessionError("stage", "staged output identity changed before cleanup", basename);
    }
  }
  observe(hooks, "rmdir", stage.path, stage.context);
  await rmdir(stage.path);
}

async function assertOutputsAbsent(context) {
  for (const basename of OUTPUT_NAMES) {
    const path = join(context.sessionDirectory, basename);
    const stats = await lstat(path, { bigint: true }).catch((error) => {
      if (error?.code === "ENOENT") return undefined;
      throw new ReferenceSessionError("write", "cannot inspect output", basename);
    });
    if (stats) {
      throw new ReferenceSessionError("write", "output already exists; overwrite is not supported", basename);
    }
  }
}

async function assertRegularDirectChild(context, basename, phase) {
  const path = join(context.sessionDirectory, basename);
  assertContained(context.sessionDirectory, path);
  const stats = await safeLstat(path, phase, basename);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new ReferenceSessionError(phase, "path must be a direct-child regular file", basename);
  }
  return stats;
}

async function assertOwnedStageDirectory(context, basename) {
  if (!basename.startsWith(STAGE_PREFIX)) {
    throw new ReferenceSessionError("inventory", "unexpected directory entry");
  }
  const stats = await safeLstat(join(context.sessionDirectory, basename), "stage");
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new ReferenceSessionError("stage", "stage path is unsafe");
  }
}

async function assertRealDirectory(path, label) {
  const stats = await safeLstat(path, "resolve");
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new ReferenceSessionError("resolve", `${label} must be an existing real directory`);
  }
  const resolved = await safeRealpath(path, label);
  if (resolved !== path) {
    throw new ReferenceSessionError("resolve", `${label} must not traverse symlinks`);
  }
}

async function assertSessionStable(context) {
  const [anchoredStats, namespaceStats] = await Promise.all([
    safeLstat(context.sessionDirectory, "resolve"),
    safeLstat(context.sessionPath, "resolve")
  ]);
  if (
    !anchoredStats.isDirectory()
    || anchoredStats.isSymbolicLink()
    || !namespaceStats.isDirectory()
    || namespaceStats.isSymbolicLink()
    || !sameNodeIdentity(context.sessionIdentity, nodeIdentity(anchoredStats))
    || !sameNodeIdentity(context.sessionIdentity, nodeIdentity(namespaceStats))
  ) {
    throw new ReferenceSessionError("resolve", "session changed during operation");
  }
}

function assertSameSourceSet(before, after) {
  if (before.size !== after.size) {
    throw new ReferenceSessionError("inventory", "asset set changed during operation");
  }
  for (const [basename, identity] of before) {
    const current = after.get(basename);
    if (!current || !sameFileIdentity(identity, current)) {
      throw new ReferenceSessionError("inventory", "asset set changed during operation", basename);
    }
  }
}

function observe(hooks, operation, path, context) {
  assertContained(context.sessionDirectory, path);
  hooks.beforeOperation?.({ operation, path, sessionDirectory: context.sessionDirectory });
}

function assertContained(root, candidate) {
  const suffix = relative(root, candidate);
  if (
    suffix === ""
    || (!suffix.startsWith(`..${sep}`) && suffix !== ".." && !isAbsolute(suffix))
  ) {
    return;
  }
  throw new ReferenceSessionError("resolve", "path escapes the local session");
}

function fileIdentity(stats) {
  return {
    dev: String(stats.dev),
    ino: String(stats.ino),
    size: String(stats.size),
    mode: String(stats.mode),
    mtimeNs: String(stats.mtimeNs ?? BigInt(Math.trunc(stats.mtimeMs * 1e6))),
    ctimeNs: String(stats.ctimeNs ?? BigInt(Math.trunc(stats.ctimeMs * 1e6)))
  };
}

function nodeIdentity(stats) {
  return { dev: String(stats.dev), ino: String(stats.ino) };
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mode === right.mode
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function sameNodeIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

async function safeLstat(path, phase, basename) {
  try {
    return await lstat(path, { bigint: true });
  } catch {
    throw new ReferenceSessionError(phase, "required path is missing or unreadable", basename);
  }
}

async function lstatIfExists(path, phase, basename) {
  try {
    return await lstat(path, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw new ReferenceSessionError(phase, "path cannot be safely inspected", basename);
  }
}

async function safeRealpath(path, label) {
  try {
    return await realpath(path);
  } catch {
    throw new ReferenceSessionError("resolve", `${label} cannot be resolved`);
  }
}

function normalizeError(error, phase, detail, basename) {
  return error instanceof ReferenceSessionError
    ? error
    : new ReferenceSessionError(phase, detail, basename);
}

async function main() {
  try {
    const { command, sessionSlug } = parseReferenceSessionArguments(process.argv.slice(2));
    const result = command === "prepare"
      ? await prepareReferenceSession({ sessionSlug })
      : await checkReferenceSession({ sessionSlug });
    console.log(JSON.stringify(result));
  } catch (error) {
    const normalized = normalizeError(error, "runtime", "reference session command failed");
    const suffix = normalized.basename ? ` [${normalized.basename}]` : "";
    console.error(`${normalized.phase}: ${normalized.message}${suffix}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}

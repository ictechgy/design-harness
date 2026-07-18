import { constants } from "node:fs";
import { lstat as lstatPath, open, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import {
  LineCounter,
  isAlias,
  isScalar,
  parseDocument,
  visit,
  type Node,
  type Pair
} from "yaml";

export const DEFAULT_MAX_YAML_BYTES = 1024 * 1024;

export type StrictYamlLoadStage = "read" | "size" | "decode" | "parse" | "parse-policy";

export class StrictYamlLoadError extends Error {
  constructor(
    public readonly stage: StrictYamlLoadStage,
    public readonly resolvedPath: string,
    public readonly detail: string
  ) {
    super(`YAML ${stage} error at ${resolvedPath}: ${detail}`);
    this.name = "StrictYamlLoadError";
  }
}

export interface StrictYamlFileHandle {
  stat(): Promise<{
    size: number;
    dev?: number | bigint;
    ino?: number | bigint;
    mode?: number | bigint;
    mtimeMs?: number;
    ctimeMs?: number;
    isFile(): boolean;
  }>;
  read(buffer: Buffer, offset: number, length: number, position: number | null): Promise<{ bytesRead: number }>;
  close(): Promise<void>;
}

export interface LoadStrictYamlOptions {
  cwd?: string;
  maxBytes?: number;
  requireRealPath?: boolean;
  expectedIdentity?: StrictYamlExpectedIdentity;
  openFile?: (resolvedPath: string) => Promise<StrictYamlFileHandle>;
}

export interface StrictYamlExpectedIdentity {
  dev: number | bigint;
  ino: number | bigint;
  size: number | bigint;
  mode: number | bigint;
  mtimeMs: number;
  ctimeMs: number;
}

export interface LoadedStrictYaml {
  resolvedPath: string;
  value: unknown;
}

/**
 * Reads a bounded UTF-8 file and accepts only the deterministic YAML 1.2 core
 * subset shared by Design Harness configuration files.
 */
export async function loadStrictYamlFile(
  path: string,
  options: LoadStrictYamlOptions = {}
): Promise<LoadedStrictYaml> {
  const resolvedPath = resolve(options.cwd ?? process.cwd(), path);
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_YAML_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new TypeError("maxBytes must be a positive safe integer");
  }
  const bytes = await readBoundedFile(
    resolvedPath,
    maxBytes,
    options.openFile ?? ((candidate) => openReadOnly(candidate, options.requireRealPath ?? false)),
    options.expectedIdentity
  );

  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new StrictYamlLoadError("decode", resolvedPath, "file is not valid UTF-8");
  }

  const lineCounter = new LineCounter();
  const document = parseDocument(source, {
    version: "1.2",
    schema: "core",
    strict: true,
    uniqueKeys: true,
    stringKeys: true,
    resolveKnownTags: false,
    merge: false,
    customTags: [],
    prettyErrors: false,
    lineCounter,
    logLevel: "warn"
  });

  const diagnostic = document.errors[0] ?? document.warnings[0];
  if (diagnostic) {
    const position = diagnostic.linePos?.[0] ?? lineCounter.linePos(diagnostic.pos[0]);
    throw new StrictYamlLoadError(
      "parse",
      resolvedPath,
      `${diagnostic.code} at line ${position.line}, column ${position.col}`
    );
  }

  const preludeEnd = document.range?.[0] ?? 0;
  if (/^%(?:YAML|TAG)(?:\s|$)/mu.test(source.slice(0, preludeEnd))) {
    throw new StrictYamlLoadError("parse-policy", resolvedPath, "YAML directives are not allowed");
  }

  const policyViolation = findPolicyViolation(document.contents);
  if (policyViolation) {
    throw new StrictYamlLoadError("parse-policy", resolvedPath, policyViolation);
  }

  let value: unknown;
  try {
    value = document.toJS({ maxAliasCount: 0 });
  } catch {
    throw new StrictYamlLoadError("parse-policy", resolvedPath, "aliases are not allowed");
  }

  return { resolvedPath, value };
}

async function openReadOnly(
  resolvedPath: string,
  requireRealPath: boolean
): Promise<StrictYamlFileHandle> {
  const pathStats = await lstatPath(resolvedPath);
  if (!pathStats.isFile() || pathStats.isSymbolicLink()) {
    throw new StrictYamlLoadError("read", resolvedPath, "path is not a regular file");
  }
  if (requireRealPath && await realpath(resolvedPath) !== resolvedPath) {
    throw new StrictYamlLoadError("read", resolvedPath, "path must not traverse symlinks");
  }

  const handle = await open(resolvedPath, strictYamlOpenFlags());
  try {
    const handleStats = await handle.stat();
    if (!handleStats.isFile() || !sameProductionIdentity(pathStats, handleStats)) {
      throw new StrictYamlLoadError("read", resolvedPath, "path changed while it was opened");
    }
    if (requireRealPath) {
      const [afterPath, afterStats] = await Promise.all([realpath(resolvedPath), lstatPath(resolvedPath)]);
      if (afterPath !== resolvedPath
        || afterStats.isSymbolicLink()
        || !afterStats.isFile()
        || !sameProductionIdentity(afterStats, handleStats)) {
        throw new StrictYamlLoadError("read", resolvedPath, "path changed or traversed a symlink while opening");
      }
    }
    return handle;
  } catch (error) {
    try {
      await handle.close();
    } catch {
      // Preserve the identity/containment failure as the primary diagnostic.
    }
    throw error;
  }
}

/** @internal Exported so policy tests can lock the production open flags. */
export function strictYamlOpenFlags(): number {
  const nonBlocking = typeof constants.O_NONBLOCK === "number" ? constants.O_NONBLOCK : 0;
  const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
  return constants.O_RDONLY | nonBlocking | noFollow;
}

async function readBoundedFile(
  resolvedPath: string,
  maxBytes: number,
  openFile: (resolvedPath: string) => Promise<StrictYamlFileHandle>,
  expectedIdentity: StrictYamlExpectedIdentity | undefined
): Promise<Buffer> {
  let handle: StrictYamlFileHandle | undefined;
  let primaryError: unknown;
  try {
    handle = await openFile(resolvedPath);
    const stats = await handle.stat();
    if (!stats.isFile()) {
      throw new StrictYamlLoadError("read", resolvedPath, "path is not a regular file");
    }
    if (expectedIdentity && !sameProductionIdentity(expectedIdentity, stats)) {
      throw new StrictYamlLoadError("read", resolvedPath, "file identity changed since containment");
    }
    if (stats.size > maxBytes) {
      throw new StrictYamlLoadError("size", resolvedPath, `file exceeds ${maxBytes} bytes`);
    }
    const buffer = Buffer.allocUnsafe(maxBytes + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.byteLength) {
      const result = await handle.read(buffer, bytesRead, buffer.byteLength - bytesRead, null);
      if (result.bytesRead === 0) {
        break;
      }
      bytesRead += result.bytesRead;
    }
    if (bytesRead > maxBytes) {
      throw new StrictYamlLoadError("size", resolvedPath, `file exceeds ${maxBytes} bytes`);
    }
    if (expectedIdentity) {
      const finalStats = await handle.stat();
      if (!finalStats.isFile()
        || !sameProductionIdentity(stats, finalStats)
        || !sameProductionIdentity(expectedIdentity, finalStats)) {
        throw new StrictYamlLoadError("read", resolvedPath, "file identity changed while reading");
      }
    }
    return buffer.subarray(0, bytesRead);
  } catch (error) {
    primaryError = error;
    if (error instanceof StrictYamlLoadError) {
      throw error;
    }
    throw new StrictYamlLoadError("read", resolvedPath, errorMessage(error));
  } finally {
    if (handle) {
      try {
        await handle.close();
      } catch (error) {
        if (!primaryError) {
          throw new StrictYamlLoadError("read", resolvedPath, `failed to close file: ${errorMessage(error)}`);
        }
      }
    }
  }
}

function findPolicyViolation(contents: Node | null): string | undefined {
  let violation: string | undefined;
  visit(contents, {
    Alias() {
      violation ??= "aliases are not allowed";
    },
    Node(_key, node) {
      if (isAlias(node)) {
        violation ??= "aliases are not allowed";
      } else if (node.anchor) {
        violation ??= "anchors are not allowed";
      } else if (node.tag) {
        violation ??= "explicit tags are not allowed";
      }
    },
    Pair(_key, pair: Pair) {
      if (isScalar(pair.key) && pair.key.value === "<<") {
        violation ??= "merge keys are not allowed";
      }
    }
  });
  return violation;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sameProductionIdentity(
  left: { dev?: number | bigint; ino?: number | bigint; size: number | bigint; mode?: number | bigint; mtimeMs?: number; ctimeMs?: number },
  right: { dev?: number | bigint; ino?: number | bigint; size: number | bigint; mode?: number | bigint; mtimeMs?: number; ctimeMs?: number }
): boolean {
  return left.dev !== undefined
    && right.dev !== undefined
    && left.ino !== undefined
    && right.ino !== undefined
    && String(left.dev) === String(right.dev)
    && String(left.ino) === String(right.ino)
    && String(left.size) === String(right.size)
    && String(left.mode) === String(right.mode)
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

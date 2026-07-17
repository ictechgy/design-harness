import { constants } from "node:fs";
import { open, stat as statPath } from "node:fs/promises";
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
import {
  SchemaValidationError,
  assertValidSchema,
  type CopyStyle
} from "@design-harness/core";

const MAX_COPY_STYLE_BYTES = 1024 * 1024;

export type CopyStyleLoadStage = "read" | "size" | "decode" | "parse" | "parse-policy" | "schema";

export class CopyStyleLoadError extends Error {
  constructor(
    public readonly stage: CopyStyleLoadStage,
    public readonly resolvedPath: string,
    detail: string
  ) {
    super(`Copy style ${stage} error at ${resolvedPath}: ${detail}`);
    this.name = "CopyStyleLoadError";
  }
}

interface CopyStyleFileHandle {
  stat(): Promise<{ size: number; isFile(): boolean }>;
  read(buffer: Buffer, offset: number, length: number, position: number | null): Promise<{ bytesRead: number }>;
  close(): Promise<void>;
}

export interface LoadCopyStyleOptions {
  cwd?: string;
  openFile?: (resolvedPath: string) => Promise<CopyStyleFileHandle>;
}

export async function loadCopyStyleFile(
  path: string,
  options: LoadCopyStyleOptions = {}
): Promise<CopyStyle> {
  const resolvedPath = resolve(options.cwd ?? process.cwd(), path);
  const bytes = await readBoundedFile(resolvedPath, options.openFile ?? openReadOnly);

  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new CopyStyleLoadError("decode", resolvedPath, "file is not valid UTF-8");
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
    throw new CopyStyleLoadError(
      "parse",
      resolvedPath,
      `${diagnostic.code} at line ${position.line}, column ${position.col}`
    );
  }

  const preludeEnd = document.range?.[0] ?? 0;
  if (/^%(?:YAML|TAG)(?:\s|$)/mu.test(source.slice(0, preludeEnd))) {
    throw new CopyStyleLoadError("parse-policy", resolvedPath, "YAML directives are not allowed");
  }

  const policyViolation = findPolicyViolation(document.contents);
  if (policyViolation) {
    throw new CopyStyleLoadError("parse-policy", resolvedPath, policyViolation);
  }

  let value: unknown;
  try {
    value = document.toJS({ maxAliasCount: 0 });
  } catch {
    throw new CopyStyleLoadError("parse-policy", resolvedPath, "aliases are not allowed");
  }

  try {
    assertValidSchema("copy-style", value);
  } catch (error) {
    if (error instanceof SchemaValidationError) {
      throw new CopyStyleLoadError("schema", resolvedPath, error.message);
    }
    throw error;
  }

  return value as CopyStyle;
}

async function openReadOnly(resolvedPath: string): Promise<CopyStyleFileHandle> {
  const pathStats = await statPath(resolvedPath);
  if (!pathStats.isFile()) {
    throw new CopyStyleLoadError("read", resolvedPath, "path is not a regular file");
  }
  return open(resolvedPath, copyStyleOpenFlags());
}

/** @internal Exported only so policy tests can lock the production open flags. */
export function copyStyleOpenFlags(): number {
  const nonBlocking = typeof constants.O_NONBLOCK === "number" ? constants.O_NONBLOCK : 0;
  return constants.O_RDONLY | nonBlocking;
}

async function readBoundedFile(
  resolvedPath: string,
  openFile: (resolvedPath: string) => Promise<CopyStyleFileHandle>
): Promise<Buffer> {
  let handle: CopyStyleFileHandle | undefined;
  let primaryError: unknown;
  try {
    handle = await openFile(resolvedPath);
    const stats = await handle.stat();
    if (!stats.isFile()) {
      throw new CopyStyleLoadError("read", resolvedPath, "path is not a regular file");
    }
    if (stats.size > MAX_COPY_STYLE_BYTES) {
      throw new CopyStyleLoadError("size", resolvedPath, `file exceeds ${MAX_COPY_STYLE_BYTES} bytes`);
    }
    const buffer = Buffer.allocUnsafe(MAX_COPY_STYLE_BYTES + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.byteLength) {
      const result = await handle.read(buffer, bytesRead, buffer.byteLength - bytesRead, null);
      if (result.bytesRead === 0) {
        break;
      }
      bytesRead += result.bytesRead;
    }
    if (bytesRead > MAX_COPY_STYLE_BYTES) {
      throw new CopyStyleLoadError("size", resolvedPath, `file exceeds ${MAX_COPY_STYLE_BYTES} bytes`);
    }
    return buffer.subarray(0, bytesRead);
  } catch (error) {
    primaryError = error;
    if (error instanceof CopyStyleLoadError) {
      throw error;
    }
    throw new CopyStyleLoadError("read", resolvedPath, errorMessage(error));
  } finally {
    if (handle) {
      try {
        await handle.close();
      } catch (error) {
        if (!primaryError) {
          throw new CopyStyleLoadError("read", resolvedPath, `failed to close file: ${errorMessage(error)}`);
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

import { resolve } from "node:path";
import {
  SchemaValidationError,
  assertValidSchema,
  type CopyStyle
} from "@design-harness/core";
import {
  DEFAULT_MAX_YAML_BYTES,
  StrictYamlLoadError,
  loadStrictYamlFile,
  strictYamlOpenFlags,
  type StrictYamlExpectedIdentity,
  type StrictYamlFileHandle
} from "./strict-yaml.js";

const MAX_COPY_STYLE_BYTES = DEFAULT_MAX_YAML_BYTES;

export type CopyStyleLoadStage = "read" | "size" | "decode" | "parse" | "parse-policy" | "schema";

export class CopyStyleLoadError extends Error {
  constructor(
    public readonly stage: CopyStyleLoadStage,
    public readonly resolvedPath: string,
    public readonly detail: string
  ) {
    super(`Copy style ${stage} error at ${resolvedPath}: ${detail}`);
    this.name = "CopyStyleLoadError";
  }
}

export interface LoadCopyStyleOptions {
  cwd?: string;
  requireRealPath?: boolean;
  expectedIdentity?: StrictYamlExpectedIdentity;
  openFile?: (resolvedPath: string) => Promise<StrictYamlFileHandle>;
}

export async function loadCopyStyleFile(
  path: string,
  options: LoadCopyStyleOptions = {}
): Promise<CopyStyle> {
  const resolvedPath = resolve(options.cwd ?? process.cwd(), path);
  let value: unknown;
  try {
    ({ value } = await loadStrictYamlFile(path, {
      cwd: options.cwd,
      maxBytes: MAX_COPY_STYLE_BYTES,
      requireRealPath: options.requireRealPath,
      expectedIdentity: options.expectedIdentity,
      openFile: options.openFile
    }));
  } catch (error) {
    if (error instanceof StrictYamlLoadError) {
      throw new CopyStyleLoadError(error.stage, error.resolvedPath, error.detail);
    }
    throw error;
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

/** @internal Exported only so policy tests can lock the production open flags. */
export function copyStyleOpenFlags(): number {
  return strictYamlOpenFlags();
}

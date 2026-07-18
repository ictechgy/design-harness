import { resolve } from "node:path";
import {
  SchemaValidationError,
  assertDesignGuideProfile,
  assertValidSchema,
  type DesignGuide
} from "@design-harness/core";
import {
  DEFAULT_MAX_YAML_BYTES,
  StrictYamlLoadError,
  loadStrictYamlFile,
  type StrictYamlExpectedIdentity,
  type StrictYamlFileHandle,
  type StrictYamlLoadStage
} from "./strict-yaml.js";

export type DesignGuideLoadStage = StrictYamlLoadStage | "schema" | "profile";

export class DesignGuideLoadError extends Error {
  constructor(
    public readonly stage: DesignGuideLoadStage,
    public readonly resolvedPath: string,
    public readonly detail: string
  ) {
    super(`Design guide ${stage} error at ${resolvedPath}: ${detail}`);
    this.name = "DesignGuideLoadError";
  }
}

export interface LoadDesignGuideOptions {
  cwd?: string;
  requireRealPath?: boolean;
  expectedIdentity?: StrictYamlExpectedIdentity;
  openFile?: (resolvedPath: string) => Promise<StrictYamlFileHandle>;
}

/**
 * Loads one explicit design guide through the shared strict YAML subset, then
 * applies the public authoring schema and the narrower supported DTCG profile.
 */
export async function loadDesignGuideFile(
  path: string,
  options: LoadDesignGuideOptions = {}
): Promise<DesignGuide> {
  const resolvedPath = resolve(options.cwd ?? process.cwd(), path);
  let value: unknown;
  try {
    ({ value } = await loadStrictYamlFile(path, {
      cwd: options.cwd,
      maxBytes: DEFAULT_MAX_YAML_BYTES,
      requireRealPath: options.requireRealPath,
      expectedIdentity: options.expectedIdentity,
      openFile: options.openFile
    }));
  } catch (error) {
    if (error instanceof StrictYamlLoadError) {
      throw new DesignGuideLoadError(error.stage, error.resolvedPath, error.detail);
    }
    throw error;
  }

  try {
    assertValidSchema("design-guide", value);
  } catch (error) {
    if (error instanceof SchemaValidationError) {
      throw new DesignGuideLoadError("schema", resolvedPath, error.message);
    }
    throw error;
  }

  try {
    assertDesignGuideProfile(value);
  } catch (error) {
    throw new DesignGuideLoadError("profile", resolvedPath, errorMessage(error));
  }

  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

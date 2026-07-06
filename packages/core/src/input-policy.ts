import { isAbsolute, relative, resolve, sep } from "node:path";

const DEFAULT_OUTPUT_TAIL_CHARACTERS = 12_000;

export interface WorkspacePathPolicyOptions {
  fieldName?: string;
  rootDir?: string;
  allowAbsolute?: boolean;
}

export interface WorkspacePathPolicyResult {
  input: string;
  rootDir: string;
  absolutePath: string;
  relativePath: string;
}

export function assertLocalHttpUrl(input: string): string {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error(`Invalid URL: ${input}`);
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`Invalid URL: ${input}. Only local http(s) URLs are supported.`);
  }

  if (parsed.username || parsed.password) {
    throw new Error(`Invalid URL: ${input}. Local audit URLs must not include credentials.`);
  }

  if (!isLocalHostname(parsed.hostname)) {
    throw new Error(`Invalid URL: ${input}. Only local http(s) URLs are supported.`);
  }

  return parsed.toString();
}

export function isLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]";
}

export function resolveWorkspacePath(input: string, options: WorkspacePathPolicyOptions = {}): WorkspacePathPolicyResult {
  const fieldName = options.fieldName ?? "path";
  if (!input || typeof input !== "string") {
    throw new Error(`Missing required string input: ${fieldName}`);
  }

  if (isAbsolute(input) && !options.allowAbsolute) {
    throw new Error(`${fieldName} must be relative to the workspace root.`);
  }

  const rootDir = resolve(options.rootDir ?? process.cwd());
  const absolutePath = resolve(rootDir, input);
  const relativePath = relative(rootDir, absolutePath);
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error(`${fieldName} must stay within the workspace root.`);
  }

  return {
    input,
    rootDir,
    absolutePath,
    relativePath: relativePath || "."
  };
}

export function tailText(input: string, maxCharacters = DEFAULT_OUTPUT_TAIL_CHARACTERS): string {
  if (input.length <= maxCharacters) {
    return input;
  }

  return `[output truncated to last ${maxCharacters} characters]\n${input.slice(-maxCharacters)}`;
}

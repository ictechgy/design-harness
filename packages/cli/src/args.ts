export interface AuditCommandArgs {
  command: "audit";
  url: string;
  outDir: string;
  copyStylePath?: string;
  timeoutMs?: number;
  allowPartial: boolean;
}

export interface GuideCompileCommandArgs {
  command: "guide";
  action: "compile";
  guidePath: string;
  copyStylePath?: string;
  targetDir: string;
}

export interface GuideCheckCommandArgs {
  command: "guide";
  action: "check";
  guidePath: string;
  copyStylePath?: string;
  targetDir: string;
  maxTokens: number;
}

export type HelpScope = "audit" | "guide" | "guide-compile" | "guide-check";

export interface HelpCommandArgs {
  command: "help";
  scope?: HelpScope;
}

export type ParsedArgs = AuditCommandArgs | GuideCompileCommandArgs | GuideCheckCommandArgs | HelpCommandArgs;

const AUDIT_VALUE_OPTIONS = new Set(["url", "out", "timeout-ms", "copy"]);
const AUDIT_BOOLEAN_OPTIONS = new Set(["allow-partial"]);
const GUIDE_COMPILE_VALUE_OPTIONS = new Set(["guide", "copy", "target"]);
const GUIDE_CHECK_VALUE_OPTIONS = new Set(["guide", "copy", "target", "max-tokens"]);
const NO_BOOLEAN_OPTIONS = new Set<string>();
const DEFAULT_MAX_GUIDE_TOKENS = 2000;

export function parseArgs(argv: string[]): ParsedArgs {
  const normalizedArgv = argv[0] === "--" ? argv.slice(1) : argv;
  const [command, ...rest] = normalizedArgv;
  if (!command || isHelpToken(command)) {
    return { command: "help" };
  }

  if (command === "audit") {
    if (isOnlyHelp(rest)) {
      return { command: "help", scope: "audit" };
    }
    return parseAuditArgs(rest);
  }

  if (command === "guide") {
    return parseGuideArgs(rest);
  }

  throw new Error(`Unknown command: ${command}`);
}

export function helpText(scope?: HelpScope): string {
  switch (scope) {
    case "audit":
      return auditHelpText();
    case "guide":
      return guideHelpText();
    case "guide-compile":
      return guideCompileHelpText();
    case "guide-check":
      return guideCheckHelpText();
    default:
      return rootHelpText();
  }
}

function parseAuditArgs(rest: string[]): AuditCommandArgs {
  const { values, flags } = parseOptions(rest, AUDIT_VALUE_OPTIONS, AUDIT_BOOLEAN_OPTIONS);
  const url = requireOption(values, "url", "<local-url>");
  const outDir = requireOption(values, "out", "<directory>");
  const timeout = values.get("timeout-ms");
  return {
    command: "audit",
    url,
    outDir,
    copyStylePath: values.get("copy"),
    timeoutMs: timeout ? parseTimeout(timeout) : undefined,
    allowPartial: flags.has("allow-partial")
  };
}

function parseGuideArgs(rest: string[]): GuideCompileCommandArgs | GuideCheckCommandArgs | HelpCommandArgs {
  const [action, ...actionArgs] = rest;
  if (!action || isHelpToken(action)) {
    return { command: "help", scope: "guide" };
  }
  if (action !== "compile" && action !== "check") {
    throw new Error(`Unknown guide command: ${action}`);
  }
  if (isOnlyHelp(actionArgs)) {
    return { command: "help", scope: action === "compile" ? "guide-compile" : "guide-check" };
  }

  const valueOptions = action === "compile" ? GUIDE_COMPILE_VALUE_OPTIONS : GUIDE_CHECK_VALUE_OPTIONS;
  const { values } = parseOptions(actionArgs, valueOptions, NO_BOOLEAN_OPTIONS);
  const common = {
    command: "guide" as const,
    guidePath: requireOption(values, "guide", "<design-guide.yaml>"),
    copyStylePath: values.get("copy"),
    targetDir: requireOption(values, "target", "<project-dir>")
  };

  if (action === "compile") {
    return { ...common, action };
  }
  const maxTokensValue = values.get("max-tokens");
  return {
    ...common,
    action,
    maxTokens: maxTokensValue ? parseMaxTokens(maxTokensValue) : DEFAULT_MAX_GUIDE_TOKENS
  };
}

function parseOptions(
  args: string[],
  valueOptions: ReadonlySet<string>,
  booleanOptions: ReadonlySet<string>
): { values: Map<string, string>; flags: Set<string> } {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }
    const option = token.slice(2);
    if (booleanOptions.has(option)) {
      if (flags.has(option)) {
        throw new Error(`Duplicate option: ${token}`);
      }
      flags.add(option);
      continue;
    }
    if (!valueOptions.has(option)) {
      throw new Error(`Unknown option: ${token}`);
    }
    if (values.has(option)) {
      throw new Error(`Duplicate option: ${token}`);
    }
    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for ${token}`);
    }
    values.set(option, next);
    index += 1;
  }
  return { values, flags };
}

function requireOption(values: ReadonlyMap<string, string>, option: string, placeholder: string): string {
  const value = values.get(option);
  if (!value) {
    throw new Error(`Missing required --${option} ${placeholder}`);
  }
  return value;
}

function parseTimeout(value: string): number {
  const timeoutMs = Number(value);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) {
    throw new Error(`Invalid --timeout-ms ${value}. Use an integer from 100 to 120000.`);
  }
  return timeoutMs;
}

function parseMaxTokens(value: string): number {
  const maxTokens = Number(value);
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > DEFAULT_MAX_GUIDE_TOKENS) {
    throw new Error(`Invalid --max-tokens ${value}. Use an integer from 1 to 2000.`);
  }
  return maxTokens;
}

function isHelpToken(value: string): boolean {
  return value === "--help" || value === "-h" || value === "help";
}

function isOnlyHelp(args: string[]): boolean {
  return args.length === 1 && isHelpToken(args[0]);
}

function rootHelpText(): string {
  return [
    "Design Harness",
    "",
    "Usage:",
    "  design-harness audit --url <local-url> --out <directory> [--copy <copy-style.yaml>] [--timeout-ms <ms>] [--allow-partial]",
    "  design-harness guide compile --guide <design-guide.yaml> --target <project-dir> [options]",
    "  design-harness guide check --guide <design-guide.yaml> --target <project-dir> [options]",
    "",
    "Commands:",
    "  audit          Capture desktop/mobile screenshots and write audit artifacts.",
    "  guide compile  Compile explicit guide inputs into marker-owned project artifacts.",
    "  guide check    Check guide drift and budget without writing files.",
    "",
    "Notes:",
    "  Audit targets must be local http(s) URLs such as http://localhost:3000.",
    "  Copy analysis is opt-in and reads only the explicit local --copy file.",
    "  Partial audits write artifacts and exit 2 unless --allow-partial is set.",
    "",
    "Run design-harness <command> --help for command-specific options."
  ].join("\n");
}

function auditHelpText(): string {
  return [
    "Design Harness audit",
    "",
    "Usage:",
    "  design-harness audit --url <local-url> --out <directory> [--copy <copy-style.yaml>] [--timeout-ms <ms>] [--allow-partial]",
    "",
    "Notes:",
    "  Audit targets must be local http(s) URLs such as http://localhost:3000.",
    "  Copy analysis is opt-in and reads only the explicit local --copy file.",
    "  Partial audits write artifacts and exit 2 unless --allow-partial is set."
  ].join("\n");
}

function guideHelpText(): string {
  return [
    "Design Harness guide",
    "",
    "Usage:",
    "  design-harness guide compile --guide <design-guide.yaml> --target <project-dir> [options]",
    "  design-harness guide check --guide <design-guide.yaml> --target <project-dir> [options]",
    "",
    "Commands:",
    "  compile  Write the deterministic guide pack after all preflight checks pass.",
    "  check    Compare the deterministic guide pack without writing files."
  ].join("\n");
}

function guideCompileHelpText(): string {
  return [
    "Design Harness guide compile",
    "",
    "Usage:",
    "  design-harness guide compile --guide <design-guide.yaml> [--copy <copy-style.yaml>] --target <project-dir>",
    "",
    "The guide and optional copy style must be explicit files inside the target project."
  ].join("\n");
}

function guideCheckHelpText(): string {
  return [
    "Design Harness guide check",
    "",
    "Usage:",
    "  design-harness guide check --guide <design-guide.yaml> [--copy <copy-style.yaml>] --target <project-dir> [--max-tokens <1..2000>]",
    "",
    "Check performs zero writes. --max-tokens defaults to 2000."
  ].join("\n");
}

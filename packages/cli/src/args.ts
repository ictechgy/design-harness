export interface AuditCommandArgs {
  command: "audit";
  url: string;
  outDir: string;
  guidePath?: string;
  copyStylePath?: string;
  timeoutMs?: number;
  allowPartial: boolean;
}

export interface LoopCommandArgs {
  command: "loop";
  url: string;
  outDir: string;
  until: "deterministic-failures==0";
  maxIters: number;
  agentCmd: string;
  agentTimeoutMs: number;
  guidePath?: string;
  copyStylePath?: string;
  timeoutMs?: number;
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

export type HelpScope = "audit" | "loop" | "guide" | "guide-compile" | "guide-check";

export interface HelpCommandArgs {
  command: "help";
  scope?: HelpScope;
}

export type ParsedArgs =
  | AuditCommandArgs
  | LoopCommandArgs
  | GuideCompileCommandArgs
  | GuideCheckCommandArgs
  | HelpCommandArgs;

const AUDIT_VALUE_OPTIONS = new Set(["url", "out", "timeout-ms", "guide", "copy"]);
const AUDIT_BOOLEAN_OPTIONS = new Set(["allow-partial"]);
const LOOP_VALUE_OPTIONS = new Set([
  "url",
  "out",
  "until",
  "max-iters",
  "agent-cmd",
  "agent-timeout-ms",
  "timeout-ms",
  "guide",
  "copy"
]);
const GUIDE_COMPILE_VALUE_OPTIONS = new Set(["guide", "copy", "target"]);
const GUIDE_CHECK_VALUE_OPTIONS = new Set(["guide", "copy", "target", "max-tokens"]);
const NO_BOOLEAN_OPTIONS = new Set<string>();
const DEFAULT_MAX_GUIDE_TOKENS = 2000;
const LOOP_UNTIL = "deterministic-failures==0" as const;
const DEFAULT_AGENT_TIMEOUT_MS = 300_000;
const MAX_AGENT_COMMAND_SCALARS = 8_192;

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

  if (command === "loop") {
    if (isOnlyHelp(rest)) {
      return { command: "help", scope: "loop" };
    }
    return parseLoopArgs(rest);
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
    case "loop":
      return loopHelpText();
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
    guidePath: values.get("guide"),
    copyStylePath: values.get("copy"),
    timeoutMs: timeout ? parseTimeout(timeout) : undefined,
    allowPartial: flags.has("allow-partial")
  };
}

function parseLoopArgs(rest: string[]): LoopCommandArgs {
  const { values } = parseOptions(rest, LOOP_VALUE_OPTIONS, NO_BOOLEAN_OPTIONS);
  const until = requireOption(values, "until", LOOP_UNTIL);
  if (until !== LOOP_UNTIL) {
    throw new Error(`Invalid --until ${until}. Only ${LOOP_UNTIL} is supported.`);
  }
  const maxItersValue = requireOption(values, "max-iters", "<1..10>");
  const agentTimeoutValue = values.get("agent-timeout-ms");
  const timeout = values.get("timeout-ms");
  return {
    command: "loop",
    url: requireOption(values, "url", "<local-url>"),
    outDir: requireOption(values, "out", "<new-directory>"),
    until,
    maxIters: parseIntegerRange(maxItersValue, "max-iters", 1, 10),
    agentCmd: parseAgentCommand(requireOption(values, "agent-cmd", "<non-interactive-command>")),
    agentTimeoutMs: agentTimeoutValue
      ? parseIntegerRange(agentTimeoutValue, "agent-timeout-ms", 1_000, 3_600_000)
      : DEFAULT_AGENT_TIMEOUT_MS,
    guidePath: values.get("guide"),
    copyStylePath: values.get("copy"),
    timeoutMs: timeout ? parseTimeout(timeout) : undefined
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

function parseIntegerRange(value: string, option: string, minimum: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`Invalid --${option} ${value}. Use an integer from ${minimum} to ${maximum}.`);
  }
  return parsed;
}

function parseAgentCommand(value: string): string {
  if (
    value.length === 0
    || value !== value.trim()
    || value.includes("\0")
    || hasUnpairedSurrogate(value)
    || [...value].length > MAX_AGENT_COMMAND_SCALARS
  ) {
    throw new Error(
      `Invalid --agent-cmd. Use a non-empty trim-stable, NUL-free command of at most ${MAX_AGENT_COMMAND_SCALARS} Unicode scalar values.`
    );
  }
  return value;
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return true;
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true;
    }
  }
  return false;
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
    "  design-harness audit --url <local-url> --out <directory> [--guide <design-guide.yaml>] [--copy <copy-style.yaml>] [--timeout-ms <ms>] [--allow-partial]",
    "  design-harness loop --url <local-url> --out <new-directory> --until deterministic-failures==0 --max-iters <1..10> --agent-cmd '<non-interactive command>' [options]",
    "  design-harness guide compile --guide <design-guide.yaml> --target <project-dir> [options]",
    "  design-harness guide check --guide <design-guide.yaml> --target <project-dir> [options]",
    "",
    "Commands:",
    "  audit          Capture desktop/mobile screenshots and write audit artifacts.",
    "  loop           Run bounded audit/agent passes until deterministic failures reach zero.",
    "  guide compile  Compile explicit guide inputs into marker-owned project artifacts.",
    "  guide check    Check guide drift and budget without writing files.",
    "",
    "Notes:",
    "  Audit targets must be local http(s) URLs such as http://localhost:3000.",
    "  Font-family adherence is opt-in, reads only the explicit local --guide file, and performs no auto-discovery.",
    "  Copy analysis is opt-in and reads only the explicit local --copy file.",
    "  Plain audit partial artifacts exit 2 unless audit --allow-partial is set; loop never supports --allow-partial.",
    "  Loop --agent-cmd executes arbitrary code with the caller's permissions and inherited environment, which may expose credentials.",
    "  Loop provides no sandbox or network boundary for the agent command.",
    "",
    "Run design-harness <command> --help for command-specific options."
  ].join("\n");
}

function loopHelpText(): string {
  return [
    "Design Harness loop",
    "",
    "Usage:",
    "  design-harness loop --url <local-url> --out <new-directory> --until deterministic-failures==0 --max-iters <1..10> --agent-cmd '<non-interactive command>' [--agent-timeout-ms <1000..3600000>] [--guide <design-guide.yaml>] [--copy <copy-style.yaml>] [--timeout-ms <ms>]",
    "",
    "Notes:",
    "  Only --until deterministic-failures==0 is supported. --max-iters counts agent passes; the baseline audit is additional.",
    "  --agent-timeout-ms defaults to 300000.",
    "  --agent-cmd executes arbitrary code with the caller's permissions.",
    "  The command inherits the caller environment, which may expose credentials.",
    "  No sandbox or network boundary is provided.",
    "  Audit targets must be local http(s) URLs. Partial audits stop the loop with exit 2; --allow-partial is not supported."
  ].join("\n");
}

function auditHelpText(): string {
  return [
    "Design Harness audit",
    "",
    "Usage:",
    "  design-harness audit --url <local-url> --out <directory> [--guide <design-guide.yaml>] [--copy <copy-style.yaml>] [--timeout-ms <ms>] [--allow-partial]",
    "",
    "Notes:",
    "  Audit targets must be local http(s) URLs such as http://localhost:3000.",
    "  Font-family adherence is opt-in, reads only the explicit local --guide file, and performs no auto-discovery.",
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

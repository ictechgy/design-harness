export interface AuditCommandArgs {
  command: "audit";
  url: string;
  outDir: string;
  timeoutMs?: number;
  allowPartial: boolean;
}

export type ParsedArgs = AuditCommandArgs | { command: "help" };

export function parseArgs(argv: string[]): ParsedArgs {
  const normalizedArgv = argv[0] === "--" ? argv.slice(1) : argv;
  const [command, ...rest] = normalizedArgv;
  if (!command || command === "--help" || command === "-h" || command === "help") {
    return { command: "help" };
  }

  if (command !== "audit") {
    throw new Error(`Unknown command: ${command}`);
  }

  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }
    if (token === "--allow-partial") {
      flags.add(token.slice(2));
      continue;
    }
    const next = rest[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for ${token}`);
    }
    values.set(token.slice(2), next);
    index += 1;
  }

  const url = values.get("url");
  const outDir = values.get("out");
  if (!url) {
    throw new Error("Missing required --url <local-url>");
  }
  if (!outDir) {
    throw new Error("Missing required --out <directory>");
  }

  const timeout = values.get("timeout-ms");
  const timeoutMs = timeout ? parseTimeout(timeout) : undefined;
  return {
    command: "audit",
    url,
    outDir,
    timeoutMs,
    allowPartial: flags.has("allow-partial")
  };
}

export function helpText(): string {
  return [
    "Design Harness",
    "",
    "Usage:",
    "  design-harness audit --url <local-url> --out <directory> [--timeout-ms <ms>] [--allow-partial]",
    "",
    "Commands:",
    "  audit    Capture desktop/mobile screenshots and write audit artifacts.",
    "",
    "Notes:",
    "  v0.3 only accepts local http(s) URLs such as http://localhost:3000.",
    "  Partial audits write artifacts and exit 2 unless --allow-partial is set."
  ].join("\n");
}

function parseTimeout(value: string): number {
  const timeoutMs = Number(value);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) {
    throw new Error(`Invalid --timeout-ms ${value}. Use an integer from 100 to 120000.`);
  }
  return timeoutMs;
}

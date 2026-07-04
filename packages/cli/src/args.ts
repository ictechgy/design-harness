export interface AuditCommandArgs {
  command: "audit";
  url: string;
  outDir: string;
  timeoutMs?: number;
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
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
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
  return {
    command: "audit",
    url,
    outDir,
    timeoutMs: timeout ? Number(timeout) : undefined
  };
}

export function helpText(): string {
  return [
    "Design Harness",
    "",
    "Usage:",
    "  design-harness audit --url <local-url> --out <directory> [--timeout-ms <ms>]",
    "",
    "Commands:",
    "  audit    Capture desktop/mobile screenshots and write audit artifacts.",
    "",
    "Notes:",
    "  v0.1 only accepts local http(s) URLs such as http://localhost:3000."
  ].join("\n");
}

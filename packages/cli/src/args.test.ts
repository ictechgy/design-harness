import { describe, expect, it } from "vitest";
import { helpText, parseArgs } from "./args.js";
import { assertLocalHttpUrl } from "./url.js";

const validLoopArgv = [
  "loop",
  "--url",
  "http://localhost:3000",
  "--out",
  "runs/repair",
  "--until",
  "deterministic-failures==0",
  "--max-iters",
  "3",
  "--agent-cmd",
  "codex exec --full-auto"
];

describe("parseArgs", () => {
  it("parses audit arguments", () => {
    expect(parseArgs(["audit", "--url", "http://localhost:3000", "--out", "runs/demo"])).toEqual({
      command: "audit",
      url: "http://localhost:3000",
      outDir: "runs/demo",
      guidePath: undefined,
      copyStylePath: undefined,
      timeoutMs: undefined,
      allowPartial: false
    });
  });

  it("parses an explicit copy style path", () => {
    expect(parseArgs([
      "audit",
      "--url",
      "http://localhost:3000",
      "--out",
      "runs/demo",
      "--copy",
      "configs/copy-style.yaml"
    ])).toMatchObject({
      command: "audit",
      copyStylePath: "configs/copy-style.yaml"
    });
  });

  it("parses an explicit audit-time design guide path", () => {
    expect(parseArgs([
      "audit",
      "--url",
      "http://localhost:3000",
      "--out",
      "runs/demo",
      "--guide",
      "configs/design-guide.yaml"
    ])).toMatchObject({
      command: "audit",
      guidePath: "configs/design-guide.yaml"
    });
  });

  it("parses allow-partial", () => {
    expect(parseArgs(["audit", "--url", "http://localhost:3000", "--out", "runs/demo", "--allow-partial"])).toMatchObject({
      command: "audit",
      allowPartial: true
    });
  });

  it("parses the exact loop contract and defaults the agent timeout", () => {
    expect(parseArgs(validLoopArgv)).toEqual({
      command: "loop",
      url: "http://localhost:3000",
      outDir: "runs/repair",
      until: "deterministic-failures==0",
      maxIters: 3,
      agentCmd: "codex exec --full-auto",
      agentTimeoutMs: 300_000,
      guidePath: undefined,
      copyStylePath: undefined,
      timeoutMs: undefined
    });
  });

  it("parses loop bounds and optional audit configuration", () => {
    expect(parseArgs([
      ...validLoopArgv.slice(0, -4),
      "--max-iters",
      "10",
      "--agent-cmd",
      "repair-ui",
      "--agent-timeout-ms",
      "3600000",
      "--timeout-ms",
      "120000",
      "--guide",
      "config/design-guide.yaml",
      "--copy",
      "config/copy-style.yaml"
    ])).toMatchObject({
      command: "loop",
      maxIters: 10,
      agentCmd: "repair-ui",
      agentTimeoutMs: 3_600_000,
      timeoutMs: 120_000,
      guidePath: "config/design-guide.yaml",
      copyStylePath: "config/copy-style.yaml"
    });
  });

  it.each(["failures==0", "deterministic-failures <= 0", "score==100", ""])(
    "rejects unsupported loop condition %j",
    (condition) => {
      const argv = [...validLoopArgv];
      argv[argv.indexOf("deterministic-failures==0")] = condition;
      expect(() => parseArgs(argv)).toThrow(condition ? "Invalid --until" : "Missing value for --until");
    }
  );

  it.each(["0", "11", "-1", "1.5", "NaN"])("rejects invalid --max-iters %s", (value) => {
    const argv = [...validLoopArgv];
    argv[argv.indexOf("3")] = value;
    expect(() => parseArgs(argv)).toThrow("Invalid --max-iters");
  });

  it("accepts both iteration boundaries", () => {
    const minimum = [...validLoopArgv];
    minimum[minimum.indexOf("3")] = "1";
    expect(parseArgs(minimum)).toMatchObject({ maxIters: 1 });
    const maximum = [...validLoopArgv];
    maximum[maximum.indexOf("3")] = "10";
    expect(parseArgs(maximum)).toMatchObject({ maxIters: 10 });
  });

  it.each(["999", "3600001", "-1", "1000.5", "NaN"])(
    "rejects invalid --agent-timeout-ms %s",
    (value) => {
      expect(() => parseArgs([...validLoopArgv, "--agent-timeout-ms", value])).toThrow(
        "Invalid --agent-timeout-ms"
      );
    }
  );

  it("accepts both agent-timeout boundaries", () => {
    expect(parseArgs([...validLoopArgv, "--agent-timeout-ms", "1000"]))
      .toMatchObject({ agentTimeoutMs: 1_000 });
    expect(parseArgs([...validLoopArgv, "--agent-timeout-ms", "3600000"]))
      .toMatchObject({ agentTimeoutMs: 3_600_000 });
  });

  it("enforces trim, NUL, Unicode-scalar validity, and the 8192-scalar command bound", () => {
    const commandIndex = validLoopArgv.indexOf("codex exec --full-auto");
    const withCommand = (command: string): string[] => {
      const argv = [...validLoopArgv];
      argv[commandIndex] = command;
      return argv;
    };
    for (const invalid of [" repair", "repair ", "repair\0now", "\ud800", "x".repeat(8_193)]) {
      expect(() => parseArgs(withCommand(invalid))).toThrow("Invalid --agent-cmd");
    }
    const astralAtLimit = "🧰".repeat(8_192);
    expect(parseArgs(withCommand(astralAtLimit))).toMatchObject({ agentCmd: astralAtLimit });
    expect(() => parseArgs(withCommand(`${astralAtLimit}x`))).toThrow("Invalid --agent-cmd");
  });

  it("does not support --allow-partial or boolean options on loop", () => {
    expect(() => parseArgs([...validLoopArgv, "--allow-partial"])).toThrow(
      "Unknown option: --allow-partial"
    );
  });

  it.each(["--url", "--out", "--until", "--max-iters", "--agent-cmd"])(
    "requires loop option %s",
    (option) => {
      const optionIndex = validLoopArgv.indexOf(option);
      const argv = validLoopArgv.filter((_value, index) => index !== optionIndex && index !== optionIndex + 1);
      expect(() => parseArgs(argv)).toThrow(`Missing required ${option}`);
    }
  );

  it.each(["--url", "--out", "--until", "--max-iters", "--agent-cmd", "--agent-timeout-ms"])(
    "rejects duplicate loop option %s",
    (option) => {
      const duplicateValue = option === "--until"
        ? "deterministic-failures==0"
        : option === "--agent-timeout-ms"
          ? "1000"
          : option === "--max-iters"
            ? "2"
            : option === "--url"
              ? "http://localhost:4000"
              : "duplicate";
      const argv = [...validLoopArgv, option, duplicateValue];
      if (option === "--agent-timeout-ms") {
        argv.push(option, duplicateValue);
      }
      expect(() => parseArgs(argv)).toThrow(`Duplicate option: ${option}`);
    }
  );

  it("rejects invalid timeout values", () => {
    expect(() => parseArgs(["audit", "--url", "http://localhost:3000", "--out", "runs/demo", "--timeout-ms", "NaN"])).toThrow(
      "Invalid --timeout-ms"
    );
    expect(() => parseArgs(["audit", "--url", "http://localhost:3000", "--out", "runs/demo", "--timeout-ms", "0"])).toThrow(
      "Invalid --timeout-ms"
    );
  });

  it("rejects missing values", () => {
    expect(() => parseArgs(["audit", "--url"])).toThrow("Missing value");
    expect(() => parseArgs([
      "audit",
      "--url",
      "http://localhost:3000",
      "--out",
      "runs/demo",
      "--guide"
    ])).toThrow("Missing value for --guide");
  });

  it("rejects unknown options before they can silently disable copy analysis", () => {
    expect(() => parseArgs([
      "audit",
      "--url",
      "http://localhost:3000",
      "--out",
      "runs/demo",
      "--cop",
      "copy-style.yaml"
    ])).toThrow("Unknown option: --cop");
  });

  it.each(["--url", "--out", "--timeout-ms", "--guide", "--copy"])("rejects duplicate value option %s", (option) => {
    const argv = [
      "audit",
      "--url",
      "http://localhost:3000",
      "--out",
      "runs/demo"
    ];
    if (option === "--timeout-ms") {
      argv.push(option, "1000", option, "2000");
    } else if (option === "--copy" || option === "--guide") {
      argv.push(option, "first.yaml", option, "second.yaml");
    } else {
      argv.push(option, option === "--url" ? "http://localhost:4000" : "duplicate");
    }
    expect(() => parseArgs(argv)).toThrow(`Duplicate option: ${option}`);
  });

  it("rejects a duplicate boolean option", () => {
    expect(() => parseArgs([
      "audit",
      "--url",
      "http://localhost:3000",
      "--out",
      "runs/demo",
      "--allow-partial",
      "--allow-partial"
    ])).toThrow("Duplicate option: --allow-partial");
  });

  it("rejects stray positional arguments", () => {
    expect(() => parseArgs(["audit", "--url", "http://localhost:3000", "--out", "runs/demo", "stray"])).toThrow(
      "Unexpected argument: stray"
    );
  });

  it("ignores a leading script argument separator", () => {
    expect(parseArgs(["--", "help"])).toEqual({ command: "help" });
  });

  it("parses guide compile into a distinct command shape", () => {
    expect(parseArgs([
      "guide",
      "compile",
      "--guide",
      "config/design-guide.yaml",
      "--copy",
      "config/copy-style.yaml",
      "--target",
      "."
    ])).toEqual({
      command: "guide",
      action: "compile",
      guidePath: "config/design-guide.yaml",
      copyStylePath: "config/copy-style.yaml",
      targetDir: "."
    });
  });

  it("parses guide check and defaults its estimate ceiling to 2000", () => {
    expect(parseArgs([
      "guide",
      "check",
      "--guide",
      "design-guide.yaml",
      "--target",
      "/project"
    ])).toEqual({
      command: "guide",
      action: "check",
      guidePath: "design-guide.yaml",
      copyStylePath: undefined,
      targetDir: "/project",
      maxTokens: 2000
    });
    expect(parseArgs([
      "guide",
      "check",
      "--guide",
      "design-guide.yaml",
      "--target",
      "/project",
      "--max-tokens",
      "1"
    ])).toMatchObject({ command: "guide", action: "check", maxTokens: 1 });
  });

  it.each(["0", "2001", "-1", "1.5", "NaN"])("rejects invalid --max-tokens %s", (value) => {
    expect(() => parseArgs([
      "guide",
      "check",
      "--guide",
      "design-guide.yaml",
      "--target",
      ".",
      "--max-tokens",
      value
    ])).toThrow("Invalid --max-tokens");
  });

  it("rejects missing and duplicate guide option values", () => {
    expect(() => parseArgs(["guide", "compile", "--guide"])).toThrow("Missing value for --guide");
    expect(() => parseArgs([
      "guide",
      "compile",
      "--guide",
      "one.yaml",
      "--guide",
      "two.yaml",
      "--target",
      "."
    ])).toThrow("Duplicate option: --guide");
  });

  it("rejects missing required guide options", () => {
    expect(() => parseArgs(["guide", "compile", "--target", "."])).toThrow(
      "Missing required --guide <design-guide.yaml>"
    );
    expect(() => parseArgs(["guide", "check", "--guide", "design-guide.yaml"])).toThrow(
      "Missing required --target <project-dir>"
    );
  });

  it("keeps audit and guide option namespaces isolated", () => {
    expect(() => parseArgs([
      "audit",
      "--url",
      "http://localhost:3000",
      "--out",
      "runs/demo",
      "--target",
      "."
    ])).toThrow("Unknown option: --target");
    expect(() => parseArgs([
      "guide",
      "compile",
      "--guide",
      "design-guide.yaml",
      "--target",
      ".",
      "--url",
      "http://localhost:3000"
    ])).toThrow("Unknown option: --url");
    expect(() => parseArgs([
      "guide",
      "compile",
      "--guide",
      "design-guide.yaml",
      "--target",
      ".",
      "--max-tokens",
      "1000"
    ])).toThrow("Unknown option: --max-tokens");
  });

  it("rejects unknown guide commands and positional arguments", () => {
    expect(() => parseArgs(["guide", "render"])).toThrow("Unknown guide command: render");
    expect(() => parseArgs([
      "guide",
      "check",
      "--guide",
      "design-guide.yaml",
      "--target",
      ".",
      "stray"
    ])).toThrow("Unexpected argument: stray");
  });

  it("returns scoped help commands", () => {
    expect(parseArgs(["audit", "--help"])).toEqual({ command: "help", scope: "audit" });
    expect(parseArgs(["loop", "--help"])).toEqual({ command: "help", scope: "loop" });
    expect(parseArgs(["guide"])).toEqual({ command: "help", scope: "guide" });
    expect(parseArgs(["guide", "--help"])).toEqual({ command: "help", scope: "guide" });
    expect(parseArgs(["guide", "compile", "--help"])).toEqual({ command: "help", scope: "guide-compile" });
    expect(parseArgs(["guide", "check", "-h"])).toEqual({ command: "help", scope: "guide-check" });
  });
});

describe("helpText", () => {
  it("describes the local URL policy without stale version labels", () => {
    expect(helpText()).toContain("Audit targets must be local http(s) URLs");
    expect(helpText()).toContain("--guide <design-guide.yaml>");
    expect(helpText()).toContain("--copy <copy-style.yaml>");
    expect(helpText()).toContain("opt-in");
    expect(helpText()).not.toContain("v0.3");
  });

  it("warns at root and loop scope about the explicit process boundary", () => {
    for (const text of [helpText(), helpText("loop")]) {
      const normalized = text.toLowerCase();
      expect(normalized).toContain("arbitrary code");
      expect(normalized).toContain("caller");
      expect(normalized).toContain("environment");
      expect(normalized).toContain("credentials");
      expect(normalized).toContain("no sandbox");
      expect(normalized).toContain("network boundary");
    }
    expect(helpText("loop")).toContain("deterministic-failures==0");
    expect(helpText("loop")).toContain("--agent-timeout-ms");
    expect(helpText("loop")).toContain("--allow-partial is not supported");
  });

  it("renders scoped guide help", () => {
    expect(helpText("guide")).toContain("guide compile");
    expect(helpText("guide-compile")).toContain("--guide <design-guide.yaml>");
    expect(helpText("guide-compile")).not.toContain("--max-tokens");
    expect(helpText("guide-check")).toContain("--max-tokens <1..2000>");
    expect(helpText("guide-check")).toContain("zero writes");
  });

  it("renders audit-scoped guide help without implying discovery", () => {
    expect(helpText("audit")).toContain("--guide <design-guide.yaml>");
    expect(helpText("audit")).toContain("no auto-discovery");
  });
});

describe("assertLocalHttpUrl", () => {
  it("accepts localhost URLs", () => {
    expect(assertLocalHttpUrl("http://localhost:3000")).toBe("http://localhost:3000/");
    expect(assertLocalHttpUrl("http://preview.localhost:3000")).toBe("http://preview.localhost:3000/");
    expect(assertLocalHttpUrl("http://127.0.0.1:3000")).toBe("http://127.0.0.1:3000/");
    expect(assertLocalHttpUrl("http://[::1]:3000")).toBe("http://[::1]:3000/");
  });

  it("rejects remote URLs", () => {
    expect(() => assertLocalHttpUrl("https://example.com")).toThrow("Only local http(s)");
  });

  it("rejects embedded credentials", () => {
    expect(() => assertLocalHttpUrl("http://user:pass@localhost:3000")).toThrow("must not include credentials");
  });
});

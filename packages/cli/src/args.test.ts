import { describe, expect, it } from "vitest";
import { helpText, parseArgs } from "./args.js";
import { assertLocalHttpUrl } from "./url.js";

describe("parseArgs", () => {
  it("parses audit arguments", () => {
    expect(parseArgs(["audit", "--url", "http://localhost:3000", "--out", "runs/demo"])).toEqual({
      command: "audit",
      url: "http://localhost:3000",
      outDir: "runs/demo",
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

  it("parses allow-partial", () => {
    expect(parseArgs(["audit", "--url", "http://localhost:3000", "--out", "runs/demo", "--allow-partial"])).toMatchObject({
      command: "audit",
      allowPartial: true
    });
  });

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

  it.each(["--url", "--out", "--timeout-ms", "--copy"])("rejects duplicate value option %s", (option) => {
    const argv = [
      "audit",
      "--url",
      "http://localhost:3000",
      "--out",
      "runs/demo"
    ];
    if (option === "--timeout-ms") {
      argv.push(option, "1000", option, "2000");
    } else if (option === "--copy") {
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
      "--guide",
      "design-guide.yaml"
    ])).toThrow("Unknown option: --guide");
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
    expect(parseArgs(["guide"])).toEqual({ command: "help", scope: "guide" });
    expect(parseArgs(["guide", "--help"])).toEqual({ command: "help", scope: "guide" });
    expect(parseArgs(["guide", "compile", "--help"])).toEqual({ command: "help", scope: "guide-compile" });
    expect(parseArgs(["guide", "check", "-h"])).toEqual({ command: "help", scope: "guide-check" });
  });
});

describe("helpText", () => {
  it("describes the local URL policy without stale version labels", () => {
    expect(helpText()).toContain("Audit targets must be local http(s) URLs");
    expect(helpText()).toContain("--copy <copy-style.yaml>");
    expect(helpText()).toContain("opt-in");
    expect(helpText()).not.toContain("v0.3");
  });

  it("renders scoped guide help", () => {
    expect(helpText("guide")).toContain("guide compile");
    expect(helpText("guide-compile")).toContain("--guide <design-guide.yaml>");
    expect(helpText("guide-compile")).not.toContain("--max-tokens");
    expect(helpText("guide-check")).toContain("--max-tokens <1..2000>");
    expect(helpText("guide-check")).toContain("zero writes");
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

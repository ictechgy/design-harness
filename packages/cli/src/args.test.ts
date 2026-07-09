import { describe, expect, it } from "vitest";
import { helpText, parseArgs } from "./args.js";
import { assertLocalHttpUrl } from "./url.js";

describe("parseArgs", () => {
  it("parses audit arguments", () => {
    expect(parseArgs(["audit", "--url", "http://localhost:3000", "--out", "runs/demo"])).toEqual({
      command: "audit",
      url: "http://localhost:3000",
      outDir: "runs/demo",
      timeoutMs: undefined,
      allowPartial: false
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

  it("ignores a leading script argument separator", () => {
    expect(parseArgs(["--", "help"])).toEqual({ command: "help" });
  });
});

describe("helpText", () => {
  it("describes the local URL policy without stale version labels", () => {
    expect(helpText()).toContain("Audit targets must be local http(s) URLs");
    expect(helpText()).not.toContain("v0.3");
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

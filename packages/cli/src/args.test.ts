import { describe, expect, it } from "vitest";
import { parseArgs } from "./args.js";
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

describe("assertLocalHttpUrl", () => {
  it("accepts localhost URLs", () => {
    expect(assertLocalHttpUrl("http://localhost:3000")).toBe("http://localhost:3000/");
  });

  it("rejects remote URLs", () => {
    expect(() => assertLocalHttpUrl("https://example.com")).toThrow("only audits local");
  });
});

import { readFileSync } from "node:fs";
import type { FontFamilyAdherencePolicy } from "@design-harness/core";
import { describe, expect, it } from "vitest";
import {
  FontFamilyParseError,
  MAX_FONT_FAMILY_DIAGNOSTIC_SCALARS,
  fontFamilyDiagnosticValue,
  parseFontFamilyList,
  unexpectedFontFamilies
} from "./font-family.js";

const policy: FontFamilyAdherencePolicy = {
  policyId: "font-family-adherence-v1",
  allowedFamilies: [
    { value: "Inter", kind: "named" },
    { value: "Noto Sans KR", kind: "named" },
    { value: "한국어 글꼴", kind: "named" },
    { value: "sans-serif", kind: "generic" },
    { value: "system-ui", kind: "generic" },
    { value: "generic(kai)", kind: "generic" }
  ],
  ignoreSelectors: []
};

describe("parseFontFamilyList", () => {
  it.each([
    ["Inter, sans-serif", [
      { value: "Inter", kind: "named" },
      { value: "sans-serif", kind: "generic" }
    ]],
    ["\"Noto Sans KR\", sans-serif", [
      { value: "Noto Sans KR", kind: "named" },
      { value: "sans-serif", kind: "generic" }
    ]],
    ["'ACME, UI', system-ui", [
      { value: "ACME, UI", kind: "named" },
      { value: "system-ui", kind: "generic" }
    ]],
    ["\"A\\\"B\\\\C\", serif", [
      { value: "A\"B\\C", kind: "named" },
      { value: "serif", kind: "generic" }
    ]],
    ["'A\\'B\\\\C', serif", [
      { value: "A'B\\C", kind: "named" },
      { value: "serif", kind: "generic" }
    ]],
    ["N\\6f to, \\000073ans-serif", [
      { value: "Noto", kind: "named" },
      { value: "sans-serif", kind: "generic" }
    ]],
    ["  Noto\f  Sans\tKR  ,\r\n  sans-serif  ", [
      { value: "Noto Sans KR", kind: "named" },
      { value: "sans-serif", kind: "generic" }
    ]],
    ["INTER, SANS-SERIF", [
      { value: "INTER", kind: "named" },
      { value: "SANS-SERIF", kind: "generic" }
    ]],
    ["한국어 글꼴, sans-serif", [
      { value: "한국어 글꼴", kind: "named" },
      { value: "sans-serif", kind: "generic" }
    ]],
    ["École, école, Ωμέγα, ωμέγα", [
      { value: "École", kind: "named" },
      { value: "école", kind: "named" },
      { value: "Ωμέγα", kind: "named" },
      { value: "ωμέγα", kind: "named" }
    ]],
    ["Inter, Inter, sans-serif", [
      { value: "Inter", kind: "named" },
      { value: "Inter", kind: "named" },
      { value: "sans-serif", kind: "generic" }
    ]],
    ["ACME\\,UI, serif", [
      { value: "ACME,UI", kind: "named" },
      { value: "serif", kind: "generic" }
    ]],
    ["ACME\\ UI, A\\#B", [
      { value: "ACME UI", kind: "named" },
      { value: "A#B", kind: "named" }
    ]]
  ] as const)("decodes valid computed serialization %j", (raw, expected) => {
    expect(parseFontFamilyList(raw)).toEqual(expected);
  });

  it("classifies every supported simple and functional generic", () => {
    const generics = [
      "serif",
      "sans-serif",
      "system-ui",
      "cursive",
      "fantasy",
      "math",
      "monospace",
      "ui-serif",
      "ui-sans-serif",
      "ui-monospace",
      "ui-rounded",
      "generic(fangsong)",
      "generic(kai)",
      "generic(khmer-mul)",
      "generic(nastaliq)"
    ];

    expect(parseFontFamilyList(generics.join(", "))).toEqual(
      generics.map((value) => ({ value, kind: "generic" }))
    );
    expect(parseFontFamilyList("GENERIC( KAI )")).toEqual([
      { value: "GENERIC(KAI)", kind: "generic" }
    ]);
  });

  it.each([
    ["\\7 Z", "\u0007Z"],
    ["\\41 Z", "AZ"],
    ["\\041 Z", "AZ"],
    ["\\0041 Z", "AZ"],
    ["\\00041 Z", "AZ"],
    ["\\000041Z", "AZ"],
    ["\"\\41\r\nB\"", "AB"]
  ])("decodes CSS hexadecimal escape length and terminator in %j", (raw, value) => {
    expect(parseFontFamilyList(raw)).toEqual([{ value, kind: "named" }]);
  });

  it("keeps quoted generic spellings as named families", () => {
    expect(parseFontFamilyList("\"serif\", serif, 'generic(kai)', generic(kai)")).toEqual([
      { value: "serif", kind: "named" },
      { value: "serif", kind: "generic" },
      { value: "generic(kai)", kind: "named" },
      { value: "generic(kai)", kind: "generic" }
    ]);
  });

  it.each([
    ["", "empty-list"],
    [" \t\n", "empty-list"],
    [", Inter", "empty-member"],
    ["Inter,", "empty-member"],
    ["Inter,, serif", "empty-member"],
    ["Inter, , serif", "empty-member"],
    ["\"Inter", "unterminated-string"],
    ["'Inter", "unterminated-string"],
    ["Inter\\", "dangling-escape"],
    ["\"Inter\\", "dangling-escape"],
    ["Inter\\\nUI", "newline-escape"],
    ["\"Inter\\\rUI\"", "newline-escape"],
    ["\"\"", "empty-family"],
    ["''", "empty-family"],
    [".Inter", "invalid-token"],
    ["Inter/Arial", "invalid-token"],
    ["Inter#UI", "invalid-token"],
    ["calc(Inter)", "unsupported-function"],
    ["generic(foo)", "unsupported-function"],
    ["generic()", "unsupported-function"],
    ["generic(kai, serif)", "unsupported-function"],
    ["generic(kai) extra", "invalid-token"],
    ["generic (kai)", "invalid-token"],
    ["Inter Arial()", "unsupported-function"]
  ] as const)("rejects invalid serialization %j as %s", (raw, code) => {
    expect(() => parseFontFamilyList(raw)).toThrow(FontFamilyParseError);
    try {
      parseFontFamilyList(raw);
    } catch (error) {
      expect(error).toMatchObject({ code });
      expect((error as FontFamilyParseError).index).toBeGreaterThanOrEqual(0);
      if (raw.length > 0) {
        expect((error as Error).message).not.toContain(raw);
      }
    }
  });

  it("does not normalize canonically equivalent names", () => {
    expect(parseFontFamilyList("Å, A\\30a ")).toEqual([
      { value: "Å", kind: "named" },
      { value: "Å", kind: "named" }
    ]);
  });
});

describe("unexpectedFontFamilies", () => {
  it("passes only when every decoded member is approved", () => {
    expect(unexpectedFontFamilies("Inter, sans-serif", policy)).toEqual([]);
    expect(unexpectedFontFamilies("Inter, Papyrus, sans-serif", policy)).toEqual([
      { value: "Papyrus", kind: "named" }
    ]);
  });

  it("uses ASCII-only case folding and retains unexpected spelling", () => {
    expect(unexpectedFontFamilies("INTER, SANS-SERIF, GENERIC(KAI)", policy)).toEqual([]);
    expect(unexpectedFontFamilies("École, école, Ωμέγα, ωμέγα", {
      ...policy,
      allowedFamilies: [
        { value: "École", kind: "named" },
        { value: "Ωμέγα", kind: "named" }
      ]
    })).toEqual([
      { value: "école", kind: "named" },
      { value: "ωμέγα", kind: "named" }
    ]);
  });

  it("does not require approved fallbacks or a particular order", () => {
    expect(unexpectedFontFamilies("system-ui, Inter", policy)).toEqual([]);
    expect(unexpectedFontFamilies("Inter", policy)).toEqual([]);
  });

  it("keeps generic and named identities distinct", () => {
    expect(unexpectedFontFamilies("\"sans-serif\", sans-serif", policy)).toEqual([
      { value: "sans-serif", kind: "named" }
    ]);
  });

  it("retains duplicate unexpected members for caller-owned grouping", () => {
    expect(unexpectedFontFamilies("Papyrus, Papyrus", policy)).toEqual([
      { value: "Papyrus", kind: "named" },
      { value: "Papyrus", kind: "named" }
    ]);
  });

  it("does not merge decomposed and precomposed names", () => {
    expect(unexpectedFontFamilies("Å, A\\30a ", {
      ...policy,
      allowedFamilies: [{ value: "Å", kind: "named" }]
    })).toEqual([{ value: "Å", kind: "named" }]);
  });
});

describe("fontFamilyDiagnosticValue", () => {
  it("escapes controls, bidirectional formatting, and literal backslashes", () => {
    expect(fontFamilyDiagnosticValue("Browser\\Name\n\u202eTail")).toBe(
      "Browser\\\\Name\\u{000a}\\u{202e}Tail"
    );
  });

  it("is bounded by Unicode scalar count without splitting astral characters", () => {
    const value = "😀".repeat(MAX_FONT_FAMILY_DIAGNOSTIC_SCALARS + 20);
    const diagnostic = fontFamilyDiagnosticValue(value);
    expect([...diagnostic.slice(0, -1)]).toHaveLength(MAX_FONT_FAMILY_DIAGNOSTIC_SCALARS);
    expect(diagnostic.endsWith("…")).toBe(true);
  });

  it("keeps the parser and matcher free of locale or normalization machinery", () => {
    const source = readFileSync(new URL("./font-family.ts", import.meta.url), "utf8");
    expect(source).not.toContain(".normalize(");
    expect(source).not.toContain("Intl.Collator");
    expect(source).not.toContain("toLocaleLowerCase");
  });
});

import { describe, expect, it } from "vitest";
import {
  assertGuideTokenCeiling,
  compileDesignGuide,
  createExampleCopyStyle,
  createExampleDesignGuide,
  DESIGN_GUIDE_PROFILE_ID,
  estimateGuideTokens,
  GUIDE_CATALOG_VERSION,
  GUIDE_TOKEN_ESTIMATE_METHOD,
  GuideCompileError
} from "./index.js";

describe("pure guide compiler", () => {
  it("compiles the canonical guide and optional copy within the hard estimate ceiling", () => {
    for (const copyStyle of [undefined, createExampleCopyStyle()]) {
      const result = compileDesignGuide(createExampleDesignGuide(), copyStyle);
      expect(result.profileId).toBe(DESIGN_GUIDE_PROFILE_ID);
      expect(result.catalogVersion).toBe(GUIDE_CATALOG_VERSION);
      expect(result.sourceHash).toMatch(/^[a-f0-9]{64}$/u);
      expect(result.tokenEstimate).toEqual({
        method: GUIDE_TOKEN_ESTIMATE_METHOD,
        estimated: expect.any(Number)
      });
      expect(result.tokenEstimate.estimated).toBeLessThanOrEqual(2000);
      expect(result.designTokens.$extensions["dev.design-harness"]).toEqual({
        profile: result.profileId,
        catalogVersion: result.catalogVersion,
        sourceHash: result.sourceHash
      });
      expect(result.designTokensJson).toBe(`${JSON.stringify(result.designTokens, null, 2)}\n`);
      expect(result.markdown).not.toMatch(/timestamp|harnessVersion|process\.env|\/Users\//u);
      expect(result.rules.every((rule) => (
        rule.id && rule.name && rule.description && rule.badExample && rule.goodExample
      ))).toBe(true);
    }
  });

  it("is byte deterministic across repeats, key insertion order, and NFC-equivalent signatures", () => {
    const guide = createExampleDesignGuide();
    guide.signatureElement = "Caf\u0065\u0301 status rail";
    const first = compileDesignGuide(guide);

    for (let index = 0; index < 10; index += 1) {
      expect(compileDesignGuide(guide)).toEqual(first);
    }

    const reordered = reverseObjectOrder(guide);
    const composed = { ...reordered, signatureElement: "Caf\u00e9 status rail" };
    expect(compileDesignGuide(composed)).toEqual(first);
  });

  it("is byte deterministic across scoped copy declaration order and sorts by Unicode scalar value", () => {
    const copy = createExampleCopyStyle();
    copy.glossary = [
      { term: "balance", tier: "approved", surfaces: ["body"] },
      { term: "balance", tier: "approved", surfaces: ["marketing"] },
      { term: "\u{10000}", tier: "approved" },
      { term: "\ue000", tier: "approved" }
    ];
    copy.bannedPhrases = [
      { phrase: "act now", surfaces: ["body"] },
      { phrase: "act now", surfaces: ["marketing"] }
    ];
    copy.surfaceRegisters = undefined;
    const guide = createExampleDesignGuide();
    guide.prohibitions = ["generic-card-grid"];
    const first = compileDesignGuide(guide, copy);
    copy.glossary.reverse();
    copy.bannedPhrases.reverse();
    const reversed = compileDesignGuide(guide, copy);

    expect(reversed).toEqual(first);
    expect(first.markdown.indexOf("\ue000")).toBeLessThan(first.markdown.indexOf("\u{10000}"));
  });

  it("renders exact selected fingerprint ids and examples in stable catalog-id order", () => {
    const guide = createExampleDesignGuide();
    guide.prohibitions.reverse();
    const result = compileDesignGuide(guide);
    const fingerprintRules = result.rules.filter((rule) => guide.prohibitions.includes(rule.id));
    expect(fingerprintRules.map((rule) => rule.id)).toEqual([
      "decorative-gradient-without-purpose",
      "generic-card-grid",
      "uniform-visual-emphasis"
    ]);
    expect(fingerprintRules[1]).toMatchObject({
      badExample: "Place every item in an equal card.",
      goodExample: "Let task priority shape hierarchy and grouping."
    });
  });

  it("projects only safe copy fields and excludes adapter mapping and unsupported copy settings", () => {
    const copyStyle = createExampleCopyStyle();
    const guide = createExampleDesignGuide();
    guide.prohibitions = ["generic-card-grid"];
    const result = compileDesignGuide(guide, copyStyle);
    expect(result.markdown).toContain("ko-KR");
    expect(result.markdown).toContain("haeyoche");
    expect(result.markdown).toContain("충전하기");
    expect(result.markdown).toContain("입금하기");
    expect(result.markdown).not.toContain("잔액");
    expect(result.markdown).toContain("빠르고 쉽습니다");
    expect(result.markdown).not.toContain("surfaceMapping");
    expect(result.markdown).not.toContain("web-dom");
    expect(result.markdown).not.toContain("a.btn");
    expect(result.markdown).not.toContain("josaHedgePolicy");
  });

  it("rejects duplicate and required-vs-banned copy declarations deterministically", () => {
    const duplicate = createExampleCopyStyle();
    duplicate.glossary = [
      { term: "Balance", tier: "approved" },
      { term: "balance", tier: "approved" }
    ];
    expectCompilePhase(() => compileDesignGuide(createExampleDesignGuide(), duplicate), "contradiction");

    const approvedBanned = createExampleCopyStyle();
    approvedBanned.glossary = [{ term: "Balance", tier: "approved", preferredTerm: "Funds" }];
    approvedBanned.bannedPhrases = [{ phrase: "balance" }];
    expectCompilePhase(() => compileDesignGuide(createExampleDesignGuide(), approvedBanned), "contradiction");

    const preferredBanned = createExampleCopyStyle();
    preferredBanned.glossary = [{ term: "Balance", tier: "use-carefully", preferredTerm: "Funds" }];
    preferredBanned.bannedPhrases = [{ phrase: "funds" }];
    expectCompilePhase(() => compileDesignGuide(createExampleDesignGuide(), preferredBanned), "contradiction");

    const replacementBanned = createExampleCopyStyle();
    replacementBanned.glossary = [{ term: "Legacy", tier: "banned", preferredTerm: "Modern" }];
    replacementBanned.bannedPhrases = [{ phrase: "modern" }];
    expectCompilePhase(() => compileDesignGuide(createExampleDesignGuide(), replacementBanned), "contradiction");

    const phraseReplacementBanned = createExampleCopyStyle();
    phraseReplacementBanned.glossary = [];
    phraseReplacementBanned.bannedPhrases = [
      { phrase: "Legacy flow", suggestedReplacement: "Modern flow" },
      { phrase: "modern flow" }
    ];
    expectCompilePhase(() => compileDesignGuide(createExampleDesignGuide(), phraseReplacementBanned), "contradiction");
  });

  it("preserves surface-scoped bans and permits disjoint copy declarations", () => {
    const copyStyle = createExampleCopyStyle();
    copyStyle.glossary = [
      { term: "Balance", tier: "approved", surfaces: ["body"] },
      { term: "balance", tier: "banned", preferredTerm: "Funds", surfaces: ["marketing"] }
    ];
    copyStyle.bannedPhrases = [{
      phrase: "Act now",
      suggestedReplacement: "Review details",
      surfaces: ["marketing"]
    }];

    const guide = createExampleDesignGuide();
    guide.prohibitions = ["generic-card-grid"];
    const result = compileDesignGuide(guide, copyStyle);
    expect(result.markdown).toContain("balance@marketing");
    expect(result.markdown).toContain("Act now@marketing");
  });

  it("rejects structural copy injection while encoding Markdown punctuation", () => {
    const unsafe = {
      schemaVersion: "0.2" as const,
      locale: "ko-KR",
      glossary: [{ term: "unsafe <!-- close", tier: "approved" as const }]
    };
    expectCompilePhase(() => compileDesignGuide(createExampleDesignGuide(), unsafe), "sanitize");

    const punctuation = {
      schemaVersion: "0.2" as const,
      locale: "ko-KR",
      glossary: [{ term: "`term` <value>", tier: "approved" as const }]
    };
    const result = compileDesignGuide(createExampleDesignGuide(), punctuation);
    expect(result.markdown).toContain("\\u0060term\\u0060 \\u003cvalue\\u003e");
    expect(result.markdown).not.toContain("`term`");

    for (const hidden of ["\u200c", "\u200d", "\u2028", "\u2029", "\u2060"]) {
      const hiddenCopy = {
        schemaVersion: "0.2" as const,
        locale: "ko-KR",
        glossary: [{ term: `unsafe${hidden}term`, tier: "approved" as const }]
      };
      expectCompilePhase(() => compileDesignGuide(createExampleDesignGuide(), hiddenCopy), "sanitize");
    }

    const loneSurrogateCopy = {
      schemaVersion: "0.2" as const,
      locale: "ko-KR",
      glossary: [{ term: "unsafe\ud800term", tier: "approved" as const }]
    };
    expectCompilePhase(() => compileDesignGuide(createExampleDesignGuide(), loneSurrogateCopy), "sanitize");
  });

  it("implements guide-token-estimate-v1 for ASCII, Korean, emoji, combining text, and CRLF", () => {
    for (const value of ["", "abc", "한국어", "🧭", "e\u0301", "a\r\nb"]) {
      const normalized = value.replace(/\r\n?/gu, "\n").normalize("NFC");
      expect(estimateGuideTokens(value)).toEqual({
        method: GUIDE_TOKEN_ESTIMATE_METHOD,
        estimated: Math.max(
          [...normalized].length,
          Math.ceil(new TextEncoder().encode(normalized).byteLength / 2)
        )
      });
    }
  });

  it("enforces only integer project ceilings within 1..2000", () => {
    const estimate = { method: GUIDE_TOKEN_ESTIMATE_METHOD, estimated: 100 };
    expect(() => assertGuideTokenCeiling(estimate, 100)).not.toThrow();
    expectCompilePhase(() => assertGuideTokenCeiling(estimate, 99), "budget");
    for (const ceiling of [0, 2001, -1, 1.5, Number.NaN]) {
      expectCompilePhase(() => assertGuideTokenCeiling(estimate, ceiling), "budget");
    }
  });
});

function reverseObjectOrder<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(reverseObjectOrder) as T;
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).reverse().map(([key, child]) => [key, reverseObjectOrder(child)])
    ) as T;
  }
  return value;
}

function expectCompilePhase(run: () => unknown, phase: string): void {
  try {
    run();
    throw new Error("Expected compilation to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(GuideCompileError);
    expect((error as GuideCompileError).phase).toBe(phase);
  }
}

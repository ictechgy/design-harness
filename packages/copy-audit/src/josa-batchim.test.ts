import { describe, expect, it } from "vitest";

import {
  josaBatchimMismatchFindings,
  type MorphologyToken,
  type MorphologyTokenAnalysis
} from "./josa-batchim.js";
import type { CopyInventory } from "./types.js";

const PAIRS = [
  { consonantNoun: "마을", vowelNoun: "사과", consonant: "은", vowel: "는" },
  { consonantNoun: "마을", vowelNoun: "사과", consonant: "이", vowel: "가" },
  { consonantNoun: "마을", vowelNoun: "사과", consonant: "을", vowel: "를" },
  { consonantNoun: "마을", vowelNoun: "사과", consonant: "과", vowel: "와" }
] as const;

describe("josaBatchimMismatchFindings", () => {
  it.each(PAIRS)(
    "flags only the opposite particle for $consonant/$vowel",
    ({ consonantNoun, vowelNoun, consonant, vowel }) => {
      expect(run(`${consonantNoun}${consonant}`, nounAndParticle(consonantNoun, consonant))).toEqual([]);
      expect(run(`${vowelNoun}${vowel}`, nounAndParticle(vowelNoun, vowel))).toEqual([]);

      const consonantMismatch = run(
        `${consonantNoun}${vowel}`,
        nounAndParticle(consonantNoun, vowel)
      );
      const vowelMismatch = run(
        `${vowelNoun}${consonant}`,
        nounAndParticle(vowelNoun, consonant)
      );
      expect(consonantMismatch).toHaveLength(1);
      expect(consonantMismatch[0]).toMatchObject({
        checkName: "josa-batchim-mismatch",
        criterionId: "content.josa.batchim-match",
        sourceRefs: ["krdict-korean-particle-final-consonant-patterns"],
        determinism: "heuristic",
        resultKind: "risk",
        confidence: "low",
        runtime: "static-dom",
        humanReviewRecommended: true,
        observed: {
          particle: { rawText: vowel, tokenText: vowel, tag: "JKO" },
          hasBatchim: true
        },
        expected: { particle: consonant }
      });
      expect(vowelMismatch).toHaveLength(1);
      expect(vowelMismatch[0]).toMatchObject({
        observed: {
          particle: { rawText: consonant, tokenText: consonant, tag: "JKO" },
          hasBatchim: false
        },
        expected: { particle: vowel }
      });
    }
  );

  it.each([
    {
      label: "particle without a J tag",
      text: "마을를",
      tokens: nounAndParticle("마을", "를", "NNG", "NNG")
    },
    {
      label: "non-noun predecessor",
      text: "먹는를",
      tokens: nounAndParticle("먹는", "를", "ETM")
    },
    {
      label: "token/raw mismatch",
      text: "마을를",
      tokens: [
        token("마을", 0, "NNG"),
        token("를", 1, "JKO")
      ]
    },
    {
      label: "digit final",
      text: "123를",
      tokens: nounAndParticle("123", "를", "NNG")
    },
    {
      label: "Latin final",
      text: "API를",
      tokens: nounAndParticle("API", "를", "NNG")
    },
    {
      label: "symbol final",
      text: "♥를",
      tokens: nounAndParticle("♥", "를", "NNG")
    },
    {
      label: "decomposed jamo",
      text: "가를",
      tokens: nounAndParticle("가", "를", "NNG")
    }
  ])("skips $label", ({ text, tokens }) => {
    expect(run(text, tokens)).toEqual([]);
  });

  it("skips truncated inventory nodes", () => {
    const inventory = makeInventory("마을를", { truncated: true });
    expect(josaBatchimMismatchFindings(inventory, [
      makeAnalysis(nounAndParticle("마을", "를"))
    ])).toEqual([]);
  });

  it("skips when more than one noun interpretation ends at the particle offset", () => {
    expect(run("마을를", [
      token("마을", 0, "NNG"),
      token("마을", 0, "NNP"),
      token("를", 2, "JKO")
    ])).toEqual([]);
  });

  it("locks the empirical strict controls", () => {
    expect(run("마을를", [
      token("마을", 0, "NNG"),
      token("르", 2, "NNG"),
      token("ᆯ", 2, "JKO")
    ])).toMatchObject([{
      observed: {
        particle: {
          rawText: "를",
          tokenText: "ᆯ",
          tag: "JKO"
        }
      }
    }]);
    expect(run("가을을", nounAndParticle("가을", "을"))).toEqual([]);
    expect(run("사과을", nounAndParticle("사과", "을", "NNG", "NNG"))).toEqual([]);
    expect(run("아이을", nounAndParticle("아이", "을", "NNG", "NNG"))).toEqual([]);
    expect(run("먹는를", nounAndParticle("먹는", "를", "ETM"))).toEqual([]);
  });

  it("keeps repeated occurrences distinct and stable without mutating frozen inputs", () => {
    const text = "마을를 마을를";
    const inventory = makeInventory(text);
    const tokens = Object.freeze([
      token("마을", 0, "NNG"),
      token("를", 2, "JKO"),
      token("마을", 4, "NNG"),
      token("를", 6, "JKO")
    ]);
    const analysis = Object.freeze([makeAnalysis(tokens)]);

    const first = josaBatchimMismatchFindings(inventory, analysis);
    const second = josaBatchimMismatchFindings(inventory, analysis);
    expect(first.map(({ id }) => id)).toEqual([
      "finding-desktop-josa-batchim-mismatch-0-2",
      "finding-desktop-josa-batchim-mismatch-0-6"
    ]);
    expect(second).toEqual(first);
    expect(Object.isFrozen(inventory[0]?.items[0])).toBe(true);
    expect(Object.isFrozen(tokens)).toBe(true);
  });
});

function run(text: string, tokens: readonly MorphologyToken[]) {
  return josaBatchimMismatchFindings(
    makeInventory(text),
    [makeAnalysis(tokens)]
  );
}

function makeInventory(
  text: string,
  overrides: { truncated?: true } = {}
): readonly CopyInventory[] {
  return Object.freeze([Object.freeze({
    viewport: "desktop",
    evidenceRef: "text-inventory-desktop",
    items: Object.freeze([Object.freeze({
      selector: "#copy",
      text,
      ...overrides
    })])
  })]);
}

function makeAnalysis(tokens: readonly MorphologyToken[]): MorphologyTokenAnalysis {
  return Object.freeze({
    inventoryIndex: 0,
    itemIndex: 0,
    tokens
  });
}

function nounAndParticle(
  noun: string,
  particle: string,
  nounTag = "NNG",
  particleTag = "JKO"
): readonly MorphologyToken[] {
  return Object.freeze([
    token(noun, 0, nounTag),
    token(particle, noun.length, particleTag)
  ]);
}

function token(
  str: string,
  position: number,
  tag: string
): MorphologyToken {
  return Object.freeze({
    str,
    position,
    length: str.length,
    tag
  });
}

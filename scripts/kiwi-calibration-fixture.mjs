import { josaBatchimMismatchFindings } from "../packages/copy-audit/dist/index.js";

export const kiwiCalibrationFixtureProvenance = Object.freeze({
  kind: "deterministic-injected-token-fixture",
  parserContract: "kiwi-nlp@0.23.0",
  modelProfile: "kiwi-v0.23.0-cong-core-control-v1",
  realModelLoaded: false
});

const TOKEN_CASES = Object.freeze([
  tokenCase("마을은", "마을", "은", "NNG", "JX"),
  tokenCase("사과는", "사과", "는", "NNG", "JX"),
  tokenCase("마을는", "마을", "는", "NNG", "JX"),
  tokenCase("마을이", "마을", "이", "NNG", "JKS"),
  tokenCase("사과가", "사과", "가", "NNG", "JKS"),
  tokenCase("마을가", "마을", "가", "NNG", "JKS"),
  tokenCase("가을을", "가을", "을", "NNG", "JKO"),
  tokenCase("사과를", "사과", "를", "NNG", "JKO"),
  tokenCase("마을를", "마을", "를", "NNG", "JKO"),
  tokenCase("마을과", "마을", "과", "NNG", "JC"),
  tokenCase("사과와", "사과", "와", "NNG", "JC"),
  tokenCase("마을와", "마을", "와", "NNG", "JC"),
  tokenCase("사과을", "사과", "을", "NNG", "NNG"),
  tokenCase("아이을", "아이", "을", "NNG", "NNG"),
  tokenCase("먹는를", "먹는", "를", "ETM", "JKO"),
  tokenCase("123를", "123", "를", "NNG", "JKO"),
  tokenCase("API를", "API", "를", "NNG", "JKO"),
  tokenCase("♥를", "♥", "를", "NNG", "JKO"),
  tokenCase("가를", "가", "를", "NNG", "JKO")
]);

export async function deterministicKiwiCalibrationAnalyzer(inventories) {
  const analyses = [];
  for (const [inventoryIndex, inventory] of inventories.entries()) {
    for (const [itemIndex, item] of inventory.items.entries()) {
      analyses.push({
        inventoryIndex,
        itemIndex,
        tokens: tokensForText(item.text)
      });
    }
  }
  return {
    findings: josaBatchimMismatchFindings(inventories, analyses),
    notices: []
  };
}

function tokensForText(text) {
  const matches = [];
  for (const candidate of TOKEN_CASES) {
    let offset = 0;
    while (offset <= text.length - candidate.text.length) {
      const index = text.indexOf(candidate.text, offset);
      if (index === -1) break;
      matches.push({
        index,
        tokens: candidate.tokens.map((token) => ({
          ...token,
          position: token.position + index
        }))
      });
      offset = index + candidate.text.length;
    }
  }
  return matches
    .sort((left, right) => left.index - right.index)
    .flatMap(({ tokens }) => tokens);
}

function tokenCase(text, noun, particle, nounTag, particleTag) {
  return Object.freeze({
    text,
    tokens: Object.freeze([
      Object.freeze({
        str: noun,
        position: 0,
        length: noun.length,
        tag: nounTag
      }),
      Object.freeze({
        str: particle,
        position: noun.length,
        length: particle.length,
        tag: particleTag
      })
    ])
  });
}

import {
  findingMetadataForCheck,
  type Finding
} from "@design-harness/core";

import type { CopyInventory } from "./types.js";

export const JOSA_BATCHIM_CHECK_NAME = "josa-batchim-mismatch";

export interface MorphologyToken {
  readonly str: string;
  readonly position: number;
  readonly length: number;
  readonly tag: string;
}

export interface MorphologyTokenAnalysis {
  readonly inventoryIndex: number;
  readonly itemIndex: number;
  readonly tokens: readonly MorphologyToken[];
}

interface ParticlePair {
  readonly consonant: string;
  readonly vowel: string;
}

const PARTICLE_PAIRS: readonly ParticlePair[] = Object.freeze([
  Object.freeze({ consonant: "은", vowel: "는" }),
  Object.freeze({ consonant: "이", vowel: "가" }),
  Object.freeze({ consonant: "을", vowel: "를" }),
  Object.freeze({ consonant: "과", vowel: "와" })
]);

const PARTICLE_PAIR_BY_MEMBER = new Map(
  PARTICLE_PAIRS.flatMap((pair) => [
    [pair.consonant, pair] as const,
    [pair.vowel, pair] as const
  ])
);
const NOUN_TAGS = new Set(["NNG", "NNP", "NNB", "NP", "NR"]);

export function josaBatchimMismatchFindings(
  inventories: readonly CopyInventory[],
  analyses: readonly MorphologyTokenAnalysis[]
): Finding[] {
  const metadata = findingMetadataForCheck(JOSA_BATCHIM_CHECK_NAME);
  if (!metadata) {
    throw new Error(`Missing criterion metadata for copy check: ${JOSA_BATCHIM_CHECK_NAME}`);
  }
  const findings: Finding[] = [];

  for (const analysis of analyses) {
    const inventory = inventories[analysis.inventoryIndex];
    const item = inventory?.items[analysis.itemIndex];
    if (!inventory || !item || item.truncated) {
      continue;
    }
    for (let tokenIndex = 0; tokenIndex < analysis.tokens.length; tokenIndex += 1) {
      const particle = analysis.tokens[tokenIndex];
      const rawParticle = particle && validTokenOffset(item.text, particle)
        ? item.text.slice(particle.position, particle.position + particle.length)
        : undefined;
      const pair = rawParticle ? PARTICLE_PAIR_BY_MEMBER.get(rawParticle) : undefined;
      if (
        !particle
        || !pair
        || !particle.tag.startsWith("J")
        || rawParticle === undefined
      ) {
        continue;
      }

      const nounCandidates = analysis.tokens
        .slice(0, tokenIndex)
        .filter((candidate) => (
          NOUN_TAGS.has(candidate.tag)
          && validTokenOffset(item.text, candidate)
          && candidate.position + candidate.length === particle.position
          && item.text.slice(candidate.position, candidate.position + candidate.length) === candidate.str
        ));
      if (nounCandidates.length !== 1) {
        continue;
      }
      const noun = nounCandidates[0];
      if (!noun) {
        continue;
      }

      const finalCodeUnit = item.text.charCodeAt(particle.position - 1);
      if (!isPrecomposedHangulSyllable(finalCodeUnit)) {
        continue;
      }
      const hasBatchim = (finalCodeUnit - 0xac00) % 28 !== 0;
      const expectedParticle = hasBatchim ? pair.consonant : pair.vowel;
      if (rawParticle === expectedParticle) {
        continue;
      }

      findings.push({
        id: findingId(inventory.viewport, analysis.itemIndex, particle.position),
        category: "content",
        severity: "low",
        viewport: inventory.viewport,
        selector: item.selector,
        ...(item.region ? { region: { ...item.region } } : {}),
        evidenceRefs: [inventory.evidenceRef],
        problem: `Kiwi morphology suggests that rendered copy in ${item.selector} uses a particle that does not match the preceding noun's final-consonant form.`,
        recommendation: `Review "${noun.str}${rawParticle}" and use "${expectedParticle}" if the analyzed noun and intended meaning are correct.`,
        checkName: JOSA_BATCHIM_CHECK_NAME,
        ...metadata,
        observed: {
          text: item.text,
          particlePair: [pair.consonant, pair.vowel],
          noun: {
            text: noun.str,
            tag: noun.tag,
            start: noun.position,
            end: noun.position + noun.length
          },
          particle: {
            rawText: rawParticle,
            tokenText: particle.str,
            tag: particle.tag,
            start: particle.position,
            end: particle.position + particle.length
          },
          hasBatchim
        },
        expected: {
          particle: expectedParticle,
          basis: "precomposed Hangul final-consonant presence after exact Kiwi token/raw-offset agreement"
        }
      });
    }
  }

  return findings;
}

function validTokenOffset(text: string, token: MorphologyToken): boolean {
  return Number.isInteger(token.position)
    && Number.isInteger(token.length)
    && token.position >= 0
    && token.length > 0
    && token.position + token.length <= text.length;
}

function isPrecomposedHangulSyllable(codeUnit: number): boolean {
  return codeUnit >= 0xac00 && codeUnit <= 0xd7a3;
}

function findingId(viewport: string, itemIndex: number, particleOffset: number): string {
  const normalizedViewport = viewport.replaceAll(/[^A-Za-z0-9_-]/g, "-");
  return `finding-${normalizedViewport}-${JOSA_BATCHIM_CHECK_NAME}-${itemIndex}-${particleOffset}`;
}

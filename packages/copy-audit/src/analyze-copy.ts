import {
  findingMetadataForCheck,
  type AuditNotice,
  type CopyStyle,
  type CopyStyleBannedPhrase,
  type CopyStyleGlossaryTerm,
  type Finding,
  type FindingObservation,
  type Severity
} from "@design-harness/core";

import type { CopyInventory, CopyTextNode } from "./types.js";

type CopyCheckName =
  | "placeholder-leak"
  | "josa-hedge"
  | "glossary-banned-term"
  | "glossary-use-carefully-term"
  | "banned-phrase";

type PlaceholderFamily = "mustache" | "icu" | "output-contract";

interface LocatedMatch {
  index: number;
  value: string;
}

interface MatchSummary {
  matches: string[];
  occurrenceCount: number;
}

const ASCII_WHITESPACE = "[ \\t\\n\\r\\f\\v]";
const MUSTACHE_VARIABLE = new RegExp(
  `(?<!\\{)\\{\\{${ASCII_WHITESPACE}*[A-Za-z_][A-Za-z0-9_.-]*${ASCII_WHITESPACE}*\\}\\}(?!\\})`,
  "g"
);
const ICU_COMPLEX_ARGUMENT = new RegExp(
  `(?<!\\{)\\{${ASCII_WHITESPACE}*[A-Za-z_][A-Za-z0-9_.-]*${ASCII_WHITESPACE}*,${ASCII_WHITESPACE}*(?:plural|select|selectordinal)${ASCII_WHITESPACE}*,`,
  "g"
);
const TODO_MARKER = /(?<![\p{L}\p{N}_])TODO(?![\p{L}\p{N}_])/gu;
const LOREM_IPSUM_MARKER = /(?<![\p{L}\p{N}_])lorem\s+ipsum(?![\p{L}\p{N}_])/giu;
const JOSA_HEDGES = ["을(를)", "이(가)"] as const;

const PLACEHOLDER_SOURCE: Record<PlaceholderFamily, string> = {
  mustache: "mustache-spec",
  icu: "unicode-icu-messageformat",
  "output-contract": "design-harness-output-contract"
};

const PLACEHOLDER_LABEL: Record<PlaceholderFamily, string> = {
  mustache: "Mustache variable",
  icu: "ICU complex argument",
  "output-contract": "fixture marker"
};

export function analyzeCopy(inventory: CopyInventory, copyStyle: CopyStyle): Finding[] {
  const findings: Finding[] = [];

  inventory.items.forEach((item, itemIndex) => {
    findings.push(...placeholderFindings(inventory, item, itemIndex));

    const josaFinding = josaHedgeFinding(inventory, item, itemIndex, copyStyle);
    if (josaFinding) {
      findings.push(josaFinding);
    }

    findings.push(...glossaryFindings(inventory, item, itemIndex, copyStyle));
    findings.push(...bannedPhraseFindings(inventory, item, itemIndex, copyStyle));
  });

  return findings;
}

export function copyAuditCapabilityNotices(copyStyle: CopyStyle): AuditNotice[] {
  const notices: AuditNotice[] = [];
  const seenTerms = new Set<string>();

  for (const [glossaryIndex, entry] of (copyStyle.glossary ?? []).entries()) {
    if (entry.match !== "lemma") {
      continue;
    }

    const normalizedTerm = normalizePattern(entry.term);
    if (!normalizedTerm || seenTerms.has(normalizedTerm)) {
      continue;
    }
    seenTerms.add(normalizedTerm);

    notices.push({
      code: "copy-analysis-capability-unavailable",
      message: `Glossary term "${entry.term}" requests lemma matching, which is unavailable in the parser-free copy analyzer.`,
      details: {
        capability: "glossary-lemma-matching",
        term: entry.term,
        glossaryIndex
      }
    });
  }

  return notices;
}

function placeholderFindings(
  inventory: CopyInventory,
  item: CopyTextNode,
  itemIndex: number
): Finding[] {
  const text = item.text.normalize("NFC");
  const families: Array<[PlaceholderFamily, LocatedMatch[]]> = [
    ["mustache", collectRegexMatches(text, MUSTACHE_VARIABLE)],
    ["icu", collectRegexMatches(text, ICU_COMPLEX_ARGUMENT)],
    [
      "output-contract",
      sortLocatedMatches([
        ...collectRegexMatches(text, TODO_MARKER),
        ...collectRegexMatches(text, LOREM_IPSUM_MARKER)
      ])
    ]
  ];

  return families.flatMap(([family, locatedMatches]) => {
    const summary = summarizeMatches(locatedMatches);
    if (summary.occurrenceCount === 0) {
      return [];
    }

    return [
      createCopyFinding({
        id: findingId(inventory.viewport, "placeholder-leak", itemIndex, family),
        inventory,
        item,
        checkName: "placeholder-leak",
        severity: "high",
        sourceRefs: [PLACEHOLDER_SOURCE[family]],
        problem: `Rendered copy in ${item.selector} exposes an unrendered ${PLACEHOLDER_LABEL[family]}.`,
        recommendation: "Render the intended localized or interpolated value before showing this copy.",
        observed: observedCopy(item, summary),
        expected: "Rendered copy contains no unresolved template or fixture markers."
      })
    ];
  });
}

function josaHedgeFinding(
  inventory: CopyInventory,
  item: CopyTextNode,
  itemIndex: number,
  copyStyle: CopyStyle
): Finding | undefined {
  if (copyStyle.josaHedgePolicy === "allow") {
    return undefined;
  }

  const text = item.text.normalize("NFC");
  const summary = summarizeMatches(
    sortLocatedMatches(JOSA_HEDGES.flatMap((hedge) => collectLiteralMatches(text, hedge)))
  );
  if (summary.occurrenceCount === 0) {
    return undefined;
  }

  return createCopyFinding({
    id: findingId(inventory.viewport, "josa-hedge", itemIndex, "configured-policy"),
    inventory,
    item,
    checkName: "josa-hedge",
    severity: "low",
    problem: `Rendered copy in ${item.selector} contains a parenthesized Korean particle hedge disallowed by the configured copy style.`,
    recommendation: "Resolve the particle for the rendered value, or set josaHedgePolicy to allow when the hedge is intentional.",
    observed: observedCopy(item, summary),
    expected: "Rendered copy follows the configured josa hedge policy."
  });
}

function glossaryFindings(
  inventory: CopyInventory,
  item: CopyTextNode,
  itemIndex: number,
  copyStyle: CopyStyle
): Finding[] {
  const normalizedText = normalizeText(item.text);
  const seen = new Set<string>();
  const findings: Finding[] = [];

  for (const [glossaryIndex, entry] of (copyStyle.glossary ?? []).entries()) {
    const checkName = glossaryCheckName(entry);
    if (!checkName || !appliesToSurface(entry.surfaces, item)) {
      continue;
    }

    const normalizedTerm = normalizePattern(entry.term);
    if (!normalizedTerm) {
      continue;
    }

    const dedupeKey = `${checkName}\u0000${normalizedTerm}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);

    if ((entry.match ?? "literal") !== "literal") {
      continue;
    }

    const occurrenceCount = countOccurrences(normalizedText, normalizedTerm);
    if (occurrenceCount === 0) {
      continue;
    }

    findings.push(createCopyFinding({
      id: findingId(inventory.viewport, checkName, itemIndex, `glossary-${glossaryIndex + 1}`),
      inventory,
      item,
      checkName,
      severity: checkName === "glossary-banned-term" ? "medium" : "low",
      problem: glossaryProblem(item, entry),
      recommendation: glossaryRecommendation(entry),
      observed: observedCopy(item, {
        matches: [normalizedTerm],
        occurrenceCount
      }),
      expected: "Rendered copy follows the configured glossary tier and preferred terminology."
    }));
  }

  return findings;
}

function bannedPhraseFindings(
  inventory: CopyInventory,
  item: CopyTextNode,
  itemIndex: number,
  copyStyle: CopyStyle
): Finding[] {
  const normalizedText = normalizeText(item.text);
  const seen = new Set<string>();
  const findings: Finding[] = [];

  for (const [phraseIndex, entry] of (copyStyle.bannedPhrases ?? []).entries()) {
    if (!appliesToSurface(entry.surfaces, item)) {
      continue;
    }

    const normalizedPhrase = normalizePattern(entry.phrase);
    if (!normalizedPhrase || seen.has(normalizedPhrase)) {
      continue;
    }
    seen.add(normalizedPhrase);

    const occurrenceCount = countOccurrences(normalizedText, normalizedPhrase);
    if (occurrenceCount === 0) {
      continue;
    }

    findings.push(createCopyFinding({
      id: findingId(inventory.viewport, "banned-phrase", itemIndex, `phrase-${phraseIndex + 1}`),
      inventory,
      item,
      checkName: "banned-phrase",
      severity: "medium",
      problem: `Rendered copy in ${item.selector} contains configured banned phrase "${entry.phrase}".`,
      recommendation: bannedPhraseRecommendation(entry),
      observed: observedCopy(item, {
        matches: [normalizedPhrase],
        occurrenceCount
      }),
      expected: "Rendered copy excludes configured banned phrases."
    }));
  }

  return findings;
}

function createCopyFinding(input: {
  id: string;
  inventory: CopyInventory;
  item: CopyTextNode;
  checkName: CopyCheckName;
  severity: Severity;
  sourceRefs?: string[];
  problem: string;
  recommendation: string;
  observed: FindingObservation;
  expected: FindingObservation;
}): Finding {
  const metadata = findingMetadataForCheck(input.checkName);
  if (!metadata) {
    throw new Error(`Missing criterion metadata for copy check: ${input.checkName}`);
  }

  return {
    id: input.id,
    category: "content",
    severity: input.severity,
    viewport: input.inventory.viewport,
    selector: input.item.selector,
    ...(input.item.region ? { region: { ...input.item.region } } : {}),
    evidenceRefs: [input.inventory.evidenceRef],
    problem: input.problem,
    recommendation: input.recommendation,
    checkName: input.checkName,
    ...metadata,
    ...(input.sourceRefs ? { sourceRefs: input.sourceRefs } : {}),
    observed: input.observed,
    expected: input.expected
  };
}

function observedCopy(item: CopyTextNode, summary: MatchSummary): Record<string, unknown> {
  return {
    text: item.text,
    matches: summary.matches,
    occurrenceCount: summary.occurrenceCount,
    ...(item.truncated ? { truncated: true } : {})
  };
}

function glossaryCheckName(entry: CopyStyleGlossaryTerm): CopyCheckName | undefined {
  if (entry.tier === "banned") {
    return "glossary-banned-term";
  }
  if (entry.tier === "use-carefully") {
    return "glossary-use-carefully-term";
  }
  return undefined;
}

function glossaryProblem(item: CopyTextNode, entry: CopyStyleGlossaryTerm): string {
  if (entry.tier === "banned") {
    return `Rendered copy in ${item.selector} contains configured banned glossary term "${entry.term}".`;
  }
  return `Rendered copy in ${item.selector} contains glossary term "${entry.term}" marked use-carefully.`;
}

function glossaryRecommendation(entry: CopyStyleGlossaryTerm): string {
  const action = entry.preferredTerm
    ? `Prefer the configured term "${entry.preferredTerm}" instead of "${entry.term}".`
    : entry.tier === "banned"
      ? `Replace "${entry.term}" with an approved project term.`
      : `Review whether "${entry.term}" is appropriate for this copy surface.`;
  return entry.note ? `${action} ${entry.note}` : action;
}

function bannedPhraseRecommendation(entry: CopyStyleBannedPhrase): string {
  const action = entry.suggestedReplacement
    ? `Replace "${entry.phrase}" with "${entry.suggestedReplacement}".`
    : `Rewrite "${entry.phrase}" using copy allowed by the project style.`;
  return entry.reason ? `${action} Reason: ${entry.reason}` : action;
}

function appliesToSurface(
  surfaces: readonly string[] | undefined,
  item: CopyTextNode
): boolean {
  return !surfaces || (item.copySurface !== undefined && surfaces.includes(item.copySurface.surface));
}

function normalizeText(value: string): string {
  return value.normalize("NFC").replace(/\s+/gu, " ");
}

function normalizePattern(value: string): string {
  return normalizeText(value).trim();
}

function countOccurrences(text: string, pattern: string): number {
  let count = 0;
  let offset = 0;
  while (offset <= text.length - pattern.length) {
    const index = text.indexOf(pattern, offset);
    if (index === -1) {
      break;
    }
    count += 1;
    offset = index + pattern.length;
  }
  return count;
}

function collectLiteralMatches(text: string, pattern: string): LocatedMatch[] {
  const matches: LocatedMatch[] = [];
  let offset = 0;
  while (offset <= text.length - pattern.length) {
    const index = text.indexOf(pattern, offset);
    if (index === -1) {
      break;
    }
    matches.push({ index, value: pattern });
    offset = index + pattern.length;
  }
  return matches;
}

function collectRegexMatches(text: string, expression: RegExp): LocatedMatch[] {
  expression.lastIndex = 0;
  return Array.from(text.matchAll(expression), (match) => ({
    index: match.index,
    value: match[0]
  }));
}

function sortLocatedMatches(matches: LocatedMatch[]): LocatedMatch[] {
  return matches.sort((left, right) => left.index - right.index);
}

function summarizeMatches(matches: LocatedMatch[]): MatchSummary {
  const unique = new Set<string>();
  for (const match of matches) {
    unique.add(match.value);
  }
  return {
    matches: [...unique],
    occurrenceCount: matches.length
  };
}

function findingId(
  viewport: string,
  checkName: CopyCheckName,
  itemIndex: number,
  identity: string
): string {
  return `finding-${viewport}-copy-${checkName}-${itemIndex + 1}-${identity}`;
}

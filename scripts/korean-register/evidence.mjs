import {
  exactKeys,
  LABELS,
  LIMITATIONS,
  OBSERVED_SOURCE_ROWS,
  REFERENCE_COUNT
} from "./contract.mjs";

export const EVIDENCE_BUCKETS = Object.freeze([
  "single-terminal-ef",
  "multiple-ef",
  "nonterminal-ef",
  "noun-form-fragment",
  "no-ef-other",
  "empty-analysis",
  "invalid-token-offset"
]);

const NOUN_FORM_TAGS = new Set([
  "NNG",
  "NNP",
  "NNB",
  "NP",
  "NR",
  "XR"
]);
const MAX_RECORDS = 1_200;
const MAX_CODE_UNITS_PER_RECORD = 2_000;
const MAX_TOTAL_CODE_UNITS = 200_000;
const MAX_TOKENS_PER_RECORD = 512;
const TERMINAL_SUFFIX_PATTERN =
  /^[\s.!?…。,，:;'"“”‘’()[\]{}~-]*$/u;

export function classifyRegisterEvidence(text, tokens) {
  if (
    typeof text !== "string"
    || !Array.isArray(tokens)
    || tokens.length > MAX_TOKENS_PER_RECORD
    || tokens.some((token) => !validTokenOffset(text, token))
  ) {
    return "invalid-token-offset";
  }
  if (tokens.length === 0) {
    return "empty-analysis";
  }
  const endings = tokens.filter(({ tag }) => tag.startsWith("EF"));
  if (endings.length > 1) {
    return "multiple-ef";
  }
  if (endings.length === 1) {
    const ending = endings[0];
    return TERMINAL_SUFFIX_PATTERN.test(
      text.slice(ending.position + ending.length)
    )
      ? "single-terminal-ef"
      : "nonterminal-ef";
  }
  const lexical = [...tokens]
    .reverse()
    .find(({ tag }) => !tag.startsWith("S"));
  return lexical && NOUN_FORM_TAGS.has(lexical.tag)
    ? "noun-form-fragment"
    : "no-ef-other";
}

export function aggregateRegisterEvidence(records, analyses) {
  assertInputLimits(records);
  if (!Array.isArray(analyses) || analyses.length !== records.length) {
    throw new Error("analyzer output must account for every reference");
  }
  const analysesByItem = new Map();
  for (const analysis of analyses) {
    const key = `${analysis?.inventoryIndex}:${analysis?.itemIndex}`;
    if (
      analysis?.inventoryIndex !== 0
      || !Number.isInteger(analysis?.itemIndex)
      || analysis.itemIndex < 0
      || analysis.itemIndex >= records.length
      || !Array.isArray(analysis.tokens)
      || analysesByItem.has(key)
    ) {
      throw new Error("analyzer output contains an invalid or duplicate coordinate");
    }
    analysesByItem.set(key, analysis.tokens);
  }

  const overallBuckets = emptyBuckets();
  const byLabel = Object.fromEntries(
    LABELS.map((label) => [
      label,
      { total: 0, buckets: emptyBuckets() }
    ])
  );
  let efTokenCount = 0;
  let zeroLengthTokenCount = 0;
  for (const [index, record] of records.entries()) {
    const tokens = analysesByItem.get(`0:${index}`);
    if (!tokens) {
      throw new Error(`analyzer output is missing reference ${index}`);
    }
    const bucket = classifyRegisterEvidence(record.text, tokens);
    overallBuckets[bucket] += 1;
    byLabel[record.label].total += 1;
    byLabel[record.label].buckets[bucket] += 1;
    efTokenCount += tokens.filter(
      (token) => typeof token?.tag === "string"
        && token.tag.startsWith("EF")
    ).length;
    zeroLengthTokenCount += tokens.filter(
      (token) => token?.length === 0
    ).length;
  }

  const accountedReferences = Object.values(overallBuckets)
    .reduce((sum, count) => sum + count, 0);
  if (
    records.length !== REFERENCE_COUNT
    || accountedReferences !== REFERENCE_COUNT
    || LABELS.some(
      (label) => byLabel[label].total !== OBSERVED_SOURCE_ROWS
    )
  ) {
    throw new Error("aggregate record accounting drifted");
  }
  return {
    totalReferences: records.length,
    accountedReferences,
    invalidTokenOffsetCount:
      overallBuckets["invalid-token-offset"],
    efTokenCount,
    zeroLengthTokenCount,
    overallBuckets,
    byLabel
  };
}

export function makeInventory(records) {
  assertInputLimits(records);
  return {
    viewport: "korean-register-evidence",
    evidenceRef: "iwslt2023-en-ko-formality-test",
    items: records.map((record, index) => ({
      selector: `#${record.label}-${String(index + 1).padStart(4, "0")}`,
      text: record.text
    }))
  };
}

export function validateAggregateCounts(counts) {
  exactKeys(
    counts,
    [
      "accountedReferences",
      "byLabel",
      "efTokenCount",
      "invalidTokenOffsetCount",
      "overallBuckets",
      "totalReferences",
      "zeroLengthTokenCount"
    ],
    "aggregate counts"
  );
  exactKeys(counts.byLabel, LABELS, "aggregate labels");
  if (
    counts?.totalReferences !== REFERENCE_COUNT
    || counts?.accountedReferences !== REFERENCE_COUNT
    || counts?.invalidTokenOffsetCount !== 0
    || !Number.isInteger(counts?.efTokenCount)
    || counts.efTokenCount < 0
    || !Number.isInteger(counts?.zeroLengthTokenCount)
    || counts.zeroLengthTokenCount < 0
  ) {
    throw new Error("aggregate top-level counts are invalid");
  }
  exactBucketObject(counts.overallBuckets, "overall buckets");
  const overall = Object.values(counts.overallBuckets)
    .reduce((sum, count) => sum + count, 0);
  if (overall !== REFERENCE_COUNT) {
    throw new Error("overall evidence buckets do not account for every reference");
  }
  for (const label of LABELS) {
    const value = counts.byLabel?.[label];
    exactKeys(value, ["buckets", "total"], `${label} aggregate`);
    exactBucketObject(value?.buckets, `${label} buckets`);
    if (
      value?.total !== OBSERVED_SOURCE_ROWS
      || Object.values(value.buckets).reduce(
        (sum, count) => sum + count,
        0
      ) !== OBSERVED_SOURCE_ROWS
    ) {
      throw new Error(`${label} evidence buckets do not account for 597 references`);
    }
  }
}

export function validateLimitations(limitations) {
  if (JSON.stringify(limitations) !== JSON.stringify(LIMITATIONS)) {
    throw new Error("aggregate limitations drifted");
  }
}

function assertInputLimits(records) {
  if (!Array.isArray(records) || records.length > MAX_RECORDS) {
    throw new Error("calibration input exceeds the record cap");
  }
  let totalCodeUnits = 0;
  for (const record of records) {
    if (
      !LABELS.includes(record?.label)
      || typeof record?.text !== "string"
      || record.text.length > MAX_CODE_UNITS_PER_RECORD
    ) {
      throw new Error("calibration input record is invalid or exceeds its cap");
    }
    totalCodeUnits += record.text.length;
    if (totalCodeUnits > MAX_TOTAL_CODE_UNITS) {
      throw new Error("calibration input exceeds the total code-unit cap");
    }
  }
}

function validTokenOffset(text, token) {
  return (
    token
    && typeof token.str === "string"
    && typeof token.tag === "string"
    && token.tag.length > 0
    && Number.isInteger(token.position)
    && token.position >= 0
    && Number.isInteger(token.length)
    && token.length >= 0
    && token.position + token.length <= text.length
  );
}

function emptyBuckets() {
  return Object.fromEntries(EVIDENCE_BUCKETS.map((bucket) => [bucket, 0]));
}

function exactBucketObject(value, label) {
  if (
    !value
    || JSON.stringify(Object.keys(value)) !==
      JSON.stringify(EVIDENCE_BUCKETS)
    || Object.values(value).some(
      (count) => !Number.isInteger(count) || count < 0
    )
  ) {
    throw new Error(`${label} are invalid`);
  }
}

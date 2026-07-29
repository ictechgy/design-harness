#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  DATASET_ROOT,
  OBSERVED_SOURCE_ROWS,
  readJsonLines
} from "./contract.mjs";
import {
  aggregateRegisterEvidence,
  classifyRegisterEvidence,
  makeInventory
} from "./evidence.mjs";
import { runRepeatedCalibration } from "./run-lib.mjs";
import { stripBalancedAnnotations } from "./validate-lib.mjs";

const controls = await readJsonLines(
  join(
    DATASET_ROOT,
    "apache-2.0-synthetic",
    "controls.jsonl"
  )
);
for (const control of controls) {
  assert.equal(
    classifyRegisterEvidence(control.text, control.tokens),
    control.expectedBucket,
    control.id
  );
}
assert.equal(
  classifyRegisterEvidence("가요.", [{
    str: "요",
    position: 99,
    length: 1,
    tag: "EF"
  }]),
  "invalid-token-offset"
);
assert.equal(classifyRegisterEvidence("...", []), "empty-analysis");
assert.equal(
  classifyRegisterEvidence("가요.", [
    { str: "이", position: 1, length: 0, tag: "VCP" },
    { str: "요", position: 1, length: 1, tag: "EF" },
    { str: ".", position: 2, length: 1, tag: "SF" }
  ]),
  "single-terminal-ef"
);
assert.equal(
  classifyRegisterEvidence(
    "가",
    Array.from({ length: 513 }, () => ({
      str: "가",
      position: 0,
      length: 1,
      tag: "NNG"
    }))
  ),
  "invalid-token-offset"
);
assert.equal(
  stripBalancedAnnotations("앞 [F]표지[/F] 뒤"),
  "앞 표지 뒤"
);
assert.throws(
  () => stripBalancedAnnotations("[F]열림"),
  /unbalanced opening/
);
assert.throws(
  () => stripBalancedAnnotations("[/F]닫힘"),
  /unbalanced closing/
);
assert.throws(
  () => stripBalancedAnnotations("[F]중첩 [F]금지[/F][/F]"),
  /nested/
);

const records = [
  ...Array.from(
    { length: OBSERVED_SOURCE_ROWS },
    (_, index) => ({
      id: `formal-${index + 1}`,
      label: "formal",
      text: "가요."
    })
  ),
  ...Array.from(
    { length: OBSERVED_SOURCE_ROWS },
    (_, index) => ({
      id: `informal-${index + 1}`,
      label: "informal",
      text: "왔어."
    })
  )
];
const analyses = analysesFor(records);
const aggregate = aggregateRegisterEvidence(records, analyses);
assert.equal(aggregate.accountedReferences, records.length);
assert.equal(
  aggregate.overallBuckets["single-terminal-ef"],
  records.length
);
assert.equal(aggregate.zeroLengthTokenCount, 0);
assert.throws(
  () => aggregateRegisterEvidence(records, analyses.slice(1)),
  /account for every reference/
);
assert.throws(
  () => aggregateRegisterEvidence(records, [
    ...analyses.slice(0, -1),
    analyses[0]
  ]),
  /invalid or duplicate coordinate/
);
assert.throws(
  () => makeInventory([
    ...records,
    ...Array.from({ length: 7 }, (_, index) => ({
      id: `extra-${index}`,
      label: "formal",
      text: "가요."
    }))
  ]),
  /record cap/
);

let completedWorkers = 0;
const repeated = await runRepeatedCalibration({
  records,
  projectionSha256: "1".repeat(64),
  analyzer: {
    kiwiNlpVersion: "0.23.0",
    modelVersion: "0.23.0",
    modelType: "cong",
    modelProfileSha256: "2".repeat(64),
    modelBytes: 93_885_643,
    nodeVersion: process.version
  },
  analyzeRun: async () => {
    try {
      return analyses;
    } finally {
      completedWorkers += 1;
    }
  }
});
assert.equal(completedWorkers, 3);
assert.equal(repeated.aggregate.counts.totalReferences, records.length);
assert.match(repeated.aggregateSha256, /^[a-f0-9]{64}$/);

await assert.rejects(
  runRepeatedCalibration({
    records,
    projectionSha256: "1".repeat(64),
    analyzer: repeated.aggregate.analyzer,
    analyzeRun: async () => {
      throw Object.assign(new Error("timeout"), {
        code: "kiwi-worker-analysis-timeout"
      });
    }
  }),
  /kiwi-worker-analysis-timeout/
);
await assert.rejects(
  runRepeatedCalibration({
    records,
    projectionSha256: "1".repeat(64),
    analyzer: repeated.aggregate.analyzer,
    analyzeRun: async () => analyses.map((analysis, index) => (
      index === 0
        ? {
            ...analysis,
            tokens: [{
              str: "요",
              position: 99,
              length: 1,
              tag: "EF"
            }]
          }
        : analysis
    ))
  }),
  /invalid token offsets/
);
await assert.rejects(
  runRepeatedCalibration({
    records,
    projectionSha256: "1".repeat(64),
    analyzer: repeated.aggregate.analyzer,
    analyzeRun: async () => analyses.map((analysis, index) => (
      index === 0
        ? { ...analysis, tokens: [null] }
        : analysis
    ))
  }),
  /invalid token offsets/
);

const sourceRead = await readFile(
  join(DATASET_ROOT, "apache-2.0-synthetic", "controls.jsonl"),
  "utf8"
);
assert.doesNotMatch(sourceRead, /IWSLT2023\/data\/test/u);
console.log(
  "Korean register analyzer regressions passed: EF/non-EF, multiple endings, noun-form, offsets, caps, incomplete output, timeout, and three completed worker runs."
);

function analysesFor(values) {
  return values.map((record, itemIndex) => ({
    inventoryIndex: 0,
    itemIndex,
    tokens: record.label === "formal"
      ? [
          { str: "가", position: 0, length: 1, tag: "VV" },
          { str: "요", position: 1, length: 1, tag: "EF" },
          { str: ".", position: 2, length: 1, tag: "SF" }
        ]
      : [
          { str: "오", position: 0, length: 1, tag: "VV" },
          { str: "았", position: 0, length: 1, tag: "EP" },
          { str: "어", position: 1, length: 1, tag: "EF" },
          { str: ".", position: 2, length: 1, tag: "SF" }
        ]
  }));
}

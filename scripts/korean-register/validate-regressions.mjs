#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  cp,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DATASET_ROOT,
  OUTPUT_ROOT,
  canonicalJson
} from "./contract.mjs";
import {
  validateKoreanRegisterCalibration
} from "./validate-lib.mjs";

const temp = await mkdtemp(
  join(tmpdir(), "korean-register-regressions-")
);
try {
  await expectValid("unchanged");
  await expectInvalid(
    "upstream-commit",
    async ({ dataset }) => {
      const value = await readJson(join(dataset, "provenance.json"));
      value.upstream.commit = "0".repeat(40);
      await writeJson(join(dataset, "provenance.json"), value);
    },
    "provenance identity"
  );
  await expectInvalid(
    "license-byte",
    async ({ dataset }) => {
      const path = join(
        dataset,
        "cdla-sharing-1.0",
        "DATALICENSE"
      );
      await writeFile(path, `${await readFile(path, "utf8")}drift\n`);
    },
    "byte count or SHA-256"
  );
  await expectInvalid(
    "data-byte",
    async ({ dataset }) => {
      const path = join(
        dataset,
        "cdla-sharing-1.0",
        "iwslt2023-en-ko",
        "formality-control.test.en-ko.formal.ko"
      );
      const source = await readFile(path, "utf8");
      await writeFile(path, source.replace("여행", "기행"));
    },
    "byte count or SHA-256"
  );
  await expectInvalid(
    "row-count",
    async ({ dataset }) => {
      const path = join(
        dataset,
        "cdla-sharing-1.0",
        "iwslt2023-en-ko",
        "formality-control.test.en-ko.en"
      );
      const lines = (await readFile(path, "utf8")).split("\n");
      await writeFile(path, lines.slice(0, -2).join("\n") + "\n");
    },
    "byte count or SHA-256"
  );
  await expectInvalid(
    "project-register-remap",
    async ({ dataset }) => {
      const value = await readJson(join(dataset, "provenance.json"));
      value.labels = ["hapsyoche", "banmal"];
      value.projectRegisterMapping = "automatic";
      await writeJson(join(dataset, "provenance.json"), value);
    },
    "provenance identity"
  );
  await expectInvalid(
    "extra-data-path",
    async ({ dataset }) => {
      await writeFile(join(dataset, "unexpected.txt"), "unexpected\n");
    },
    "tree entries drifted"
  );
  await expectInvalid(
    "synthetic-bucket",
    async ({ dataset }) => {
      const path = join(
        dataset,
        "apache-2.0-synthetic",
        "controls.jsonl"
      );
      const lines = (await readFile(path, "utf8")).trimEnd().split("\n");
      const first = JSON.parse(lines[0]);
      first.expectedBucket = "noun-form-fragment";
      lines[0] = JSON.stringify(first);
      await writeFile(path, `${lines.join("\n")}\n`);
    },
    "synthetic control 1 drifted"
  );
  await expectInvalid(
    "aggregate-source-sentence",
    async ({ output }) => {
      await mutateAllAggregates(output, (value) => {
        value.source = "원문 문장";
      });
    },
    "aggregate keys must be exactly"
  );
  await expectInvalid(
    "aggregate-hangul",
    async ({ output }) => {
      await mutateAllAggregates(output, (value) => {
        value.dataset.name = "한국어 원문";
      });
    },
    "source sentence or raw token"
  );
  await expectInvalid(
    "aggregate-count",
    async ({ output }) => {
      await mutateAllAggregates(output, (value) => {
        value.counts.accountedReferences -= 1;
      });
    },
    "aggregate top-level counts"
  );
  await expectInvalid(
    "aggregate-extra-count",
    async ({ output }) => {
      await mutateAllAggregates(output, (value) => {
        value.counts.unexpected = 0;
      });
    },
    "aggregate counts keys must be exactly"
  );
  await expectInvalid(
    "run-byte-drift",
    async ({ output }) => {
      const path = join(output, "aggregate-run-3.json");
      await writeFile(path, `${await readFile(path, "utf8")} `);
    },
    "not byte-identical"
  );
  await expectInvalid(
    "status-real-model",
    async ({ output }) => {
      const value = await readJson(join(output, "status.json"));
      value.realModelLoaded = false;
      await writeJson(join(output, "status.json"), value);
    },
    "status.json drifted"
  );
  await expectInvalid(
    "readme-drift",
    async ({ output }) => {
      const path = join(output, "README.md");
      await writeFile(path, `${await readFile(path, "utf8")}drift\n`);
    },
    "deterministic rendering"
  );
  console.log(
    "Korean register validation regressions passed (14 fail-closed mutations plus unchanged control)."
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}

async function freshCopy(label) {
  const root = join(temp, label);
  const dataset = join(root, "dataset");
  const output = join(root, "output");
  await cp(DATASET_ROOT, dataset, { recursive: true });
  await cp(OUTPUT_ROOT, output, { recursive: true });
  return { dataset, output };
}

async function expectValid(label) {
  const roots = await freshCopy(label);
  await validateKoreanRegisterCalibration({
    datasetRoot: roots.dataset,
    outputRoot: roots.output
  });
}

async function expectInvalid(label, mutate, pattern) {
  const roots = await freshCopy(label);
  await mutate(roots);
  await assert.rejects(
    validateKoreanRegisterCalibration({
      datasetRoot: roots.dataset,
      outputRoot: roots.output
    }),
    new RegExp(escapePattern(pattern)),
    label
  );
}

async function mutateAllAggregates(output, mutate) {
  for (let run = 1; run <= 3; run += 1) {
    const path = join(output, `aggregate-run-${run}.json`);
    const value = await readJson(path);
    mutate(value);
    await writeJson(path, value);
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJson(path, value) {
  await writeFile(path, canonicalJson(value));
}

function escapePattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

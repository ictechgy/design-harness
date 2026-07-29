#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  EXPECTED_EXECUTION_COUNT,
  MATRIX,
  sha256
} from "./contract.mjs";
import { prepareRepeatedBenchmark } from "./prepare.mjs";

const tempParent = await mkdtemp(
  join(tmpdir(), "obedience-repeated-preparation-")
);
try {
  const destination = join(tempParent, "prepared");
  const { root, manifest } = await prepareRepeatedBenchmark(destination);
  assert.equal(manifest.providerExecution, "not-performed");
  assert.equal(manifest.matrixSize, EXPECTED_EXECUTION_COUNT);
  assert.equal(manifest.executions.length, EXPECTED_EXECUTION_COUNT);
  assert.equal(new Set(manifest.executions.map((entry) => entry.id)).size, 72);
  assert.deepStrictEqual(
    manifest.executions.map((entry) => entry.id).sort(),
    MATRIX.map((entry) => entry.id).sort()
  );

  const cellEntries = await readdir(join(root, "cells"), {
    withFileTypes: true
  });
  assert.equal(cellEntries.length, EXPECTED_EXECUTION_COUNT);
  assert(cellEntries.every((entry) => entry.isDirectory()));

  const operations = await readRequest(
    root,
    "operations-queue-r1-claude-haiku-inline"
  );
  const operationsRepeat = await readRequest(
    root,
    "operations-queue-r3-claude-haiku-inline"
  );
  const support = await readRequest(
    root,
    "support-triage-r1-claude-haiku-inline"
  );
  assert.equal(
    operations.inputHashes.fixtureSha256,
    operationsRepeat.inputHashes.fixtureSha256
  );
  assert.notEqual(
    operations.inputHashes.fixtureSha256,
    support.inputHashes.fixtureSha256
  );
  assert.equal(operations.delivery.instructionFile, "CLAUDE.md");
  assert.equal(operations.delivery.skillDirectory, null);

  const codexSkill = await readRequest(
    root,
    "support-triage-r2-codex-gpt-5-6-sol-skill"
  );
  assert.equal(codexSkill.delivery.instructionFile, null);
  assert.equal(
    codexSkill.delivery.skillDirectory,
    ".agents/skills/product-ui-designer"
  );
  assert.equal(
    sha256(
      await readFile(
        join(
          root,
          "cells",
          codexSkill.id,
          "delivery-stanza.md"
        )
      )
    ),
    codexSkill.inputHashes.deliveryStanzaSha256
  );

  const nonEmpty = join(tempParent, "non-empty");
  await mkdir(nonEmpty);
  await writeFile(join(nonEmpty, "sentinel"), "keep");
  await assert.rejects(
    prepareRepeatedBenchmark(nonEmpty),
    /must be empty/
  );
  assert.equal(await readFile(join(nonEmpty, "sentinel"), "utf8"), "keep");

  console.log(
    "Repeated obedience preparation regressions passed: 72 isolated Git/no-provider cells and delivery/hash boundaries validated."
  );
} finally {
  await rm(tempParent, { recursive: true, force: true });
}

async function readRequest(root, id) {
  return JSON.parse(
    await readFile(
      join(root, "cells", id, "request-metadata.json"),
      "utf8"
    )
  );
}

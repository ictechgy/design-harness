#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  cp,
  lstat,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  BENCHMARK_ROOT,
  readCommonInputs,
  sha256
} from "./contract.mjs";
import { publishStagedSnapshot } from "./import.mjs";
import { validatePublicSnapshot } from "./validate.mjs";

const temporaryRoot = await mkdtemp(
  join(tmpdir(), "obedience-v1-publication-regression-")
);

try {
  const destination = join(temporaryRoot, "public");
  const validStage = join(temporaryRoot, "valid-stage");
  await Promise.all([
    cp(BENCHMARK_ROOT, destination, { recursive: true }),
    cp(BENCHMARK_ROOT, validStage, { recursive: true })
  ]);
  const staleSource = join(
    destination,
    "final-sources",
    "stale-cell.html"
  );
  await writeFile(staleSource, "<!doctype html><title>stale</title>\n");

  const [roadmapSource, commonInputs] = await Promise.all([
    readFile(join(BENCHMARK_ROOT, "..", "..", "ROADMAP.md"), "utf8"),
    readCommonInputs()
  ]);
  await publishStagedSnapshot({
    stagingRoot: validStage,
    publicRoot: destination,
    roadmapSource,
    commonInputs,
    requireCompletion: true
  });
  await assert.rejects(
    lstat(staleSource),
    (error) => error?.code === "ENOENT",
    "atomic publication must prune stale final sources"
  );

  const [publishedResults, publishedReport] = await Promise.all([
    readFile(join(destination, "results.json"), "utf8"),
    readFile(join(destination, "report.md"), "utf8")
  ]);
  await validatePublicSnapshot({
    results: JSON.parse(publishedResults),
    benchmarkRoot: destination,
    reportSource: publishedReport,
    roadmapSource,
    commonInputs
  });

  const invalidStage = join(temporaryRoot, "invalid-stage");
  await cp(BENCHMARK_ROOT, invalidStage, { recursive: true });
  await writeFile(
    join(invalidStage, "report.md"),
    `${publishedReport}\nThis proves agents obey.\n`
  );
  const sentinel = join(destination, "publication-sentinel.txt");
  await writeFile(sentinel, "preserve existing destination\n");
  const beforeResultsSha256 = sha256(
    await readFile(join(destination, "results.json"))
  );

  await assert.rejects(
    publishStagedSnapshot({
      stagingRoot: invalidStage,
      publicRoot: destination,
      roadmapSource,
      commonInputs,
      requireCompletion: true
    })
  );
  assert.equal(
    await readFile(sentinel, "utf8"),
    "preserve existing destination\n",
    "invalid staging must not mutate the existing destination"
  );
  assert.equal(
    sha256(await readFile(join(destination, "results.json"))),
    beforeResultsSha256,
    "invalid staging must preserve the existing results bytes"
  );

  const rollbackStage = join(temporaryRoot, "rollback-stage");
  await cp(BENCHMARK_ROOT, rollbackStage, { recursive: true });
  let validationCalls = 0;
  await assert.rejects(
    publishStagedSnapshot({
      stagingRoot: rollbackStage,
      publicRoot: destination,
      roadmapSource,
      commonInputs,
      requireCompletion: true,
      async validateSnapshot(options) {
        validationCalls += 1;
        if (validationCalls === 2) {
          throw new Error("injected post-swap validation failure");
        }
        return validatePublicSnapshot(options);
      }
    }),
    /injected post-swap validation failure/
  );
  assert.equal(
    validationCalls,
    2,
    "rollback regression must fail during post-swap validation"
  );
  assert.equal(
    await readFile(sentinel, "utf8"),
    "preserve existing destination\n",
    "post-swap failure must restore the prior destination"
  );
  assert.equal(
    sha256(await readFile(join(destination, "results.json"))),
    beforeResultsSha256,
    "post-swap failure must restore the prior results bytes"
  );
  assert.equal(
    (await lstat(rollbackStage)).isDirectory(),
    true,
    "post-swap failure must recover the staged snapshot"
  );
  const [recoveredResults, recoveredReport] = await Promise.all([
    readFile(join(rollbackStage, "results.json"), "utf8"),
    readFile(join(rollbackStage, "report.md"), "utf8")
  ]);
  await validatePublicSnapshot({
    results: JSON.parse(recoveredResults),
    benchmarkRoot: rollbackStage,
    reportSource: recoveredReport,
    roadmapSource,
    commonInputs
  });

  console.log(
    "Validated atomic replacement, stale-source pruning, preflight preservation, and post-swap rollback."
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
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
import {
  BenchmarkValidationError,
  validatePublicSnapshot
} from "./validate.mjs";

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
  let invalidCaseIndex = 0;
  async function expectSnapshotReject(name, mutate, expectedIssues) {
    invalidCaseIndex += 1;
    const candidate = join(
      temporaryRoot,
      `invalid-tree-${String(invalidCaseIndex).padStart(2, "0")}`
    );
    await cp(BENCHMARK_ROOT, candidate, { recursive: true });
    await mutate(candidate);
    const [candidateResults, candidateReport] = await Promise.all([
      readFile(join(candidate, "results.json"), "utf8"),
      readFile(join(candidate, "report.md"), "utf8")
    ]);
    await assert.rejects(
      validatePublicSnapshot({
        results: JSON.parse(candidateResults),
        benchmarkRoot: candidate,
        reportSource: candidateReport,
        roadmapSource,
        commonInputs
      }),
      (error) =>
        error instanceof BenchmarkValidationError &&
        expectedIssues.every((expectedIssue) =>
          error.issues.some((issue) => issue.includes(expectedIssue))
        ),
      `${name}: malformed public snapshot unexpectedly passed`
    );
  }

  await expectSnapshotReject(
    "unexpected top-level file",
    (candidate) => writeFile(join(candidate, "extra.txt"), "unexpected\n"),
    ["unexpected public snapshot entry: extra.txt"]
  );
  await expectSnapshotReject(
    "top-level dotfile",
    (candidate) => writeFile(join(candidate, ".DS_Store"), "unexpected\n"),
    ["unexpected public snapshot entry: .DS_Store"]
  );
  await expectSnapshotReject(
    "top-level symlink",
    async (candidate) => {
      const path = join(candidate, "common-task.md");
      await rm(path);
      await symlink("fixture.html", path);
    },
    ["public snapshot entry common-task.md must be a regular file"]
  );
  await expectSnapshotReject(
    "missing top-level input",
    (candidate) => rm(join(candidate, "protocol.md")),
    ["missing public snapshot entry: protocol.md"]
  );
  await expectSnapshotReject(
    "final-source dotfile",
    (candidate) =>
      writeFile(
        join(candidate, "final-sources", ".hidden.html"),
        "<!doctype html>\n"
      ),
    ["unexpected public final source: final-sources/.hidden.html"]
  );
  await expectSnapshotReject(
    "final-source symlink",
    async (candidate) => {
      const path = join(
        candidate,
        "final-sources",
        "claude-haiku-inline.html"
      );
      await rm(path);
      await symlink("../fixture.html", path);
    },
    [
      "public final source final-sources/claude-haiku-inline.html must be a regular file"
    ]
  );
  await expectSnapshotReject(
    "final-source directory",
    async (candidate) => {
      const path = join(
        candidate,
        "final-sources",
        "claude-haiku-inline.html"
      );
      await rm(path);
      await mkdir(path);
    },
    [
      "public final source final-sources/claude-haiku-inline.html must be a regular file"
    ]
  );
  await expectSnapshotReject(
    "staged common-input drift",
    async (candidate) => {
      const path = join(candidate, "common-task.md");
      const source = await readFile(path);
      await writeFile(path, Buffer.concat([source, Buffer.from("drift\n")]));
    },
    [
      "staged common input common-task.md bytes differ from canonical input",
      "staged common input common-task.md hash differs from canonical input"
    ]
  );

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
    "Validated the closed public tree, canonical staged inputs, atomic replacement, stale-source pruning, preflight preservation, and post-swap rollback."
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

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

import { BENCHMARK_ROOT, V1_ROOT } from "./contract.mjs";
import { validateCompleteSnapshot } from "./results.mjs";

const temp = await mkdtemp(
  join(tmpdir(), "obedience-repeated-complete-regressions-")
);
try {
  await cp(V1_ROOT, join(temp, "obedience-v1"), {
    recursive: true
  });
  await expectValid("unchanged");
  await expectInvalid(
    "extra-public-entry",
    async (root) => {
      await writeFile(join(root, "partial-results.json"), "{}\n");
    },
    "unexpected"
  );
  await expectInvalid(
    "missing-execution",
    async (root) => {
      const results = await readJson(join(root, "results.json"));
      results.executions.pop();
      await writeJson(join(root, "results.json"), results);
    },
    "exactly 72 executions"
  );
  await expectInvalid(
    "final-source-drift",
    async (root) => {
      const path = join(
        root,
        "final-sources",
        "operations-queue-r1-claude-haiku-inline.html"
      );
      await writeFile(path, `${await readFile(path, "utf8")}\n`);
    },
    "final source hash drifted"
  );
  await expectInvalid(
    "report-drift",
    async (root) => {
      await writeFile(
        join(root, "report.md"),
        `${await readFile(join(root, "report.md"), "utf8")}drift\n`
      );
    },
    "deterministic rendering"
  );
  await expectInvalid(
    "status-drift",
    async (root) => {
      const status = await readJson(join(root, "status.json"));
      status.executionCount = 71;
      await writeJson(join(root, "status.json"), status);
    },
    "complete snapshot contract"
  );
  await expectInvalid(
    "aggregate-drift",
    async (root) => {
      const results = await readJson(join(root, "results.json"));
      results.aggregate.passedBothCellCount = 72;
      await writeJson(join(root, "results.json"), results);
    },
    "aggregate does not match"
  );
  await expectInvalid(
    "private-path",
    async (root) => {
      const results = await readJson(join(root, "results.json"));
      results.executions[0].executor.cliVersion =
        "/Users/private/secret";
      await writeJson(join(root, "results.json"), results);
    },
    "absolute private path"
  );
  await expectInvalid(
    "matrix-drift",
    async (root) => {
      const results = await readJson(join(root, "results.json"));
      results.executions[0].repeat = 2;
      await writeJson(join(root, "results.json"), results);
    },
    "repeat drifted"
  );
  await expectInvalid(
    "primary-count-drift",
    async (root) => {
      const results = await readJson(join(root, "results.json"));
      results.executions[0].primary.finalDeterministicFailureCount = 1;
      await writeJson(join(root, "results.json"), results);
    },
    "primary measurements do not replay"
  );
  await expectInvalid(
    "v1-pin-drift",
    async (root) => {
      const oracle = await readJson(
        join(root, "v1-preservation.json")
      );
      oracle.files["fixture.html"] = "0".repeat(64);
      await writeJson(join(root, "v1-preservation.json"), oracle);
    },
    "obedience-v1 byte drift"
  );
  await expectInvalid(
    "case-tree-extra",
    async (root) => {
      await writeFile(
        join(root, "cases", "support-triage", "extra.txt"),
        "unexpected"
      );
    },
    "support-triage must contain only"
  );
  console.log(
    "Repeated obedience complete snapshot regressions passed (11 fail-closed mutations plus unchanged control)."
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}

async function freshCopy(label) {
  const root = join(temp, label);
  await cp(BENCHMARK_ROOT, root, { recursive: true });
  return root;
}

async function expectValid(label) {
  await validateCompleteSnapshot({
    benchmarkRoot: await freshCopy(label)
  });
}

async function expectInvalid(label, mutate, expectedMessage) {
  const root = await freshCopy(label);
  await mutate(root);
  await assert.rejects(
    validateCompleteSnapshot({ benchmarkRoot: root }),
    (error) => {
      assert.match(
        error.message,
        new RegExp(escapePattern(expectedMessage))
      );
      return true;
    },
    label
  );
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function escapePattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

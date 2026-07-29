#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  cp,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { BENCHMARK_ROOT } from "./contract.mjs";
import { validatePreparationSnapshot } from "./validate.mjs";

const tempRoot = await mkdtemp(
  join(tmpdir(), "obedience-repeated-validation-")
);
try {
  await expectValid("unchanged snapshot", async (root) => {});
  await expectInvalid(
    "extra public entry",
    async (root) => writeFile(join(root, "partial-results.json"), "{}\n"),
    "unexpected entry"
  );
  await expectInvalid(
    "status execution count",
    async (root) => {
      const status = await readJson(join(root, "status.json"));
      status.executionCount = 71;
      await writeJson(join(root, "status.json"), status);
    },
    "executionCount"
  );
  await expectInvalid(
    "provider execution claim",
    async (root) => {
      const status = await readJson(join(root, "status.json"));
      status.providerExecution = "complete";
      await writeJson(join(root, "status.json"), status);
    },
    "providerExecution"
  );
  await expectInvalid(
    "v1 preservation hash",
    async (root) => {
      const oracle = await readJson(join(root, "v1-preservation.json"));
      oracle.files["fixture.html"] = "0".repeat(64);
      await writeJson(join(root, "v1-preservation.json"), oracle);
    },
    "obedience-v1 byte drift"
  );
  await expectInvalid(
    "case source swap",
    async (root) => {
      await cp(
        join(BENCHMARK_ROOT, "../obedience-v1/fixture.html"),
        join(root, "cases/support-triage/fixture.html")
      );
    },
    "distinct source hashes"
  );
  await expectInvalid(
    "malformed case oracle",
    async (root) => {
      const path = join(
        root,
        "cases/support-triage/preservation-oracle.json"
      );
      const oracle = await readJson(path);
      oracle.requiredFeatures[0].unknownConstraint = true;
      await writeJson(path, oracle);
    },
    "preservation oracle rejected"
  );
  await expectInvalid(
    "forbidden superiority claim",
    async (root) => {
      const path = join(root, "protocol.md");
      const protocol = await readFile(path, "utf8");
      await writeFile(
        path,
        `${protocol}\nThe best model is proven here.\n`
      );
    },
    "ranking"
  );
  console.log(
    "Repeated obedience validation regressions passed (7 fail-closed mutations plus unchanged control)."
  );
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

async function freshCopy(label) {
  const root = join(
    tempRoot,
    label.replaceAll(/[^a-z0-9]+/gi, "-").toLowerCase()
  );
  await cp(BENCHMARK_ROOT, root, { recursive: true });
  return root;
}

async function expectValid(label, mutate) {
  const root = await freshCopy(label);
  await mutate(root);
  await validatePreparationSnapshot({ benchmarkRoot: root });
}

async function expectInvalid(label, mutate, expectedMessage) {
  const root = await freshCopy(label);
  await mutate(root);
  await assert.rejects(
    validatePreparationSnapshot({ benchmarkRoot: root }),
    (error) => {
      assert.match(error.message, new RegExp(escapePattern(expectedMessage)));
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

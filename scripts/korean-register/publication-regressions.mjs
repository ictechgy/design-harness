#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  publishCalibrationOutput
} from "./publication.mjs";

const temp = await realpath(await mkdtemp(
  join(tmpdir(), "korean-register-publication-")
));
const files = {
  aggregateBytes: "aggregate\n",
  repeatability: { kind: "repeatability" },
  status: { kind: "status" },
  readme: "readme\n"
};
try {
  const normal = join(temp, "normal");
  await publishCalibrationOutput(normal, files);
  assert.deepEqual(
    (await readdir(normal)).sort(),
    [
      "README.md",
      "aggregate-run-1.json",
      "aggregate-run-2.json",
      "aggregate-run-3.json",
      "repeatability.json",
      "status.json"
    ]
  );
  assert.equal(
    await readFile(join(normal, "aggregate-run-2.json"), "utf8"),
    files.aggregateBytes
  );

  const raced = join(temp, "raced");
  await assert.rejects(
    publishCalibrationOutput(raced, files, {
      beforeReserve: async () => {
        await mkdir(raced);
      }
    }),
    { code: "EEXIST" }
  );
  assert.deepEqual(await readdir(raced), []);
  assert.deepEqual(
    (await readdir(temp))
      .filter((name) => name.includes("-stage-")),
    []
  );

  const existing = join(temp, "existing");
  await mkdir(existing);
  await assert.rejects(
    publishCalibrationOutput(existing, files),
    { code: "EEXIST" }
  );
  assert.deepEqual(await readdir(existing), []);
  console.log(
    "Korean register publication regressions passed: normal publish, late output race, existing target, and stage cleanup."
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}

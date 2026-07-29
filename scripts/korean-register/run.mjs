#!/usr/bin/env node

import {
  lstat
} from "node:fs/promises";
import { resolve } from "node:path";

import {
  KIWI_NLP_VERSION,
  runKiwiWorker,
  verifyKiwiModelDirectory
} from "../../packages/copy-audit/dist/index.js";

import {
  CALIBRATION_ID,
  OUTPUT_ROOT,
  REAL_RUN_COUNT,
  REFERENCE_COUNT,
  REPEATABILITY_SCHEMA_VERSION,
  STATUS_SCHEMA_VERSION
} from "./contract.mjs";
import { renderObservationReadme } from "./output.mjs";
import {
  publishCalibrationOutput
} from "./publication.mjs";
import {
  assertExpectedInputShape,
  runRepeatedCalibration
} from "./run-lib.mjs";
import { validateDatasetRoot } from "./validate-lib.mjs";

const options = parseArgs(process.argv.slice(2));
const outputRoot = resolve(options.out);
await assertAbsent(outputRoot);
const dataset = await validateDatasetRoot();
assertExpectedInputShape(dataset.records);
const profile = await verifyKiwiModelDirectory(options.modelDir);

const result = await runRepeatedCalibration({
  records: dataset.records,
  projectionSha256: dataset.projectionSha256,
  analyzer: {
    kiwiNlpVersion: KIWI_NLP_VERSION,
    modelVersion: profile.version,
    modelType: profile.modelType,
    modelProfileSha256: profile.profileSha256,
    modelBytes: profile.totalBytes,
    nodeVersion: process.version
  },
  analyzeRun: (inventory) => runKiwiWorker({
    profile,
    inventories: [inventory]
  })
});

const repeatability = {
  schemaVersion: REPEATABILITY_SCHEMA_VERSION,
  calibrationId: CALIBRATION_ID,
  runCount: REAL_RUN_COUNT,
  byteIdentical: true,
  aggregateSha256: result.aggregateSha256,
  runFiles: [1, 2, 3].map((run) => ({
    path: `aggregate-run-${run}.json`,
    sha256: result.aggregateSha256
  }))
};
const status = {
  schemaVersion: STATUS_SCHEMA_VERSION,
  calibrationId: CALIBRATION_ID,
  status: "complete",
  realModelLoaded: true,
  sourceRowCount:
    dataset.provenance.upstream.observedSourceRows,
  referenceCount: REFERENCE_COUNT,
  runCount: REAL_RUN_COUNT,
  byteIdentical: true,
  aggregateSha256: result.aggregateSha256,
  claimBoundary: "aggregate-evidence-only"
};
await publishCalibrationOutput(outputRoot, {
  aggregateBytes: result.aggregateBytes,
  repeatability,
  status,
  readme: renderObservationReadme(result.aggregate, repeatability)
});
console.log(JSON.stringify({
  status: "complete",
  output: outputRoot,
  references: REFERENCE_COUNT,
  runs: REAL_RUN_COUNT,
  aggregateSha256: result.aggregateSha256
}));

function parseArgs(args) {
  let modelDir;
  let out = OUTPUT_ROOT;
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!value) {
      throw new Error(usage());
    }
    if (flag === "--model-dir") {
      modelDir = value;
    } else if (flag === "--out") {
      out = value;
    } else {
      throw new Error(usage());
    }
  }
  if (!modelDir) {
    throw new Error(usage());
  }
  return { modelDir, out };
}

function usage() {
  return "Usage: node scripts/korean-register/run.mjs --model-dir <verified-kiwi-0.23.0-cong-directory> [--out <absent-output-directory>]";
}

async function assertAbsent(path) {
  try {
    await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return;
    }
    throw error;
  }
  throw new Error(`refusing to overwrite existing output directory: ${path}`);
}

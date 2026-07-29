import {
  AGGREGATE_SCHEMA_VERSION,
  CALIBRATION_ID,
  LABELS,
  LIMITATIONS,
  MODEL_PROFILE_ID,
  OBSERVED_SOURCE_ROWS,
  REAL_RUN_COUNT,
  REFERENCE_COUNT,
  SNAPSHOT_DATE,
  TASK_PAGE_DESCRIBED_SOURCE_ROWS,
  UPSTREAM_COMMIT,
  canonicalJson,
  sha256
} from "./contract.mjs";
import {
  aggregateRegisterEvidence,
  makeInventory
} from "./evidence.mjs";

export async function runRepeatedCalibration({
  records,
  projectionSha256,
  analyzer,
  analyzeRun
}) {
  const inventory = makeInventory(records);
  let canonicalAggregate;
  let aggregate;
  for (let run = 1; run <= REAL_RUN_COUNT; run += 1) {
    let analyses;
    try {
      analyses = await analyzeRun(inventory, run);
    } catch (error) {
      throw new Error(
        `real Kiwi calibration run ${run} failed: ${runtimeCode(error)}`,
        { cause: error }
      );
    }
    const counts = aggregateRegisterEvidence(records, analyses);
    if (counts.invalidTokenOffsetCount !== 0) {
      throw new Error(
        `real Kiwi calibration run ${run} produced invalid token offsets`
      );
    }
    const candidate = {
      schemaVersion: AGGREGATE_SCHEMA_VERSION,
      calibrationId: CALIBRATION_ID,
      snapshotDate: SNAPSHOT_DATE,
      status: "complete",
      dataset: {
        name: "IWSLT 2023 EN-KO formality test projection",
        upstreamCommit: UPSTREAM_COMMIT,
        license: "CDLA-Sharing-1.0",
        taskPageDescribedSourceRows:
          TASK_PAGE_DESCRIBED_SOURCE_ROWS,
        observedSourceRows: OBSERVED_SOURCE_ROWS,
        referenceCount: REFERENCE_COUNT,
        labels: [...LABELS],
        projectRegisterMapping: "none",
        projectionSha256
      },
      analyzer: {
        realModelLoaded: true,
        kiwiNlpVersion: analyzer.kiwiNlpVersion,
        modelVersion: analyzer.modelVersion,
        modelType: analyzer.modelType,
        modelProfileId: MODEL_PROFILE_ID,
        modelProfileSha256: analyzer.modelProfileSha256,
        modelBytes: analyzer.modelBytes,
        nodeVersion: analyzer.nodeVersion,
        runCount: REAL_RUN_COUNT
      },
      counts,
      limitations: [...LIMITATIONS]
    };
    const bytes = canonicalJson(candidate);
    if (
      canonicalAggregate !== undefined
      && bytes !== canonicalAggregate
    ) {
      throw new Error(
        `normalized real Kiwi aggregate drifted at run ${run}`
      );
    }
    canonicalAggregate = bytes;
    aggregate = candidate;
  }
  return {
    aggregate,
    aggregateBytes: canonicalAggregate,
    aggregateSha256: sha256(canonicalAggregate)
  };
}

export function assertExpectedInputShape(records) {
  if (
    records.length !== REFERENCE_COUNT
    || LABELS.some(
      (label) => records.filter((record) => record.label === label)
        .length !== OBSERVED_SOURCE_ROWS
    )
  ) {
    throw new Error("real calibration input does not match 597 x 2 references");
  }
}

function runtimeCode(error) {
  const code = error?.code;
  return typeof code === "string" && /^[a-z0-9-]+$/.test(code)
    ? code
    : error instanceof Error
      ? error.message
      : String(error);
}

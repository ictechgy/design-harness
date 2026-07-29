import {
  lstat,
  readFile,
  readdir
} from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  AGGREGATE_SCHEMA_VERSION,
  CALIBRATION_ID,
  DATASET_ROOT,
  DATA_FILES,
  LABELS,
  LIMITATIONS,
  MODEL_PROFILE_ID,
  OBSERVED_SOURCE_ROWS,
  OUTPUT_ROOT,
  PROVENANCE_SCHEMA_VERSION,
  REAL_RUN_COUNT,
  REFERENCE_COUNT,
  REPEATABILITY_SCHEMA_VERSION,
  SNAPSHOT_DATE,
  STATUS_SCHEMA_VERSION,
  TASK_PAGE_DESCRIBED_SOURCE_ROWS,
  UPSTREAM_COMMIT,
  aggregatePath,
  exactKeys,
  readJson,
  readJsonLines,
  readLines,
  sha256
} from "./contract.mjs";
import {
  EVIDENCE_BUCKETS,
  classifyRegisterEvidence,
  validateAggregateCounts,
  validateLimitations
} from "./evidence.mjs";
import { renderObservationReadme } from "./output.mjs";

const LICENSE_SHA256 =
  "a08ff57744857367fb51f27a06c9877818a102692db72fbe06aaadec4d76e5f3";
const UPSTREAM_README_SHA256 =
  "1c9e7088cd1461de93e2dad1f01aac8b4bb0ef437b4609f5a83f8fa1ced7456d";
const SYNTHETIC_LICENSE_SHA256 =
  "75e889332416fb5d6f3bd248c0c748f1e4e349d710b367645c0094eff50a376c";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const HANGUL_PATTERN = /[\uac00-\ud7a3]/u;

const EXPECTED_DATA_FILES = Object.freeze([
  Object.freeze({
    path: DATA_FILES.source,
    role: "source",
    bytes: 66_524,
    rows: OBSERVED_SOURCE_ROWS,
    sha256:
      "0eda38358ae22191a2234231939de009aab98ccfb0e836df2db45bf8c844ac9b"
  }),
  Object.freeze({
    path: DATA_FILES.formalAnnotated,
    role: "annotated-reference",
    label: "formal",
    bytes: 92_948,
    rows: OBSERVED_SOURCE_ROWS,
    sha256:
      "cf58b7b4c7fff4085517087f07245cab845a87c37833040c0def9a74e3f2fe32"
  }),
  Object.freeze({
    path: DATA_FILES.formalPlain,
    role: "plain-reference",
    label: "formal",
    bytes: 78_290,
    rows: OBSERVED_SOURCE_ROWS,
    sha256:
      "9b9fb5b5ce17420ba036302675148c7a090ec18e2db338d9cc1b81ae8463a49c"
  }),
  Object.freeze({
    path: DATA_FILES.informalAnnotated,
    role: "annotated-reference",
    label: "informal",
    bytes: 87_350,
    rows: OBSERVED_SOURCE_ROWS,
    sha256:
      "80a922aa78603d4f2b3504e38ac2d343edd0cbc16a343e959989668d8383b0ab"
  }),
  Object.freeze({
    path: DATA_FILES.informalPlain,
    role: "plain-reference",
    label: "informal",
    bytes: 72_671,
    rows: OBSERVED_SOURCE_ROWS,
    sha256:
      "0757d0f1de720829e02988eaae3f30e3ff9bc75925f47747b245f8fdb7974e43"
  })
]);

export async function validateKoreanRegisterCalibration({
  datasetRoot = DATASET_ROOT,
  outputRoot = OUTPUT_ROOT
} = {}) {
  const dataset = await validateDatasetRoot(datasetRoot);
  const output = await validateOutputRoot(outputRoot, dataset);
  return { dataset, output };
}

export async function validateDatasetRoot(root = DATASET_ROOT) {
  const resolvedRoot = resolve(root);
  await assertTree(resolvedRoot, {
    "README.md": "file",
    "apache-2.0-synthetic": "directory",
    "cdla-sharing-1.0": "directory",
    "provenance.json": "file"
  });
  await assertTree(join(resolvedRoot, "cdla-sharing-1.0"), {
    "CHANGES.md": "file",
    DATALICENSE: "file",
    "IWSLT2023-README.md": "file",
    "iwslt2023-en-ko": "directory"
  });
  await assertTree(
    join(resolvedRoot, "cdla-sharing-1.0", "iwslt2023-en-ko"),
    Object.fromEntries(
      EXPECTED_DATA_FILES.map(({ path }) => [
        path.split("/").at(-1),
        "file"
      ])
    )
  );
  await assertTree(join(resolvedRoot, "apache-2.0-synthetic"), {
    LICENSE: "file",
    "README.md": "file",
    "controls.jsonl": "file"
  });

  const provenance = await readJson(join(resolvedRoot, "provenance.json"));
  validateProvenance(provenance);
  await validateFile(
    join(resolvedRoot, provenance.license.path),
    provenance.license
  );
  await validateFile(
    join(resolvedRoot, provenance.upstreamReadme.path),
    provenance.upstreamReadme
  );
  if (
    provenance.license.sha256 !== LICENSE_SHA256
    || provenance.upstreamReadme.sha256 !== UPSTREAM_README_SHA256
    || sha256(
      await readFile(
        join(resolvedRoot, "apache-2.0-synthetic", "LICENSE")
      )
    ) !== SYNTHETIC_LICENSE_SHA256
  ) {
    throw new Error("license or upstream README digest drifted");
  }

  for (const spec of EXPECTED_DATA_FILES) {
    const recorded = provenance.files.find(
      ({ path }) => path === spec.path
    );
    if (JSON.stringify(recorded) !== JSON.stringify(spec)) {
      throw new Error(`${spec.path} provenance drifted`);
    }
    await validateFile(join(resolvedRoot, spec.path), spec);
  }

  const source = await readLines(join(resolvedRoot, DATA_FILES.source));
  const formalAnnotated = await readLines(
    join(resolvedRoot, DATA_FILES.formalAnnotated)
  );
  const formalPlain = await readLines(
    join(resolvedRoot, DATA_FILES.formalPlain)
  );
  const informalAnnotated = await readLines(
    join(resolvedRoot, DATA_FILES.informalAnnotated)
  );
  const informalPlain = await readLines(
    join(resolvedRoot, DATA_FILES.informalPlain)
  );
  for (const [label, rows] of [
    ["source", source],
    ["formal annotated", formalAnnotated],
    ["formal", formalPlain],
    ["informal annotated", informalAnnotated],
    ["informal", informalPlain]
  ]) {
    if (rows.length !== OBSERVED_SOURCE_ROWS) {
      throw new Error(`${label} rows must equal ${OBSERVED_SOURCE_ROWS}`);
    }
  }
  for (let index = 0; index < OBSERVED_SOURCE_ROWS; index += 1) {
    if (
      stripBalancedAnnotations(formalAnnotated[index]) !==
        formalPlain[index]
      || stripBalancedAnnotations(informalAnnotated[index]) !==
        informalPlain[index]
    ) {
      throw new Error(
        `balanced annotation stripping drifted at row ${index + 1}`
      );
    }
  }

  await validateSyntheticControls(resolvedRoot);
  const records = [
    ...formalPlain.map((text, index) => ({
      id: `formal-${String(index + 1).padStart(4, "0")}`,
      label: "formal",
      text
    })),
    ...informalPlain.map((text, index) => ({
      id: `informal-${String(index + 1).padStart(4, "0")}`,
      label: "informal",
      text
    }))
  ];
  const projectionSha256 = sha256(
    EXPECTED_DATA_FILES.map(
      ({ path, sha256: digest }) => `${path}\t${digest}`
    ).join("\n")
  );
  return {
    provenance,
    records,
    projectionSha256
  };
}

export async function validateOutputRoot(
  root = OUTPUT_ROOT,
  dataset
) {
  const resolvedRoot = resolve(root);
  await assertTree(resolvedRoot, {
    "README.md": "file",
    "aggregate-run-1.json": "file",
    "aggregate-run-2.json": "file",
    "aggregate-run-3.json": "file",
    "repeatability.json": "file",
    "status.json": "file"
  });
  const runBytes = await Promise.all(
    [1, 2, 3].map((run) => readFile(aggregatePath(resolvedRoot, run)))
  );
  if (
    !runBytes.slice(1).every(
      (value) => value.equals(runBytes[0])
    )
  ) {
    throw new Error("three normalized real-run aggregates are not byte-identical");
  }
  const aggregate = JSON.parse(runBytes[0].toString("utf8"));
  validateAggregate(aggregate, dataset);
  const aggregateSha256 = sha256(runBytes[0]);
  const repeatability = await readJson(
    join(resolvedRoot, "repeatability.json")
  );
  const expectedRepeatability = {
    schemaVersion: REPEATABILITY_SCHEMA_VERSION,
    calibrationId: CALIBRATION_ID,
    runCount: REAL_RUN_COUNT,
    byteIdentical: true,
    aggregateSha256,
    runFiles: [1, 2, 3].map((run) => ({
      path: `aggregate-run-${run}.json`,
      sha256: aggregateSha256
    }))
  };
  if (
    JSON.stringify(repeatability) !==
      JSON.stringify(expectedRepeatability)
  ) {
    throw new Error("repeatability.json drifted");
  }
  const status = await readJson(join(resolvedRoot, "status.json"));
  const expectedStatus = {
    schemaVersion: STATUS_SCHEMA_VERSION,
    calibrationId: CALIBRATION_ID,
    status: "complete",
    realModelLoaded: true,
    sourceRowCount: OBSERVED_SOURCE_ROWS,
    referenceCount: REFERENCE_COUNT,
    runCount: REAL_RUN_COUNT,
    byteIdentical: true,
    aggregateSha256,
    claimBoundary: "aggregate-evidence-only"
  };
  if (JSON.stringify(status) !== JSON.stringify(expectedStatus)) {
    throw new Error("status.json drifted");
  }
  const readme = await readFile(join(resolvedRoot, "README.md"), "utf8");
  if (readme !== renderObservationReadme(aggregate, repeatability)) {
    throw new Error("observation README does not match deterministic rendering");
  }
  return { aggregate, repeatability, status };
}

export function stripBalancedAnnotations(value) {
  let depth = 0;
  let output = "";
  for (let index = 0; index < value.length;) {
    if (value.startsWith("[F]", index)) {
      if (depth !== 0) {
        throw new Error("nested formality annotation is invalid");
      }
      depth = 1;
      index += 3;
      continue;
    }
    if (value.startsWith("[/F]", index)) {
      if (depth !== 1) {
        throw new Error("unbalanced closing formality annotation is invalid");
      }
      depth = 0;
      index += 4;
      continue;
    }
    output += value[index];
    index += 1;
  }
  if (depth !== 0) {
    throw new Error("unbalanced opening formality annotation is invalid");
  }
  return output;
}

function validateProvenance(value) {
  exactKeys(
    value,
    [
      "changedFilesNotice",
      "datasetId",
      "files",
      "labels",
      "license",
      "projectRegisterMapping",
      "schemaVersion",
      "upstream",
      "upstreamReadme"
    ],
    "provenance"
  );
  if (
    value.schemaVersion !== PROVENANCE_SCHEMA_VERSION
    || value.datasetId !== "iwslt2023-en-ko-formality-test-pinned"
    || value.upstream?.provider !== "Amazon Science"
    || value.upstream?.repository !==
      "https://github.com/amazon-science/contrastive-controlled-mt"
    || value.upstream?.commit !== UPSTREAM_COMMIT
    || value.upstream?.taskPage !== "https://iwslt.org/2023/formality"
    || value.upstream?.taskPageDescribedSourceRows !==
      TASK_PAGE_DESCRIBED_SOURCE_ROWS
    || value.upstream?.observedSourceRows !== OBSERVED_SOURCE_ROWS
    || value.upstream?.referenceCount !== REFERENCE_COUNT
    || JSON.stringify(value.labels) !== JSON.stringify(LABELS)
    || value.projectRegisterMapping !== "none"
    || value.changedFilesNotice !==
      "cdla-sharing-1.0/CHANGES.md"
    || value.license?.name !==
      "Community Data License Agreement - Sharing - Version 1.0"
    || value.license?.spdxLikeId !== "CDLA-Sharing-1.0"
    || value.license?.path !== "cdla-sharing-1.0/DATALICENSE"
    || value.license?.bytes !== 11_350
    || value.license?.sha256 !== LICENSE_SHA256
    || value.upstreamReadme?.path !==
      "cdla-sharing-1.0/IWSLT2023-README.md"
    || value.upstreamReadme?.bytes !== 5_048
    || value.upstreamReadme?.sha256 !== UPSTREAM_README_SHA256
    || !Array.isArray(value.files)
    || value.files.length !== EXPECTED_DATA_FILES.length
  ) {
    throw new Error("provenance identity, license, labels, or counts drifted");
  }
}

async function validateSyntheticControls(root) {
  const controls = await readJsonLines(
    join(
      root,
      "apache-2.0-synthetic",
      "controls.jsonl"
    )
  );
  if (controls.length !== 6) {
    throw new Error("synthetic controls must contain exactly six records");
  }
  const ids = new Set();
  for (const [index, control] of controls.entries()) {
    exactKeys(
      control,
      [
        "expectedBucket",
        "id",
        "surfaceRegister",
        "text",
        "tokens"
      ],
      `synthetic control ${index + 1}`
    );
    if (
      ids.has(control.id)
      || !/^[a-z0-9-]+$/.test(control.id)
      || !["hapsyoche", "haeyoche", "banmal", "noun-form"]
        .includes(control.surfaceRegister)
      || !EVIDENCE_BUCKETS.includes(control.expectedBucket)
      || classifyRegisterEvidence(control.text, control.tokens) !==
        control.expectedBucket
    ) {
      throw new Error(`synthetic control ${index + 1} drifted`);
    }
    ids.add(control.id);
  }
}

function validateAggregate(value, dataset) {
  exactKeys(
    value,
    [
      "analyzer",
      "calibrationId",
      "counts",
      "dataset",
      "limitations",
      "schemaVersion",
      "snapshotDate",
      "status"
    ],
    "aggregate"
  );
  if (
    value.schemaVersion !== AGGREGATE_SCHEMA_VERSION
    || value.calibrationId !== CALIBRATION_ID
    || value.snapshotDate !== SNAPSHOT_DATE
    || value.status !== "complete"
  ) {
    throw new Error("aggregate identity drifted");
  }
  const serialized = JSON.stringify(value);
  if (
    HANGUL_PATTERN.test(serialized)
    || containsForbiddenRawField(value)
  ) {
    throw new Error("aggregate contains source sentence or raw token material");
  }
  const expectedDataset = {
    name: "IWSLT 2023 EN-KO formality test projection",
    upstreamCommit: UPSTREAM_COMMIT,
    license: "CDLA-Sharing-1.0",
    taskPageDescribedSourceRows:
      TASK_PAGE_DESCRIBED_SOURCE_ROWS,
    observedSourceRows: OBSERVED_SOURCE_ROWS,
    referenceCount: REFERENCE_COUNT,
    labels: [...LABELS],
    projectRegisterMapping: "none",
    projectionSha256: dataset.projectionSha256
  };
  if (
    JSON.stringify(value.dataset) !==
      JSON.stringify(expectedDataset)
  ) {
    throw new Error("aggregate dataset provenance drifted");
  }
  exactKeys(
    value.analyzer,
    [
      "kiwiNlpVersion",
      "modelBytes",
      "modelProfileId",
      "modelProfileSha256",
      "modelType",
      "modelVersion",
      "nodeVersion",
      "realModelLoaded",
      "runCount"
    ],
    "aggregate analyzer"
  );
  if (
    value.analyzer.realModelLoaded !== true
    || value.analyzer.kiwiNlpVersion !== "0.23.0"
    || value.analyzer.modelVersion !== "0.23.0"
    || value.analyzer.modelType !== "cong"
    || value.analyzer.modelProfileId !== MODEL_PROFILE_ID
    || !SHA256_PATTERN.test(value.analyzer.modelProfileSha256 ?? "")
    || value.analyzer.modelBytes !== 93_885_643
    || value.analyzer.runCount !== REAL_RUN_COUNT
    || !/^v\d+\.\d+\.\d+$/.test(value.analyzer.nodeVersion ?? "")
  ) {
    throw new Error("aggregate analyzer provenance drifted");
  }
  validateAggregateCounts(value.counts);
  validateLimitations(value.limitations);
}

async function validateFile(path, spec) {
  const contents = await readFile(path);
  if (
    contents.length !== spec.bytes
    || sha256(contents) !== spec.sha256
  ) {
    throw new Error(`${path} byte count or SHA-256 drifted`);
  }
  if (
    Number.isInteger(spec.rows)
    && (await readLines(path)).length !== spec.rows
  ) {
    throw new Error(`${path} row count drifted`);
  }
}

async function assertTree(root, expected) {
  const rootDetails = await lstat(root);
  if (!rootDetails.isDirectory() || rootDetails.isSymbolicLink()) {
    throw new Error(`${root} must be a real directory`);
  }
  const entries = await readdir(root, { withFileTypes: true });
  const names = entries.map(({ name }) => name).sort();
  const wanted = Object.keys(expected).sort();
  if (JSON.stringify(names) !== JSON.stringify(wanted)) {
    throw new Error(`${root} tree entries drifted`);
  }
  for (const entry of entries) {
    const type = expected[entry.name];
    if (
      entry.isSymbolicLink()
      || (type === "file" && !entry.isFile())
      || (type === "directory" && !entry.isDirectory())
    ) {
      throw new Error(`${join(root, entry.name)} has the wrong entry type`);
    }
  }
}

function containsForbiddenRawField(value) {
  if (!value || typeof value !== "object") {
    return false;
  }
  return Object.entries(value).some(([key, child]) => (
    /^(?:text|sentence|source|reference|token|tokens)$/i.test(key)
    || containsForbiddenRawField(child)
  ));
}

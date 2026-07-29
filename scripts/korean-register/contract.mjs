import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../.."
);
export const DATASET_ROOT = resolve(
  REPO_ROOT,
  "examples/calibration-datasets/korean-register"
);
export const OUTPUT_ROOT = resolve(
  REPO_ROOT,
  "docs/calibration/korean-register-v1"
);
export const PROVENANCE_SCHEMA_VERSION =
  "korean-register-evidence-v1/provenance/v1";
export const AGGREGATE_SCHEMA_VERSION =
  "korean-register-evidence-v1/aggregate/v1";
export const STATUS_SCHEMA_VERSION =
  "korean-register-evidence-v1/status/v1";
export const REPEATABILITY_SCHEMA_VERSION =
  "korean-register-evidence-v1/repeatability/v1";
export const CALIBRATION_ID = "korean-register-evidence-v1";
export const UPSTREAM_COMMIT =
  "441e23a7c41beeac6329ffdb27d47024eb71b829";
export const OBSERVED_SOURCE_ROWS = 597;
export const REFERENCE_COUNT = 1_194;
export const TASK_PAGE_DESCRIBED_SOURCE_ROWS = 600;
export const LABELS = Object.freeze(["formal", "informal"]);
export const REAL_RUN_COUNT = 3;
export const SNAPSHOT_DATE = "2026-07-29";
export const MODEL_PROFILE_ID =
  "kiwi-v0.23.0-cong-core-control-v1";

export const DATA_FILES = Object.freeze({
  source:
    "cdla-sharing-1.0/iwslt2023-en-ko/formality-control.test.en-ko.en",
  formalAnnotated:
    "cdla-sharing-1.0/iwslt2023-en-ko/formality-control.test.en-ko.formal.annotated.ko",
  formalPlain:
    "cdla-sharing-1.0/iwslt2023-en-ko/formality-control.test.en-ko.formal.ko",
  informalAnnotated:
    "cdla-sharing-1.0/iwslt2023-en-ko/formality-control.test.en-ko.informal.annotated.ko",
  informalPlain:
    "cdla-sharing-1.0/iwslt2023-en-ko/formality-control.test.en-ko.informal.ko"
});

export const LIMITATIONS = Object.freeze([
  "Binary translation-formality labels are not Design Harness four-register labels.",
  "The corpus contains translated speech-task references, not real product UI copy.",
  "POS evidence buckets are descriptive measurements, not correctness predictions.",
  "No owner-labelled real-product precision or false-positive corpus was measured.",
  "The observation does not authorize a register detector, product finding, score, or CLI surface."
]);

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function readJsonLines(path) {
  return (await readLines(path)).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(
        `${path} line ${index + 1} is invalid JSON: ${error.message}`
      );
    }
  });
}

export async function readLines(path) {
  const source = await readFile(path, "utf8");
  if (!source.endsWith("\n") || source.includes("\r")) {
    throw new Error(`${path} must use LF lines with a trailing newline`);
  }
  return source.slice(0, -1).split("\n");
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function exactKeys(value, expected, label) {
  const actual = Object.keys(value ?? {}).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(
      `${label} keys must be exactly: ${wanted.join(", ")}`
    );
  }
}

export function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function aggregatePath(root, run) {
  return resolve(root, `aggregate-run-${run}.json`);
}

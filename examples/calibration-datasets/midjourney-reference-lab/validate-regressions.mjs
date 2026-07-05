#!/usr/bin/env node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");
const validatorPath = resolve(__dirname, "validate-manifest.mjs");
const exampleManifestPath = resolve(__dirname, "manifest.example.jsonl");
const baseRecord = JSON.parse(readFileSync(exampleManifestPath, "utf8").split(/\r?\n/).find(Boolean));
const tempDir = mkdtempSync(join(tmpdir(), "mjrl-validator-"));

function cloneRecord(overrides) {
  const record = JSON.parse(JSON.stringify(baseRecord));
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete record[key];
    } else {
      record[key] = value;
    }
  }

  return record;
}

function expectInvalid(name, overrides, expectedMessage) {
  const manifestPath = join(tempDir, `${name}.jsonl`);
  writeFileSync(manifestPath, `${JSON.stringify(cloneRecord(overrides))}\n`);

  const result = spawnSync(process.execPath, [validatorPath, manifestPath], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  if (result.status === 0) {
    throw new Error(`${name} unexpectedly passed validation`);
  }

  const output = `${result.stdout}\n${result.stderr}`;
  if (!output.includes(expectedMessage)) {
    throw new Error(`${name} failed without expected message "${expectedMessage}":\n${output}`);
  }
}

try {
  expectInvalid(
    "derived-fixture-path-escape",
    { derivedFixturePath: "examples/ui-quality-fixtures/midjourney-derived/../escaped.html" },
    "derivedFixturePath must point to examples/ui-quality-fixtures/midjourney-derived/",
  );
  expectInvalid(
    "local-asset-path-escape",
    { commitPolicy: "local-only", localAssetPath: "datasets/midjourney-reference-lab/local-assets/../escaped.png" },
    "localAssetPath must use the ignored local-assets path",
  );
  expectInvalid(
    "asset-approved-local-asset-path-escape",
    {
      commitPolicy: "asset-approved",
      localAssetPath: "datasets/midjourney-reference-lab/local-assets/../escaped.png",
      approvedAssetPath: "examples/calibration-datasets/midjourney-reference-lab/approved-assets/approved.png",
      rightsReview: { status: "approved", reviewer: "reviewer", notes: "Approved fixture for regression test." },
      sourcePromptHash: "sha256:regression",
    },
    "localAssetPath must use the ignored local-assets path",
  );
  expectInvalid(
    "approved-asset-path-escape",
    {
      commitPolicy: "asset-approved",
      localAssetPath: undefined,
      approvedAssetPath: "examples/calibration-datasets/midjourney-reference-lab/approved-assets/../escaped.png",
      rightsReview: { status: "approved", reviewer: "reviewer", notes: "Approved fixture for regression test." },
      sourcePromptHash: "sha256:regression",
    },
    "asset-approved records must use the approved-assets path",
  );
  expectInvalid("non-rfc3339-created-at", { createdAt: "July 5, 2026" }, "createdAt must be an RFC3339 date-time string");
  expectInvalid("invalid-created-at-date", { createdAt: "2026-02-30T00:00:00Z" }, "createdAt must be a valid RFC3339 date-time string");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

console.log("Validated Midjourney Reference Lab validator regressions.");

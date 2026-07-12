#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../../..");
const schema = JSON.parse(readFileSync(resolve(scriptDir, "schema.json"), "utf8"));
const manifestPath = resolve(repoRoot, process.argv[2] ?? "examples/calibration-datasets/korean-copy/manifest.jsonl");
const errors = [];
const records = readJsonLines(manifestPath);
const fixturePaths = new Set();
const allowedFields = new Set(Object.keys(schema.properties));
const allowedRedistribution = new Set(schema.properties.redistributionStatus.enum);

for (const [index, record] of records.entries()) {
  const line = index + 1;
  if (!isObject(record)) {
    errors.push(`line ${line}: record must be an object`);
    continue;
  }

  for (const field of schema.required) {
    if (!(field in record)) {
      errors.push(`line ${line}: missing required field ${field}`);
    }
  }
  for (const field of Object.keys(record)) {
    if (!allowedFields.has(field)) {
      errors.push(`line ${line}: unknown field ${field}`);
    }
  }

  if (record.schemaVersion !== "korean-copy-fixtures/v1") {
    errors.push(`line ${line}: schemaVersion must be korean-copy-fixtures/v1`);
  }
  for (const field of ["source", "license"]) {
    if (typeof record[field] !== "string" || record[field].trim().length === 0) {
      errors.push(`line ${line}: ${field} must be a non-empty string`);
    }
  }
  if (!allowedRedistribution.has(record.redistributionStatus)) {
    errors.push(`line ${line}: redistributionStatus must be ${Array.from(allowedRedistribution).join(", ")}`);
  } else if (record.redistributionStatus !== "allowed") {
    errors.push(`line ${line}: committed fixture redistributionStatus must be allowed`);
  }
  for (const field of ["synthetic", "derived"]) {
    if (typeof record[field] !== "boolean") {
      errors.push(`line ${line}: ${field} must be boolean`);
    }
  }
  if (record.notes !== undefined && (typeof record.notes !== "string" || record.notes.trim().length === 0)) {
    errors.push(`line ${line}: notes must be a non-empty string when present`);
  }

  const fixturePath = validateFixturePath(record.fixturePath, line);
  if (!fixturePath) {
    continue;
  }
  if (fixturePaths.has(fixturePath)) {
    errors.push(`line ${line}: duplicate fixturePath ${fixturePath}`);
  }
  fixturePaths.add(fixturePath);
  if (!existsSync(resolve(repoRoot, fixturePath))) {
    errors.push(`line ${line}: fixturePath does not exist: ${fixturePath}`);
  }
}

const committedKoreanFixtures = discoverKoreanFixtures();
for (const fixturePath of committedKoreanFixtures) {
  if (!fixturePaths.has(fixturePath)) {
    errors.push(`manifest is missing committed Korean fixture ${fixturePath}`);
  }
}
for (const fixturePath of fixturePaths) {
  if (!committedKoreanFixtures.has(fixturePath)) {
    errors.push(`manifest lists a path outside the committed Korean fixture set: ${fixturePath}`);
  }
}

if (errors.length > 0) {
  console.error("Korean copy fixture provenance validation failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`Validated provenance for ${fixturePaths.size} Korean fixtures.`);

function readJsonLines(path) {
  const text = readFileSync(path, "utf8");
  return text.split(/\r?\n/).flatMap((line, index) => {
    if (line.trim().length === 0) {
      return [];
    }
    try {
      return [JSON.parse(line)];
    } catch (error) {
      errors.push(`line ${index + 1}: invalid JSON (${error instanceof Error ? error.message : String(error)})`);
      return [];
    }
  });
}

function validateFixturePath(value, line) {
  if (typeof value !== "string" || value.trim() !== value || value.includes("\\")) {
    errors.push(`line ${line}: fixturePath must be a trimmed POSIX path`);
    return undefined;
  }
  const normalized = posix.normalize(value);
  if (
    normalized !== value ||
    normalized.startsWith("../") ||
    posix.isAbsolute(normalized) ||
    !/^examples\/ui-quality-fixtures\/(?:korean-[^/]+|korean\/[^/]+)\.html$/.test(normalized)
  ) {
    errors.push(`line ${line}: fixturePath is not an allowed Korean fixture path`);
    return undefined;
  }
  return normalized;
}

function discoverKoreanFixtures() {
  const fixtureRoot = resolve(repoRoot, "examples/ui-quality-fixtures");
  const paths = readdirSync(fixtureRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^korean-.*\.html$/.test(entry.name))
    .map((entry) => `examples/ui-quality-fixtures/${entry.name}`);
  const copyRoot = resolve(fixtureRoot, "korean");
  if (existsSync(copyRoot)) {
    paths.push(...readdirSync(copyRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
      .map((entry) => `examples/ui-quality-fixtures/korean/${entry.name}`));
  }
  return new Set(paths.sort());
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

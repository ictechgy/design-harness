#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const failures = [];

function read(path) {
  return readFileSync(resolve(root, path), "utf8");
}

function readJson(path) {
  return JSON.parse(read(path));
}

function expectMatch(label, actual, expected) {
  if (actual !== expected) {
    failures.push(`${label} is ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}.`);
  }
}

const rootPackage = readJson("package.json");
const packagePaths = [
  "packages/core/package.json",
  "packages/copy-audit/package.json",
  "packages/visual-audit/package.json",
  "packages/cli/package.json"
];

for (const packagePath of packagePaths) {
  expectMatch(`${packagePath} version`, readJson(packagePath).version, rootPackage.version);
}

const versionSource = read("packages/core/src/version.ts");
const schemaVersion = versionSource.match(/SCHEMA_VERSION = "([^"]+)"/)?.[1];
const harnessVersion = versionSource.match(/HARNESS_VERSION = "([^"]+)"/)?.[1];
if (!schemaVersion) failures.push("packages/core/src/version.ts: could not read SCHEMA_VERSION.");
if (!harnessVersion) failures.push("packages/core/src/version.ts: could not read HARNESS_VERSION.");
if (harnessVersion) expectMatch("HARNESS_VERSION", harnessVersion, rootPackage.version);

if (schemaVersion) {
  const schemaFiles = readdirSync(resolve(root, "packages/core/schemas"))
    .filter((fileName) => fileName.endsWith(".schema.json"))
    .sort();
  for (const schemaFile of schemaFiles) {
    const schema = readJson(`packages/core/schemas/${schemaFile}`);
    const consts = [];
    collectSchemaVersionConsts(schema, consts);
    for (const found of consts) {
      expectMatch(`packages/core/schemas/${schemaFile} ${found.path}`, found.value, schemaVersion);
    }
  }

  const rubricVersion = read("packages/core/rubric.yaml").match(/^schemaVersion: "([^"]+)"/m)?.[1];
  expectMatch("packages/core/rubric.yaml schemaVersion", rubricVersion, schemaVersion);
}

if (failures.length > 0) {
  console.error("check-version-consistency failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`check-version-consistency passed: package version ${rootPackage.version}, schema version ${schemaVersion}.`);

function collectSchemaVersionConsts(node, consts, path = "$") {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach((item, index) => collectSchemaVersionConsts(item, consts, `${path}[${index}]`));
    return;
  }

  for (const [key, value] of Object.entries(node)) {
    if (key === "schemaVersion" && value && typeof value === "object" && "const" in value) {
      consts.push({ path: `${path}.schemaVersion.const`, value: value.const });
    }
    collectSchemaVersionConsts(value, consts, `${path}.${key}`);
  }
}

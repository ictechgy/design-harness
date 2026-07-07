#!/usr/bin/env node
/**
 * Enforces AGENTS.md hard rule: the RubricCategory enum is duplicated across
 * TypeScript, three JSON schemas, rubric.yaml, and the implementationAreaFor
 * switch. Any addition must touch all of them. This script turns that prose
 * rule into a red build until the v0.4 schema consolidation lands.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const failures = [];

function read(path) {
  return readFileSync(resolve(root, path), "utf8");
}

function setOf(values) {
  return [...new Set(values)].sort();
}

function extractTypesUnion(source, typeName) {
  const match = source.match(new RegExp(`export type ${typeName} =([\\s\\S]*?);`));
  if (!match) {
    failures.push(`types.ts: could not locate union type ${typeName}`);
    return [];
  }
  return setOf([...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]));
}

function extractSchemaEnums(path, propertyName) {
  const schema = JSON.parse(read(path));
  const enums = [];
  (function walk(node) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === propertyName && value && Array.isArray(value.enum)) {
        enums.push(setOf(value.enum));
      }
      walk(value);
    }
  })(schema);
  return enums;
}

function extractRubricYamlCategories(source) {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => line === "categories:");
  if (start === -1) {
    failures.push("rubric.yaml: could not locate categories block");
    return [];
  }
  const keys = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== "" && !line.startsWith("  ")) break;
    const key = line.match(/^ {2}([a-z][a-z-]*):\s*$/);
    if (key) keys.push(key[1]);
  }
  return setOf(keys);
}

function extractSwitchCases(source, functionName) {
  const match = source.match(
    new RegExp(`function ${functionName}[\\s\\S]*?switch \\(finding.category\\) \\{([\\s\\S]*?)\\n\\}`)
  );
  if (!match) {
    failures.push(`report.ts: could not locate ${functionName} switch`);
    return [];
  }
  return setOf([...match[1].matchAll(/case "([^"]+)":/g)].map((m) => m[1]));
}

const typesSource = read("packages/core/src/types.ts");
const SCHEMA_PATHS = [
  "packages/core/schemas/finding.schema.json",
  "packages/core/schemas/criterion.schema.json",
  "packages/core/schemas/audit-result.schema.json"
];

// Enum name in types.ts -> the JSON-schema property whose enum mirrors it.
const TRACKED_ENUMS = [
  { typeName: "RubricCategory", property: "category" },
  { typeName: "SourceStrength", property: "sourceStrength" },
  { typeName: "CheckRuntime", property: "runtime" },
  { typeName: "EvidenceAssetType", property: "type" }
];

let comparisons = 0;
for (const { typeName, property } of TRACKED_ENUMS) {
  const expected = extractTypesUnion(typesSource, typeName);
  if (expected.length === 0) continue;
  const sources = new Map();
  for (const path of SCHEMA_PATHS) {
    extractSchemaEnums(path, property).forEach((values, index) => {
      // Only compare enums that plausibly mirror this type (same value space);
      // "type" is a generic property name, so skip enums that share no values.
      if (typeName === "EvidenceAssetType" && !values.some((v) => expected.includes(v))) return;
      sources.set(`${path} (${property} enum #${index + 1})`, values);
    });
  }
  if (typeName === "RubricCategory") {
    sources.set("rubric.yaml categories", extractRubricYamlCategories(read("packages/core/rubric.yaml")));
    sources.set(
      "report.ts implementationAreaFor cases",
      extractSwitchCases(read("packages/core/src/report.ts"), "implementationAreaFor")
    );
    if (sources.size < 3) failures.push("RubricCategory: expected at least 3 mirror locations");
  }
  for (const [label, values] of sources) {
    comparisons += 1;
    if (JSON.stringify(values) !== JSON.stringify(expected)) {
      failures.push(
        `${label} diverges from types.ts ${typeName}.\n  expected: ${expected.join(", ")}\n  actual:   ${values.join(", ")}`
      );
    }
  }
}

if (failures.length > 0) {
  console.error("check-enum-lockstep failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(
  `check-enum-lockstep passed: ${TRACKED_ENUMS.map((e) => e.typeName).join(", ")} in lockstep (${comparisons} mirror comparisons).`
);

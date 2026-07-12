#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { calibratedCopyCheckNames } from "../../../scripts/copy-calibration-contract.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../../..");
const schema = JSON.parse(readFileSync(resolve(scriptDir, "schema.json"), "utf8"));
const manifestPath = resolve(repoRoot, process.argv[2] ?? "examples/calibration-datasets/korean-copy/manifest.jsonl");
const errors = [];
const criterionRegistry = readCriterionRegistry();
const records = readJsonLines(manifestPath);
const fixturePaths = new Set();
const allowedFields = new Set(Object.keys(schema.properties));
const allowedRedistribution = new Set(schema.properties.redistributionStatus.enum);

for (const checkName of calibratedCopyCheckNames) {
  if (!criterionRegistry.checkNames.has(checkName)) {
    errors.push(`calibration contract check is not registered: ${checkName}`);
  }
}

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

  if (record.schemaVersion !== "korean-copy-fixtures/v2") {
    errors.push(`line ${line}: schemaVersion must be korean-copy-fixtures/v2`);
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
  validateCalibrationContract(record, line);

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

console.log(`Validated provenance and calibration expectations for ${fixturePaths.size} Korean fixtures.`);

function validateCalibrationContract(record, line) {
  if (record.josaHedgePolicy !== "flag" && record.josaHedgePolicy !== "allow") {
    errors.push(`line ${line}: josaHedgePolicy must be flag or allow`);
  }

  const expectedNames = new Set();
  if (!Array.isArray(record.expectedFindings)) {
    errors.push(`line ${line}: expectedFindings must be an array`);
  } else {
    for (const [index, expectation] of record.expectedFindings.entries()) {
      const path = `line ${line}: expectedFindings[${index}]`;
      if (!isObject(expectation)) {
        errors.push(`${path} must be an object`);
        continue;
      }
      validateExactFields(expectation, new Set(["checkName", "count"]), path);
      const checkName = validateCheckName(expectation.checkName, `${path}.checkName`);
      if (checkName) {
        if (expectedNames.has(checkName)) {
          errors.push(`${path}.checkName duplicates ${checkName}`);
        }
        expectedNames.add(checkName);
        if (!criterionRegistry.checkNames.has(checkName)) {
          errors.push(`${path}.checkName is not registered: ${checkName}`);
        }
        if (!calibratedCopyCheckNames.includes(checkName)) {
          errors.push(`${path}.checkName is outside the parser-free copy calibration scope: ${checkName}`);
        }
      }
      if (!Number.isInteger(expectation.count) || expectation.count < 1) {
        errors.push(`${path}.count must be a positive integer`);
      }
    }
  }

  const negativeNames = new Set();
  const futureIds = new Set();
  if (!isObject(record.shouldNotFlag)) {
    errors.push(`line ${line}: shouldNotFlag must be an object`);
  } else {
    validateExactFields(
      record.shouldNotFlag,
      new Set(["registeredCheckNames", "futureCriteria"]),
      `line ${line}: shouldNotFlag`
    );
    const registered = record.shouldNotFlag.registeredCheckNames;
    if (!Array.isArray(registered)) {
      errors.push(`line ${line}: shouldNotFlag.registeredCheckNames must be an array`);
    } else {
      for (const [index, value] of registered.entries()) {
        const path = `line ${line}: shouldNotFlag.registeredCheckNames[${index}]`;
        const checkName = validateCheckName(value, path);
        if (!checkName) {
          continue;
        }
        if (negativeNames.has(checkName)) {
          errors.push(`${path} duplicates ${checkName}`);
        }
        negativeNames.add(checkName);
        if (!criterionRegistry.checkNames.has(checkName)) {
          errors.push(`${path} is not registered: ${checkName}`);
        }
        if (!calibratedCopyCheckNames.includes(checkName)) {
          errors.push(`${path} is outside the parser-free copy calibration scope: ${checkName}`);
        }
      }
    }

    const future = record.shouldNotFlag.futureCriteria;
    if (!Array.isArray(future)) {
      errors.push(`line ${line}: shouldNotFlag.futureCriteria must be an array`);
    } else {
      for (const [index, declaration] of future.entries()) {
        const path = `line ${line}: shouldNotFlag.futureCriteria[${index}]`;
        if (!isObject(declaration)) {
          errors.push(`${path} must be an object`);
          continue;
        }
        validateExactFields(declaration, new Set(["criterionId", "rationale"]), path);
        const criterionId = declaration.criterionId;
        if (typeof criterionId !== "string" || !/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(criterionId)) {
          errors.push(`${path}.criterionId must be a criterion-like identifier`);
        } else {
          if (futureIds.has(criterionId)) {
            errors.push(`${path}.criterionId duplicates ${criterionId}`);
          }
          futureIds.add(criterionId);
          if (criterionRegistry.criterionIds.has(criterionId) || criterionRegistry.checkNames.has(criterionId)) {
            errors.push(`${path}.criterionId is already registered: ${criterionId}`);
          }
        }
        if (typeof declaration.rationale !== "string" || declaration.rationale.trim().length === 0) {
          errors.push(`${path}.rationale must be a non-empty string`);
        }
      }
    }
  }

  for (const checkName of calibratedCopyCheckNames) {
    const isExpected = expectedNames.has(checkName);
    const isNegative = negativeNames.has(checkName);
    if (isExpected && isNegative) {
      errors.push(`line ${line}: ${checkName} cannot be both expected and registered under shouldNotFlag`);
    } else if (!isExpected && !isNegative) {
      errors.push(`line ${line}: ${checkName} must be expected or registered under shouldNotFlag`);
    }
  }
}

function validateExactFields(value, allowed, path) {
  for (const field of allowed) {
    if (!(field in value)) {
      errors.push(`${path} is missing ${field}`);
    }
  }
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) {
      errors.push(`${path} has unknown field ${field}`);
    }
  }
}

function validateCheckName(value, path) {
  if (typeof value !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    errors.push(`${path} must be a checkName`);
    return undefined;
  }
  return value;
}

function readCriterionRegistry() {
  const source = readFileSync(resolve(repoRoot, "packages/core/src/criteria.ts"), "utf8");
  const start = source.indexOf("export const CRITERIA");
  const end = source.indexOf("const criteriaById", start);
  if (start === -1 || end === -1) {
    errors.push("could not locate the core criterion registry");
    return { checkNames: new Set(), criterionIds: new Set() };
  }
  const registrySource = source.slice(start, end);
  const checkNames = new Set(
    [...registrySource.matchAll(/checkNames:\s*\[([^\]]*)\]/g)]
      .flatMap((match) => [...match[1].matchAll(/"([^"]+)"/g)].map((nameMatch) => nameMatch[1]))
  );
  const criterionIds = new Set(
    [...registrySource.matchAll(/\bid:\s*"([^"]+)"/g)].map((match) => match[1])
  );
  if (checkNames.size === 0 || criterionIds.size === 0) {
    errors.push("core criterion registry parsing returned no entries");
  }
  return { checkNames, criterionIds };
}

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

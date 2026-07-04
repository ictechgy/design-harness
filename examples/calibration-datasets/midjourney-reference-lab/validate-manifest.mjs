#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(__dirname, "schema.json");
const criteriaPath = resolve(process.cwd(), "packages/core/src/criteria.ts");
const manifestPath = resolve(process.cwd(), process.argv[2] ?? "examples/calibration-datasets/midjourney-reference-lab/manifest.example.jsonl");

const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
const criteriaText = readFileSync(criteriaPath, "utf8");
const text = readFileSync(manifestPath, "utf8");
const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
const errors = [];

const required = schema.required;
const allowedRecordFields = new Set(Object.keys(schema.properties));
const allowedRightsReviewFields = new Set(Object.keys(schema.properties.rightsReview.properties));
const allowedFindingFields = new Set(Object.keys(schema.properties.expectedFindings.items.properties));
const qualityTargets = new Set(schema.properties.qualityTarget.enum);
const commitPolicies = new Set(schema.properties.commitPolicy.enum);
const rightsStatuses = new Set(schema.properties.rightsReview.properties.status.enum);
const claimTypes = new Set(schema.properties.expectedFindings.items.properties.claimType.enum);
const sourceStrengths = new Set(schema.properties.expectedFindings.items.properties.sourceStrength.enum);
const expectedResults = new Set(schema.properties.expectedFindings.items.properties.expectedResult.enum);
const learningUses = new Set(schema.properties.learningUse.enum);
const humanVerdicts = new Set(schema.properties.humanVerdict.enum);
const imageExtensionPattern = /\.(png|jpe?g|webp|gif)$/i;
const criteriaById = loadCriteria(criteriaText);

function addError(lineNumber, message) {
  errors.push(`line ${lineNumber}: ${message}`);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateRelativePublicPath(lineNumber, field, value) {
  if (typeof value !== "string") {
    addError(lineNumber, `${field} must be a string`);
    return;
  }

  if (value.startsWith("/") || value.startsWith("~") || value.includes("://")) {
    addError(lineNumber, `${field} must be a relative repo path without private URLs`);
  }
}

function validateArrayOfStrings(lineNumber, field, value) {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || item.length === 0)) {
    addError(lineNumber, `${field} must be a non-empty array of strings`);
  }
}

function validateNonEmptyString(lineNumber, field, value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    addError(lineNumber, `${field} must be a non-empty string`);
    return false;
  }

  return true;
}

function loadCriteria(sourceText) {
  const criteria = new Map();
  const criteriaStart = sourceText.indexOf("export const CRITERIA");
  const criteriaEnd = sourceText.indexOf("const criteriaById", criteriaStart);

  if (criteriaStart === -1 || criteriaEnd === -1) {
    return criteria;
  }

  const criteriaSection = sourceText.slice(criteriaStart, criteriaEnd);
  const criterionPattern = /\{\s+id: "([^"]+)"[\s\S]*?sourceStrength: "([^"]+)"/g;

  for (const match of criteriaSection.matchAll(criterionPattern)) {
    criteria.set(match[1], { sourceStrength: match[2] });
  }

  return criteria;
}

function validateRecord(record, lineNumber) {
  if (!isObject(record)) {
    addError(lineNumber, "record must be an object");
    return;
  }

  for (const field of required) {
    if (!(field in record)) {
      addError(lineNumber, `missing required field ${field}`);
    }
  }

  for (const field of Object.keys(record)) {
    if (!allowedRecordFields.has(field)) {
      addError(lineNumber, `unknown field ${field}`);
    }
  }

  if (record.schemaVersion !== "midjourney-reference-lab/v1") {
    addError(lineNumber, "schemaVersion must be midjourney-reference-lab/v1");
  }

  if (typeof record.batchId !== "string" || !/^mjrl-[a-z0-9-]+$/.test(record.batchId)) {
    addError(lineNumber, "batchId must match mjrl-[a-z0-9-]+");
  }

  if (typeof record.createdAt !== "string" || Number.isNaN(Date.parse(record.createdAt))) {
    addError(lineNumber, "createdAt must be an ISO date-time string");
  }

  if (typeof record.prompt !== "string" || record.prompt.trim().length < 20) {
    addError(lineNumber, "prompt must be a descriptive string");
  }

  validateNonEmptyString(lineNumber, "referenceIntent", record.referenceIntent);
  validateNonEmptyString(lineNumber, "uiArchetype", record.uiArchetype);

  if (!qualityTargets.has(record.qualityTarget)) {
    addError(lineNumber, `qualityTarget must be one of ${Array.from(qualityTargets).join(", ")}`);
  }

  if (!commitPolicies.has(record.commitPolicy)) {
    addError(lineNumber, `commitPolicy must be one of ${Array.from(commitPolicies).join(", ")}`);
  }

  if (!isObject(record.rightsReview)) {
    addError(lineNumber, "rightsReview must be an object");
  } else {
    for (const field of Object.keys(record.rightsReview)) {
      if (!allowedRightsReviewFields.has(field)) {
        addError(lineNumber, `rightsReview has unknown field ${field}`);
      }
    }

    if (!rightsStatuses.has(record.rightsReview.status)) {
      addError(lineNumber, `rightsReview.status must be one of ${Array.from(rightsStatuses).join(", ")}`);
    }

    if (record.rightsReview.reviewer !== undefined) {
      validateNonEmptyString(lineNumber, "rightsReview.reviewer", record.rightsReview.reviewer);
    }

    if (typeof record.rightsReview.notes !== "string" || record.rightsReview.notes.trim().length === 0) {
      addError(lineNumber, "rightsReview.notes must be a non-empty string");
    }
  }

  validateRelativePublicPath(lineNumber, "derivedFixturePath", record.derivedFixturePath);

  if (typeof record.derivedFixturePath === "string" && !record.derivedFixturePath.startsWith("examples/ui-quality-fixtures/midjourney-derived/")) {
    addError(lineNumber, "derivedFixturePath must point to examples/ui-quality-fixtures/midjourney-derived/");
  }

  if (record.localAssetPath !== undefined) {
    validateRelativePublicPath(lineNumber, "localAssetPath", record.localAssetPath);
    if (typeof record.localAssetPath === "string") {
      if (record.commitPolicy !== "asset-approved" && !record.localAssetPath.startsWith("datasets/midjourney-reference-lab/local-assets/")) {
        addError(lineNumber, "localAssetPath must use the ignored local-assets path unless asset-approved");
      }
      if (imageExtensionPattern.test(record.localAssetPath) && record.commitPolicy === "asset-approved" && record.rightsReview?.status !== "approved") {
        addError(lineNumber, "asset-approved image paths require rightsReview.status approved");
      }
    }
  }

  if (record.commitPolicy === "asset-approved" && record.rightsReview?.status !== "approved") {
    addError(lineNumber, "asset-approved records require rightsReview.status approved");
  }

  if (record.commitPolicy === "asset-approved") {
    validateNonEmptyString(lineNumber, "sourcePromptHash", record.sourcePromptHash);
    validateRelativePublicPath(lineNumber, "approvedAssetPath", record.approvedAssetPath);
    if (typeof record.approvedAssetPath === "string" && !record.approvedAssetPath.startsWith("examples/calibration-datasets/midjourney-reference-lab/approved-assets/")) {
      addError(lineNumber, "asset-approved records must use the approved-assets path");
    }
  }

  if (record.commitPolicy !== "asset-approved" && record.approvedAssetPath !== undefined) {
    addError(lineNumber, "approvedAssetPath is only allowed for asset-approved records");
  }

  if (record.commitPolicy === "local-only" && typeof record.localAssetPath !== "string") {
    addError(lineNumber, "local-only records require localAssetPath");
  }

  if (!Array.isArray(record.expectedFindings)) {
    addError(lineNumber, "expectedFindings must be an array");
  } else {
    record.expectedFindings.forEach((finding, index) => validateFinding(lineNumber, finding, index));
  }

  if (!learningUses.has(record.learningUse)) {
    addError(lineNumber, `learningUse must be one of ${Array.from(learningUses).join(", ")}`);
  }

  if (!humanVerdicts.has(record.humanVerdict)) {
    addError(lineNumber, `humanVerdict must be one of ${Array.from(humanVerdicts).join(", ")}`);
  }

  validateArrayOfStrings(lineNumber, "allowedUse", record.allowedUse);
  validateArrayOfStrings(lineNumber, "excludedUse", record.excludedUse);

  if (record.shouldNotFlag !== undefined) {
    validateArrayOfStrings(lineNumber, "shouldNotFlag", record.shouldNotFlag);
  }
}

function validateFinding(lineNumber, finding, index) {
  const prefix = `expectedFindings[${index}]`;

  if (!isObject(finding)) {
    addError(lineNumber, `${prefix} must be an object`);
    return;
  }

  if (typeof finding.summary !== "string" || finding.summary.trim().length === 0) {
    addError(lineNumber, `${prefix}.summary must be a non-empty string`);
  }

  for (const field of Object.keys(finding)) {
    if (!allowedFindingFields.has(field)) {
      addError(lineNumber, `${prefix} has unknown field ${field}`);
    }
  }

  if (!claimTypes.has(finding.claimType)) {
    addError(lineNumber, `${prefix}.claimType must be one of ${Array.from(claimTypes).join(", ")}`);
  }

  if (finding.sourceStrength !== undefined && !sourceStrengths.has(finding.sourceStrength)) {
    addError(lineNumber, `${prefix}.sourceStrength must be one of ${Array.from(sourceStrengths).join(", ")}`);
  }

  if (!expectedResults.has(finding.expectedResult)) {
    addError(lineNumber, `${prefix}.expectedResult must be one of ${Array.from(expectedResults).join(", ")}`);
  }

  if (typeof finding.criterionId === "string") {
    const criterion = criteriaById.get(finding.criterionId);
    if (!criterion) {
      addError(lineNumber, `${prefix}.criterionId does not exist in packages/core/src/criteria.ts`);
    } else if (finding.sourceStrength !== undefined && criterion.sourceStrength !== finding.sourceStrength) {
      addError(lineNumber, `${prefix}.sourceStrength must match criterion registry value ${criterion.sourceStrength}`);
    }
  }

  if (finding.claimType === "deterministic") {
    if (typeof finding.criterionId !== "string" || finding.criterionId.length === 0) {
      addError(lineNumber, `${prefix} deterministic findings require criterionId`);
    }
    if (finding.sourceStrength !== "official-testable") {
      addError(lineNumber, `${prefix} deterministic findings require sourceStrength official-testable`);
    }
  }

  if (finding.claimType === "future-criterion") {
    validateNonEmptyString(lineNumber, `${prefix}.futureCriterion`, finding.futureCriterion);
  }

  if (finding.claimType !== "future-criterion" && typeof finding.criterionId !== "string") {
    addError(lineNumber, `${prefix} requires criterionId unless claimType is future-criterion`);
  }
}

lines.forEach((line, index) => {
  const lineNumber = index + 1;
  try {
    validateRecord(JSON.parse(line), lineNumber);
  } catch (error) {
    addError(lineNumber, `invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
});

if (errors.length > 0) {
  console.error(`Invalid Midjourney Reference Lab manifest: ${manifestPath}`);
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`Validated ${lines.length} Midjourney Reference Lab manifest record(s).`);

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

export const CATALOG_SOURCE_URL = new URL("../datasets/slop-fingerprints.json", import.meta.url);
export const GENERATED_CATALOG_URL = new URL(
  "../packages/core/src/generated/slop-fingerprints.ts",
  import.meta.url
);

const ROOT_KEYS = ["catalogVersion", "entries", "schemaVersion"];
const ENTRY_KEYS = [
  "badExample",
  "conflictsWith",
  "description",
  "goodExample",
  "id",
  "license",
  "name",
  "provenance"
];
const PROVENANCE_KEYS = ["kind", "note", "source", "url"];
const LICENSE_KEYS = ["holder", "spdx"];
const ID_PATTERN = /^[a-z][a-z0-9-]*$/u;
const CATALOG_VERSION_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const STRUCTURAL_PATTERN = /[\u0000-\u001f\u007f-\u009f\u00ad\u034f\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/u;

export function readCatalog(url = CATALOG_SOURCE_URL) {
  const bytes = readFileSync(url);
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error(`Fingerprint catalog must be valid UTF-8: ${errorMessage(error)}`);
  }

  let catalog;
  try {
    catalog = JSON.parse(text);
  } catch (error) {
    throw new Error(`Fingerprint catalog must be valid JSON: ${errorMessage(error)}`);
  }
  validateCatalog(catalog);
  return catalog;
}

export function validateCatalog(catalog) {
  assertPlainObject(catalog, "$", ROOT_KEYS);
  if (catalog.schemaVersion !== "1.0") {
    fail("$.schemaVersion", "must equal 1.0");
  }
  if (typeof catalog.catalogVersion !== "string" || !CATALOG_VERSION_PATTERN.test(catalog.catalogVersion)) {
    fail("$.catalogVersion", "must use YYYY-MM-DD");
  }
  if (!Array.isArray(catalog.entries) || catalog.entries.length < 3 || catalog.entries.length > 8) {
    fail("$.entries", "must contain 3..8 entries");
  }

  const ids = new Set();
  const contentKeys = new Set();
  let previousId;
  for (const [index, entry] of catalog.entries.entries()) {
    const path = `$.entries[${index}]`;
    assertPlainObject(entry, path, ENTRY_KEYS);
    assertSafeLine(entry.id, `${path}.id`);
    if (!ID_PATTERN.test(entry.id)) {
      fail(`${path}.id`, "must be lower-kebab");
    }
    if (ids.has(entry.id)) {
      fail(`${path}.id`, `duplicates ${entry.id}`);
    }
    if (previousId !== undefined && codePointCompare(previousId, entry.id) >= 0) {
      fail(`${path}.id`, "entries must be strictly sorted by id");
    }
    previousId = entry.id;
    ids.add(entry.id);

    for (const field of ["name", "description", "badExample", "goodExample"]) {
      assertSafeLine(entry[field], `${path}.${field}`);
    }
    if (normalizeText(entry.badExample) === normalizeText(entry.goodExample)) {
      fail(path, "badExample and goodExample must differ");
    }

    const contentKey = [entry.name, entry.description, entry.badExample, entry.goodExample]
      .map(normalizeText)
      .join("\u0000");
    if (contentKeys.has(contentKey)) {
      fail(path, "duplicates normalized entry content");
    }
    contentKeys.add(contentKey);

    if (!Array.isArray(entry.conflictsWith)) {
      fail(`${path}.conflictsWith`, "must be an array");
    }
    let previousConflict;
    for (const [conflictIndex, conflictId] of entry.conflictsWith.entries()) {
      const conflictPath = `${path}.conflictsWith[${conflictIndex}]`;
      if (typeof conflictId !== "string" || !ID_PATTERN.test(conflictId)) {
        fail(conflictPath, "must be a lower-kebab id");
      }
      if (conflictId === entry.id) {
        fail(conflictPath, "must not refer to itself");
      }
      if (previousConflict !== undefined && codePointCompare(previousConflict, conflictId) >= 0) {
        fail(conflictPath, "conflicts must be unique and sorted");
      }
      previousConflict = conflictId;
    }

    assertPlainObject(entry.provenance, `${path}.provenance`, PROVENANCE_KEYS);
    for (const field of PROVENANCE_KEYS) {
      assertSafeLine(entry.provenance[field], `${path}.provenance.${field}`);
    }
    if (!entry.provenance.url.startsWith("https://")) {
      fail(`${path}.provenance.url`, "must be an https URL");
    }

    assertPlainObject(entry.license, `${path}.license`, LICENSE_KEYS);
    for (const field of LICENSE_KEYS) {
      assertSafeLine(entry.license[field], `${path}.license.${field}`);
    }
  }

  const entriesById = new Map(catalog.entries.map((entry) => [entry.id, entry]));
  for (const [index, entry] of catalog.entries.entries()) {
    for (const conflictId of entry.conflictsWith) {
      const other = entriesById.get(conflictId);
      if (!other) {
        fail(`$.entries[${index}].conflictsWith`, `references unknown id ${conflictId}`);
      }
      if (!other.conflictsWith.includes(entry.id)) {
        fail(`$.entries[${index}].conflictsWith`, `conflict with ${conflictId} must be symmetric`);
      }
    }
  }
}

export function renderGeneratedCatalog(catalog) {
  validateCatalog(catalog);
  return [
    "// Generated by scripts/generate-guide-data.mjs. Do not edit by hand.",
    "",
    `export const SLOP_FINGERPRINT_CATALOG = ${JSON.stringify(catalog, null, 2)} as const;`,
    ""
  ].join("\n");
}

export function writeGeneratedCatalog() {
  const catalog = readCatalog();
  writeFileSync(GENERATED_CATALOG_URL, renderGeneratedCatalog(catalog), "utf8");
}

function assertPlainObject(value, path, allowedKeys) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(path, "must be an object");
  }
  const keys = Object.keys(value).sort(codePointCompare);
  const expected = [...allowedKeys].sort(codePointCompare);
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    fail(path, `must have exactly keys ${expected.join(", ")}`);
  }
}

function assertSafeLine(value, path) {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    fail(path, "must be a nonblank trim-stable string");
  }
  if (hasUnpairedSurrogate(value) || STRUCTURAL_PATTERN.test(value)) {
    fail(path, "contains a non-scalar, control, or bidi character");
  }
  if (value.includes("<!--") || value.includes("-->") || value.includes("```") || value.includes("~~~")) {
    fail(path, "contains a structural Markdown delimiter");
  }
  if (/^\s*@(?:AGENTS|CLAUDE)\.md\b/iu.test(value)) {
    fail(path, "contains an agent import directive");
  }
}

function normalizeText(value) {
  return value.normalize("NFC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
}

function codePointCompare(left, right) {
  const leftPoints = [...left];
  const rightPoints = [...right];
  for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index += 1) {
    const leftPoint = leftPoints[index].codePointAt(0);
    const rightPoint = rightPoints[index].codePointAt(0);
    if (leftPoint !== rightPoint) {
      return leftPoint < rightPoint ? -1 : 1;
    }
  }
  return leftPoints.length < rightPoints.length ? -1 : leftPoints.length > rightPoints.length ? 1 : 0;
}

function hasUnpairedSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return true;
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function fail(path, message) {
  throw new Error(`${path} ${message}`);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined;
if (invokedPath === import.meta.url) {
  writeGeneratedCatalog();
  console.log(`Generated ${fileURLToPath(GENERATED_CATALOG_URL)}.`);
}

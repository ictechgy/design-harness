#!/usr/bin/env node
/**
 * Enforces ADR-002: @design-harness/core is the surface-agnostic contract
 * (criteria, policy matrix, schemas, scoring, report) and must never couple
 * to a capture technology. Capture engines (Playwright today, any app/native
 * adapter later) live in adapter packages that depend on core — never the
 * reverse. This guard turns that invariant into a red build.
 */
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const coreDir = resolve(root, "packages/core");
const failures = [];

// Best-effort tripwire, not an exhaustive taxonomy: pair each capture engine
// with its scoped prefix (matcher is exact-or-prefix). False positives fail
// loudly and get fixed here; false negatives are the dangerous direction.
const FORBIDDEN_MODULES = [
  "playwright",
  "@playwright/",
  "puppeteer",
  "@puppeteer/",
  "jsdom",
  "linkedom",
  "happy-dom",
  "appium",
  "@appium/",
  "webdriverio",
  "@wdio/",
  "selenium-webdriver",
  "cypress",
  "@design-harness/visual-audit",
  "@design-harness/cli"
];

const manifest = JSON.parse(readFileSync(join(coreDir, "package.json"), "utf8"));
for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
  for (const name of Object.keys(manifest[field] ?? {})) {
    if (FORBIDDEN_MODULES.some((forbidden) => name === forbidden || name.startsWith(forbidden))) {
      failures.push(`packages/core/package.json ${field} declares capture-coupled module "${name}"`);
    }
  }
}

const SOURCE_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/;

function walk(dir, seen = new Set()) {
  const real = realpathSync(dir);
  if (seen.has(real)) return [];
  seen.add(real);
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    const isDirectory = entry.isSymbolicLink() ? statSync(path).isDirectory() : entry.isDirectory();
    if (isDirectory) return walk(path, seen);
    return SOURCE_FILE.test(entry.name) ? [path] : [];
  });
}

// Covers: from "x" · import "x" (side-effect) · import("x") · require("x"), with ' " or ` quotes
const importPattern = /(?:from\s+|import\s+|import\s*\(\s*|require\s*\(\s*)(["'`])([^"'`]+)\1/g;
let scanned = 0;
for (const file of walk(join(coreDir, "src"))) {
  scanned += 1;
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[2];
    if (FORBIDDEN_MODULES.some((forbidden) => specifier === forbidden || specifier.startsWith(forbidden))) {
      failures.push(`${file.slice(root.length)} imports capture-coupled module "${specifier}"`);
    }
  }
}

if (scanned === 0) {
  failures.push("packages/core/src yielded 0 scannable source files — the import guard did not actually run");
}

if (failures.length > 0) {
  console.error("check-core-purity failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`check-core-purity passed: core manifest and ${scanned} source files are capture-agnostic.`);

#!/usr/bin/env node
/**
 * Enforces AGENTS.md hard rules 4 and 5 mechanically:
 * - ToS-restricted Korean spellcheck endpoints (hanspell family, Pusan/Naver/
 *   Daum scrapers) must never appear as dependencies.
 * - GPL-3.0 spellcheck-ko dictionary data (.aff/.dic) must never be vendored
 *   into the Apache-2.0 packages (runtime-fetched only).
 * - kiwi-nlp is exact-pinned in copy-audit only, dynamically loaded only by
 *   the dedicated worker, and never accompanied by vendored model/WASM files.
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";

const root = resolve(new URL("..", import.meta.url).pathname);
const failures = [];

const DENYLIST = ["hanspell", "py-hanspell", "hanspell-cli", "pusan-speller", "naver-speller", "daum-speller"];
const KIWI_VERSION = "0.23.0";
const KIWI_MANIFEST = "packages/copy-audit/package.json";
const KIWI_LOADER = "packages/copy-audit/src/kiwi-worker.ts";
const kiwiLoaderSource = readFileSync(resolve(root, KIWI_LOADER), "utf8");

const manifestPaths = ["package.json"];
for (const dir of readdirSync(resolve(root, "packages"))) {
  const candidate = join("packages", dir, "package.json");
  if (existsSync(resolve(root, candidate))) manifestPaths.push(candidate);
}

for (const manifestPath of manifestPaths) {
  const manifest = JSON.parse(readFileSync(resolve(root, manifestPath), "utf8"));
  const declared = Object.keys({
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.optionalDependencies,
    ...manifest.peerDependencies
  });
  for (const name of declared) {
    if (DENYLIST.includes(name)) {
      failures.push(`${manifestPath}: dependency "${name}" is ToS-restricted (AGENTS.md hard rule 4).`);
    }
  }
  const hasKiwi = declared.includes("kiwi-nlp");
  if (hasKiwi) {
    const agents = readFileSync(resolve(root, "AGENTS.md"), "utf8");
    if (!/kiwi-nlp/.test(agents) || !/LGPL/.test(agents)) {
      failures.push(`${manifestPath}: kiwi-nlp is a dependency but its LGPL license is not documented in AGENTS.md (hard rule 5).`);
    }
    if (
      manifestPath !== KIWI_MANIFEST
      || manifest.dependencies?.["kiwi-nlp"] !== KIWI_VERSION
      || Object.hasOwn(manifest.devDependencies ?? {}, "kiwi-nlp")
      || Object.hasOwn(manifest.optionalDependencies ?? {}, "kiwi-nlp")
      || Object.hasOwn(manifest.peerDependencies ?? {}, "kiwi-nlp")
    ) {
      failures.push(
        `${manifestPath}: kiwi-nlp must be an exact ${KIWI_VERSION} runtime dependency in ${KIWI_MANIFEST} only.`
      );
    }
  }
}

const sourceRoots = [
  "packages/core/src",
  "packages/copy-audit/src",
  "packages/visual-audit/src",
  "packages/cli/src"
];
for (const sourceRoot of sourceRoots) {
  for (const file of walkFiles(resolve(root, sourceRoot))) {
    if (!/\.[cm]?[jt]s$/u.test(file)) continue;
    const source = readFileSync(file, "utf8");
    const relativeFile = file.slice(root.length + 1);
    const hasDynamicImport = /import\(\s*["']kiwi-nlp["']\s*\)/u.test(source);
    const hasStaticImport = /(?:^|\n)\s*import\s+(?:[^(\n]*\s+from\s+)?["']kiwi-nlp["']/u.test(source);
    if ((hasDynamicImport || hasStaticImport) && relativeFile !== KIWI_LOADER) {
      failures.push(`${relativeFile}: kiwi-nlp may only be imported by the dedicated worker loader.`);
    }
    if (relativeFile === KIWI_LOADER && !/await import\(["']kiwi-nlp["']\)/u.test(source)) {
      failures.push(`${relativeFile}: kiwi-nlp must use a lazy dynamic import.`);
    }
    if (hasStaticImport) {
      failures.push(`${relativeFile}: static kiwi-nlp imports are forbidden.`);
    }
  }
}

if (!/reverifyAndReadPreparedKiwiModelFiles/u.test(kiwiLoaderSource)) {
  failures.push(`${KIWI_LOADER}: Kiwi initialization must consume bytes returned by same-handle profile re-verification.`);
}
if (/(?:readFile|createReadStream)\s*\(/u.test(kiwiLoaderSource)) {
  failures.push(`${KIWI_LOADER}: model files must not be re-read after verified bytes are returned.`);
}

for (const scanRoot of ["packages", "examples", "docs"]) {
  for (const file of walkFiles(resolve(root, scanRoot))) {
    const relativeFile = file.slice(root.length + 1);
    if (
      /\.(?:mdl|wasm|aff|dic)$/u.test(relativeFile)
      || /(?:^|\/)(?:combiningRule\.txt|sj\.morph)$/u.test(relativeFile)
    ) {
      failures.push(`${relativeFile}: Kiwi model/WASM and dictionary assets must never be vendored.`);
    }
  }
}

const lockfile = resolve(root, "pnpm-lock.yaml");
if (existsSync(lockfile)) {
  const lock = readFileSync(lockfile, "utf8");
  for (const name of DENYLIST) {
    if (new RegExp(`^\\s+/?${name}[@:]`, "m").test(lock)) {
      failures.push(`pnpm-lock.yaml: transitive dependency "${name}" is ToS-restricted (AGENTS.md hard rule 4).`);
    }
  }
}

let trackedFiles = [];
try {
  trackedFiles = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
} catch {
  console.warn("check-deps-policy: git unavailable; skipping tracked-dictionary scan.");
}
for (const file of trackedFiles) {
  if (/\.(aff|dic)$/.test(file)) {
    failures.push(`${file}: hunspell dictionary data must be runtime-fetched, never committed (AGENTS.md hard rule 5).`);
  }
}

if (failures.length > 0) {
  console.error("check-deps-policy failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`check-deps-policy passed: ${manifestPaths.length} manifests, lockfile, and tracked files are clean.`);

function walkFiles(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const path = join(directory, entry.name);
    const isDirectory = entry.isSymbolicLink() ? statSync(path).isDirectory() : entry.isDirectory();
    if (isDirectory) {
      files.push(...walkFiles(path));
    } else {
      files.push(path);
    }
  }
  return files;
}

#!/usr/bin/env node
/**
 * Enforces AGENTS.md hard rules 4 and 5 mechanically:
 * - ToS-restricted Korean spellcheck endpoints (hanspell family, Pusan/Naver/
 *   Daum scrapers) must never appear as dependencies.
 * - GPL-3.0 spellcheck-ko dictionary data (.aff/.dic) must never be vendored
 *   into the Apache-2.0 packages (runtime-fetched only).
 * - If kiwi-nlp (LGPL) is a dependency, its license must be documented.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";

const root = resolve(new URL("..", import.meta.url).pathname);
const failures = [];

const DENYLIST = ["hanspell", "py-hanspell", "hanspell-cli", "pusan-speller", "naver-speller", "daum-speller"];

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

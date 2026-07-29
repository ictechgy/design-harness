#!/usr/bin/env node

import {
  readFileSync,
  readdirSync,
  statSync
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const failures = [];
const packageJson = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8")
);
const expectedScripts = {
  "validate:korean-register":
    "node scripts/korean-register/validate.mjs && node scripts/korean-register/analyzer-regressions.mjs && node scripts/korean-register/publication-regressions.mjs && node scripts/korean-register/validate-regressions.mjs",
  "check:korean-register-policy":
    "node scripts/check-korean-register-policy.mjs",
  "calibrate:korean-register":
    "pnpm --filter @design-harness/copy-audit build && node scripts/korean-register/run.mjs"
};
for (const [name, expected] of Object.entries(expectedScripts)) {
  if (packageJson.scripts?.[name] !== expected) {
    failures.push(`${name} command drifted`);
  }
}
if (
  packageJson.private !== true
  || !packageJson.scripts?.validate.includes(
    "pnpm check:korean-register-policy"
  )
  || !packageJson.scripts?.["validate:calibration-datasets"].includes(
    "pnpm validate:korean-register"
  )
) {
  failures.push("root-private validation wiring drifted");
}

for (const path of regularFiles(
  resolve(root, "examples/calibration-datasets/korean-register")
)) {
  if (/\.(?:mdl|morph|wasm|bin|zip|tar|gz)$/i.test(path)) {
    failures.push(`${relative(root, path)} contains a forbidden model/binary asset`);
  }
}
for (const path of regularFiles(resolve(root, "scripts/korean-register"))) {
  const source = readFileSync(path, "utf8");
  if (
    /\bfetch\s*\(|node:(?:child_process|http|https|net|tls)|from\s+["'](?:kiwi-nlp|@design-harness\/cli|@design-harness\/visual-audit)["']/u
      .test(source)
  ) {
    failures.push(`${relative(root, path)} introduces a forbidden network/provider/product path`);
  }
}
for (const packageName of [
  "core",
  "copy-audit",
  "visual-audit",
  "cli"
]) {
  const sourceRoot = resolve(root, "packages", packageName, "src");
  for (const path of regularFiles(sourceRoot)) {
    const source = readFileSync(path, "utf8");
    if (
      /korean-register-evidence-v1|calibration-datasets\/korean-register/u
        .test(source)
    ) {
      failures.push(`${relative(root, path)} imports or names the calibration lane`);
    }
  }
}

if (failures.length > 0) {
  console.error("check-korean-register-policy failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}
console.log(
  "check-korean-register-policy passed: browserless calibration stays root-only, offline, aggregate-only, and model-asset-free."
);

function regularFiles(start) {
  const output = [];
  for (const entry of readdirSync(start, { withFileTypes: true })) {
    const path = join(start, entry.name);
    if (entry.isSymbolicLink()) {
      failures.push(`${relative(root, path)} must not be a symlink`);
    } else if (entry.isDirectory()) {
      output.push(...regularFiles(path));
    } else if (entry.isFile() && statSync(path).isFile()) {
      output.push(path);
    } else {
      failures.push(`${relative(root, path)} must be a regular file or directory`);
    }
  }
  return output;
}

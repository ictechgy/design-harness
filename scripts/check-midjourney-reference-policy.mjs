#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { basename, posix } from "node:path";
import { spawnSync } from "node:child_process";

const gitResult = spawnSync("git", ["ls-files"], { encoding: "utf8" });
if (gitResult.status !== 0) {
  console.error(gitResult.stderr.trim());
  process.exit(gitResult.status ?? 1);
}

const trackedFiles = gitResult.stdout.split(/\r?\n/).filter(Boolean);
const errors = [];
const policyScriptPath = "scripts/check-midjourney-reference-policy.mjs";
const calibrationDatasetPrefix = "examples/calibration-datasets/midjourney-reference-lab/";
const approvedAssetsPrefix = `${calibrationDatasetPrefix}approved-assets/`;
const imageAssetPattern = /\.(png|jpe?g|webp|gif)$/i;
const forbiddenRuntimePatterns = [
  /\bMIDJOURNEY_API_KEY\b/i,
  /\bMIDJOURNEY_TOKEN\b/i,
  /\bDISCORD_TOKEN\b/i,
  /\bDISCORD_BOT_TOKEN\b/i,
  /discord(?:app)?\.com\/api/i,
  /api\.midjourney/i,
  /midjourney\.com\/api/i,
  /@discordjs\b/i,
  /discord\.js\b/i,
];
const approvedAssetPaths = collectApprovedAssetPaths(trackedFiles);

function collectApprovedAssetPaths(files) {
  const paths = new Set();
  for (const file of files) {
    if (!file.startsWith(calibrationDatasetPrefix) || !file.endsWith(".jsonl")) {
      continue;
    }

    const lines = readFileSync(file, "utf8").split(/\r?\n/).filter((line) => line.trim().length > 0);
    lines.forEach((line, index) => {
      const lineNumber = index + 1;
      try {
        const record = JSON.parse(line);
        if (record.commitPolicy === "asset-approved" && record.rightsReview?.status === "approved" && typeof record.approvedAssetPath === "string") {
          paths.add(posix.normalize(record.approvedAssetPath));
        }
      } catch (error) {
        errors.push(`invalid JSON while reading approved asset policy in ${file}:${lineNumber}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }

  return paths;
}

for (const file of trackedFiles) {
  if (file.startsWith("datasets/midjourney-reference-lab/local-assets/")) {
    errors.push(`generated local asset is tracked: ${file}`);
  }

  if (file.startsWith(calibrationDatasetPrefix) && imageAssetPattern.test(file)) {
    if (file.startsWith(approvedAssetsPrefix)) {
      if (!approvedAssetPaths.has(file)) {
        errors.push(`approved calibration image asset lacks an approved manifest record: ${file}`);
      }
    } else {
      errors.push(`generated calibration image asset is tracked outside approved-assets: ${file}`);
    }
  }

  if (basename(file) === "package.json") {
    const pkg = JSON.parse(readFileSync(file, "utf8"));
    const dependencyNames = [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
      ...Object.keys(pkg.optionalDependencies ?? {}),
      ...Object.keys(pkg.peerDependencies ?? {}),
    ];
    for (const dependency of dependencyNames) {
      if (/midjourney|discord/i.test(dependency)) {
        errors.push(`Midjourney/Discord runtime dependency is not allowed in ${file}: ${dependency}`);
      }
    }
  }

  if (
    file !== policyScriptPath &&
    (file === "package.json" || file === "pnpm-lock.yaml" || file.startsWith("packages/") || file.startsWith("scripts/") || file.startsWith(".github/"))
  ) {
    const content = readFileSync(file, "utf8");
    for (const pattern of forbiddenRuntimePatterns) {
      if (pattern.test(content)) {
        errors.push(`forbidden Midjourney/Discord runtime pattern ${pattern} in ${file}`);
      }
    }
  }
}

if (errors.length > 0) {
  console.error("Invalid Midjourney Reference Lab policy state:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("Validated Midjourney Reference Lab no-integration policy.");

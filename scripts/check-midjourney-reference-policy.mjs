#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
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
const referenceSessionImplementationPaths = [
  "scripts/reference-session-lib.mjs",
  "scripts/reference-session.mjs"
];
const referenceSessionAllPaths = [
  ...referenceSessionImplementationPaths,
  "scripts/reference-session-regressions.mjs"
];
const forbiddenReferenceSessionDependencies = new Set([
  "canvas",
  "image-js",
  "jimp",
  "onnxruntime-node",
  "onnxruntime-web",
  "sharp",
  "tesseract.js"
]);
const forbiddenReferenceSessionSourcePatterns = [
  /\bfetch\s*\(/u,
  /\bXMLHttpRequest\b/u,
  /\bWebSocket\b/u,
  /node:(?:http|https|net|tls|dns)\b/u,
  /\b(?:https?|wss?):\/\//u,
  /\b(?:playwright|puppeteer)\b/u,
  /\b(?:tesseract|onnxruntime|sharp|jimp|canvas|image-js)\b/iu,
  /\bdesign-guide\.yaml\b/u,
  /packages\/(?:core|copy-audit|visual-audit|cli)\//u
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
      if (forbiddenReferenceSessionDependencies.has(dependency)) {
        errors.push(`reference-session image analysis/decoder dependency is not allowed in ${file}: ${dependency}`);
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

for (const file of referenceSessionImplementationPaths) {
  if (!existsSync(file)) {
    errors.push(`required repo-local reference-session implementation is missing: ${file}`);
    continue;
  }
  const content = readFileSync(file, "utf8");
  const importSpecifiers = [
    ...content.matchAll(/\bfrom\s+["']([^"']+)["']/gu),
    ...content.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu)
  ].map((match) => match[1]);
  for (const specifier of importSpecifiers) {
    if (
      !specifier.startsWith("node:")
      && !(file === "scripts/reference-session.mjs" && specifier === "./reference-session-lib.mjs")
    ) {
      errors.push(`reference-session implementation import is outside the Node-built-in/local boundary in ${file}: ${specifier}`);
    }
  }
  for (const pattern of forbiddenReferenceSessionSourcePatterns) {
    if (pattern.test(content)) {
      errors.push(`forbidden reference-session analysis/network/guide pattern ${pattern} in ${file}`);
    }
  }
}

for (const file of referenceSessionAllPaths) {
  if (!existsSync(file)) {
    errors.push(`required reference-session file is missing: ${file}`);
  }
}

for (const file of trackedFiles.filter((candidate) => candidate.startsWith("packages/"))) {
  if (/\breference(?::|-)session\b/iu.test(readFileSync(file, "utf8"))) {
    errors.push(`reference-session helper leaked into a public package surface: ${file}`);
  }
}

const rootPackage = JSON.parse(readFileSync("package.json", "utf8"));
if (rootPackage.private !== true) {
  errors.push("reference-session helper requires the root package to remain private");
}
if (
  rootPackage.scripts?.["reference:session"] !== "node scripts/reference-session.mjs"
  || rootPackage.scripts?.["check:reference-session"] !== "node scripts/reference-session-regressions.mjs"
) {
  errors.push("root package reference-session commands do not match the repo-local contract");
}
if (/\breference(?::|-)session\b/iu.test(readFileSync("README.md", "utf8"))) {
  errors.push("reference-session helper must not appear in the public root README");
}

if (errors.length > 0) {
  console.error("Invalid Midjourney Reference Lab policy state:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("Validated Midjourney Reference Lab no-integration policy.");

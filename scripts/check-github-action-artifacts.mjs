import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const exactTriggerBlock = [
  "on:",
  "  workflow_dispatch:",
  "  push:",
  "    branches:",
  "      - main",
  "  pull_request:"
].join("\n");

function extractTriggerBlock(source, label) {
  const lines = source.split(/\r?\n/);
  const onIndexes = lines.flatMap((line, index) =>
    /^on:[ \t]*(?:#.*)?$/.test(line) ? [index] : []
  );
  if (onIndexes.length !== 1) {
    throw new Error(`${label} must contain exactly one top-level on: block.`);
  }

  const block = [];
  for (let index = onIndexes[0]; index < lines.length; index += 1) {
    const line = lines[index];
    if (index > onIndexes[0] && !/^\s*(?:#.*)?$/.test(line) && /^\S/.test(line)) {
      break;
    }
    const normalized = line.replace(/\s+#.*$/, "").trimEnd();
    if (normalized !== "" && !/^\s*#/.test(normalized)) {
      block.push(normalized);
    }
  }
  return block.join("\n");
}

function assertExactTriggerPolicy(source, label) {
  const actualTriggerBlock = extractTriggerBlock(source, label);
  if (actualTriggerBlock !== exactTriggerBlock) {
    throw new Error(
      `${label} must trigger only on workflow_dispatch, pull_request, and pushes to main.\n` +
        `Expected:\n${exactTriggerBlock}\nFound:\n${actualTriggerBlock}`
    );
  }
}

function runTriggerPolicyGuardRegressions() {
  const fixture = `${exactTriggerBlock}\n\npermissions:\n  contents: read\n`;
  assertExactTriggerPolicy(fixture, "Trigger policy guard fixture");

  const mutations = [
    ["an extra push branch", (source) => source.replace("      - main", "      - main\n      - codex/**")],
    ["an extra event", (source) => source.replace("  pull_request:", "  pull_request:\n  schedule:")],
    [
      "a pull-request branch filter",
      (source) => source.replace("  pull_request:", "  pull_request:\n    branches:\n      - main")
    ],
    ["a missing manual trigger", (source) => source.replace("  workflow_dispatch:\n", "")]
  ];

  for (const [label, mutate] of mutations) {
    const mutated = mutate(fixture);
    try {
      assertExactTriggerPolicy(mutated, `Mutation fixture with ${label}`);
    } catch {
      continue;
    }
    throw new Error(`Trigger policy guard regression: accepted ${label}.`);
  }
}

runTriggerPolicyGuardRegressions();

const workflowPath = resolve(".github/workflows/ci.yml");
const workflow = await readFile(workflowPath, "utf8");
assertExactTriggerPolicy(workflow, "GitHub Actions CI workflow");

const rootManifest = JSON.parse(await readFile(resolve("package.json"), "utf8"));
const packedLoopScript = rootManifest.scripts?.["smoke:packed-loop"];
const releaseCheckScript = rootManifest.scripts?.["release:check"];
if (packedLoopScript !== "node scripts/verify-packed-cli.mjs --positive-loop") {
  throw new Error("smoke:packed-loop must select the explicit positive verifier mode.");
}
if (typeof releaseCheckScript !== "string" || releaseCheckScript.includes("smoke:packed-loop")) {
  throw new Error("release:check must remain browserless and exclude smoke:packed-loop.");
}

const requiredFragments = [
  "pnpm release:check",
  "playwright install --with-deps chromium",
  "pnpm build",
  "pnpm smoke:example",
  "pnpm smoke:copy",
  "pnpm smoke:loop",
  "pnpm smoke:packed-loop",
  "pnpm calibrate:fixtures",
  "actions/upload-artifact@v4",
  "if: always()",
  "name: design-harness-example-smoke",
  "runs/example-smoke",
  "runs/copy-smoke",
  "runs/loop-smoke",
  "runs/packed-loop",
  "runs/calibration",
  "if-no-files-found: warn"
];

const missing = requiredFragments.filter((fragment) => !workflow.includes(fragment));
if (missing.length > 0) {
  throw new Error(`Missing required GitHub Actions artifact fragment(s): ${missing.join(", ")}`);
}

const uploadIndex = workflow.indexOf("actions/upload-artifact@v4");
const browserInstallIndex = workflow.indexOf("playwright install --with-deps chromium");
const buildIndex = workflow.indexOf("pnpm build");
const packedLoopIndex = workflow.indexOf("pnpm smoke:packed-loop");
const lastAuditIndex = Math.max(
  workflow.indexOf("pnpm smoke:example"),
  workflow.indexOf("pnpm smoke:copy"),
  workflow.indexOf("pnpm smoke:loop"),
  workflow.indexOf("pnpm smoke:packed-loop"),
  workflow.indexOf("pnpm calibrate:fixtures")
);
if (packedLoopIndex < browserInstallIndex || packedLoopIndex < buildIndex) {
  throw new Error("Packed-loop smoke must run after Chromium installation and the workspace build.");
}
if (uploadIndex < lastAuditIndex) {
  throw new Error("Artifact upload step must run after the example, copy, loop, packed-loop, and calibration audit steps.");
}

console.log("Validated GitHub Actions artifact upload scaffold.");

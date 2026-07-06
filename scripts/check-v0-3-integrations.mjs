#!/usr/bin/env node
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { renderPrComment } from "./render-pr-comment.mjs";

const MCP_ADAPTER_PATH = fileURLToPath(new URL("./mcp-adapter.mjs", import.meta.url));
const SCENARIO_AUDIT_PATH = fileURLToPath(new URL("./run-scenario-audit.mjs", import.meta.url));

const requiredFiles = [
  "scripts/render-pr-comment.mjs",
  "scripts/run-scenario-audit.mjs",
  "scripts/mcp-adapter.mjs",
  "integrations/mcp/design-harness.tools.json",
  "examples/scenarios/merchant-dashboard.scenarios.json",
  "docs/recipes/pr-comment-bot.md",
  "docs/recipes/scenario-audit.md",
  "docs/integrations/mcp-adapter.md"
];

for (const path of requiredFiles) {
  await readFile(path, "utf8");
}

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
for (const scriptName of ["comment:pr", "scenario:audit", "mcp:tools"]) {
  if (!packageJson.scripts?.[scriptName]) {
    throw new Error(`Missing package script: ${scriptName}`);
  }
}

const manifest = JSON.parse(await readFile("integrations/mcp/design-harness.tools.json", "utf8"));
if (manifest.schemaVersion !== "design-harness-mcp-tools/v1") {
  throw new Error("Unexpected MCP tool manifest schemaVersion.");
}
const toolNames = new Set(manifest.tools?.map((tool) => tool.name));
for (const name of ["design_harness_render_pr_comment", "design_harness_run_scenarios"]) {
  if (!toolNames.has(name)) {
    throw new Error(`Missing MCP adapter tool: ${name}`);
  }
}

const scenarioConfig = JSON.parse(await readFile("examples/scenarios/merchant-dashboard.scenarios.json", "utf8"));
if (scenarioConfig.schemaVersion !== "design-harness-scenarios/v1" || !Array.isArray(scenarioConfig.scenarios) || scenarioConfig.scenarios.length === 0) {
  throw new Error("Example scenario config is invalid.");
}

const comment = renderPrComment({
  runDir: "runs/check",
  auditResult: {
    status: "success",
    advisoryScore: { value: 98, max: 100, band: "strong" },
    findings: [{
      id: "finding-check",
      determinism: "heuristic",
      resultKind: "needs-review",
      severity: "low",
      confidence: "low",
      problem: "Sample heuristic prompt.",
      criterionId: "sample.criterion"
    }]
  },
  report: "# Report\n\nSample report body.",
  maxCharacters: 3000
});

if (!comment.includes("Design Harness") || !comment.includes("Artifact directory") || !comment.includes("finding-check")) {
  throw new Error("PR comment renderer did not include expected sections.");
}

const tempRoot = await mkdtemp(join(process.cwd(), ".tmp-v0-3-integrations-"));
try {
  const runDir = join(tempRoot, "run");
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, "audit.json"), `${JSON.stringify({
    status: "success",
    advisoryScore: { value: 100, max: 100, band: "strong" },
    findings: []
  }, null, 2)}\n`);
  await writeFile(join(runDir, "report.md"), "# Tiny Report\n\nNo findings.\n");

  const adapterResult = spawnSync(process.execPath, [
    MCP_ADAPTER_PATH,
    "call",
    "design_harness_render_pr_comment",
    JSON.stringify({ runDir: relative(process.cwd(), runDir), maxCharacters: 3000 })
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 1_000_000
  });

  if (adapterResult.status !== 0) {
    throw new Error(`MCP adapter call failed: ${adapterResult.stderr || adapterResult.stdout}`);
  }
  const adapterResponse = JSON.parse(adapterResult.stdout);
  if (!adapterResponse.content?.includes("Design Harness") || !adapterResponse.content.includes("Tiny Report")) {
    throw new Error("MCP adapter call did not render the expected PR comment content.");
  }

  const rejectedAdapterPath = spawnSync(process.execPath, [
    MCP_ADAPTER_PATH,
    "call",
    "design_harness_render_pr_comment",
    JSON.stringify({ runDir: "../outside" })
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 1_000_000
  });
  if (rejectedAdapterPath.status === 0 || !rejectedAdapterPath.stderr.includes("workspace root")) {
    throw new Error("MCP adapter did not reject runDir traversal.");
  }

  const rejectedScenarioPath = spawnSync(process.execPath, [
    SCENARIO_AUDIT_PATH,
    "--config",
    "../outside.json",
    "--out",
    "runs/scenarios/rejected"
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 1_000_000
  });
  if (rejectedScenarioPath.status === 0 || !rejectedScenarioPath.stderr.includes("workspace root")) {
    throw new Error("Scenario audit did not reject configPath traversal.");
  }
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

for (const [path, token] of [
  ["docs/recipes/github-actions.md", "render-pr-comment.mjs"],
  ["docs/recipes/pr-comment-bot.md", "comment:pr"],
  ["docs/recipes/scenario-audit.md", "scenario:audit"],
  ["docs/integrations/mcp-adapter.md", "mcp-adapter.mjs"]
]) {
  const content = await readFile(path, "utf8");
  if (!content.includes(token)) {
    throw new Error(`${path} does not mention ${token}.`);
  }
}

console.log("Validated v0.3 integration scaffolding.");

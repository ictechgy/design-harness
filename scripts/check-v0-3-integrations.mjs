#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { renderPrComment } from "./render-pr-comment.mjs";

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

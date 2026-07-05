#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { renderPrCommentFromRunDir } from "./render-pr-comment.mjs";

const MANIFEST_PATH = fileURLToPath(new URL("../integrations/mcp/design-harness.tools.json", import.meta.url));
const SCENARIO_SCRIPT = fileURLToPath(new URL("./run-scenario-audit.mjs", import.meta.url));

async function loadManifest() {
  return JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
}

async function listTools() {
  const manifest = await loadManifest();
  return manifest.tools;
}

async function callTool(name, input) {
  if (name === "design_harness_render_pr_comment") {
    return {
      content: await renderPrCommentFromRunDir({
        runDir: requireString(input.runDir, "runDir"),
        maxCharacters: input.maxCharacters
      })
    };
  }

  if (name === "design_harness_run_scenarios") {
    const result = spawnSync(process.execPath, [
      SCENARIO_SCRIPT,
      "--config",
      requireString(input.configPath, "configPath"),
      "--out",
      requireString(input.outDir, "outDir")
    ], {
      encoding: "utf8",
      cwd: process.cwd()
    });
    return {
      exitCode: result.status ?? 1,
      stdout: result.stdout,
      stderr: result.stderr
    };
  }

  throw new Error(`Unknown Design Harness MCP adapter tool: ${name}`);
}

function requireString(value, fieldName) {
  if (!value || typeof value !== "string") {
    throw new Error(`Missing required string input: ${fieldName}`);
  }
  return value;
}

async function main(argv) {
  const [command, name, rawInput] = argv;
  if (command === "list-tools") {
    console.log(JSON.stringify(await listTools(), null, 2));
    return;
  }

  if (command === "call") {
    if (!name) {
      throw new Error("Usage: node scripts/mcp-adapter.mjs call <tool-name> <json-input>");
    }
    const input = rawInput ? JSON.parse(rawInput) : {};
    console.log(JSON.stringify(await callTool(name, input), null, 2));
    return;
  }

  throw new Error("Usage: node scripts/mcp-adapter.mjs list-tools | call <tool-name> <json-input>");
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

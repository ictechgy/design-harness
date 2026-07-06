#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolveWorkspacePath, tailText } from "../packages/core/dist/index.js";
import { renderPrCommentFromRunDir } from "./render-pr-comment.mjs";

const MANIFEST_PATH = fileURLToPath(new URL("../integrations/mcp/design-harness.tools.json", import.meta.url));
const SCENARIO_SCRIPT = fileURLToPath(new URL("./run-scenario-audit.mjs", import.meta.url));
const SCENARIO_TOOL_TIMEOUT_MS = 130_000;
const CHILD_MAX_BUFFER_BYTES = 1_000_000;
const OUTPUT_TAIL_CHARACTERS = 12_000;

async function loadManifest() {
  return JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
}

async function listTools() {
  const manifest = await loadManifest();
  return manifest.tools;
}

async function callTool(name, input) {
  if (name === "design_harness_render_pr_comment") {
    const runDir = resolveWorkspacePath(requireString(input.runDir, "runDir"), { fieldName: "runDir" });
    return {
      content: await renderPrCommentFromRunDir({
        runDir: runDir.absolutePath,
        displayRunDir: runDir.relativePath,
        maxCharacters: optionalIntegerInRange(input.maxCharacters, "maxCharacters", 1000, 60_000)
      })
    };
  }

  if (name === "design_harness_run_scenarios") {
    const configPath = resolveWorkspacePath(requireString(input.configPath, "configPath"), { fieldName: "configPath" });
    const outDir = resolveWorkspacePath(requireString(input.outDir, "outDir"), { fieldName: "outDir" });
    const result = spawnSync(process.execPath, [
      SCENARIO_SCRIPT,
      "--config",
      configPath.relativePath,
      "--out",
      outDir.relativePath
    ], {
      encoding: "utf8",
      cwd: process.cwd(),
      timeout: SCENARIO_TOOL_TIMEOUT_MS,
      maxBuffer: CHILD_MAX_BUFFER_BYTES
    });
    return {
      exitCode: result.status ?? 1,
      timedOut: result.error?.code === "ETIMEDOUT",
      stdout: tailText(result.stdout, OUTPUT_TAIL_CHARACTERS),
      stderr: tailText(result.stderr, OUTPUT_TAIL_CHARACTERS)
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

function optionalIntegerInRange(value, fieldName, min, max) {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Invalid ${fieldName}. Use an integer from ${min} to ${max}.`);
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

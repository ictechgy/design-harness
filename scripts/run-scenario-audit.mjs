#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertLocalHttpUrl, resolveWorkspacePath, tailText } from "../packages/core/dist/index.js";

const CLI_PATH = fileURLToPath(new URL("../packages/cli/dist/index.js", import.meta.url));
const CHILD_TIMEOUT_GRACE_MS = 5_000;
const CHILD_MAX_BUFFER_BYTES = 1_000_000;
const OUTPUT_TAIL_CHARACTERS = 12_000;

export async function runScenarioAudit(options) {
  const configPath = resolveWorkspacePath(options.configPath, { fieldName: "configPath" });
  const outDir = resolveWorkspacePath(options.outDir, { fieldName: "outDir" });
  const config = JSON.parse(await readFile(configPath.absolutePath, "utf8"));
  validateScenarioConfig(config);
  await mkdir(outDir.absolutePath, { recursive: true });

  if (!existsSync(CLI_PATH)) {
    throw new Error("Design Harness CLI dist is missing. Run `pnpm build` before running scenario audits.");
  }

  const summary = {
    schemaVersion: "design-harness-scenario-summary/v1",
    name: config.name,
    startedAt: new Date().toISOString(),
    outDir: outDir.relativePath,
    scenarios: []
  };

  for (const scenario of config.scenarios) {
    const scenarioDirectoryName = sanitizeId(scenario.id);
    const scenarioOutDir = join(outDir.absolutePath, scenarioDirectoryName);
    const scenarioOutDirRelative = join(outDir.relativePath, scenarioDirectoryName);
    await mkdir(scenarioOutDir, { recursive: true });
    const args = [
      CLI_PATH,
      "audit",
      "--url",
      assertLocalHttpUrl(scenario.url),
      "--out",
      scenarioOutDir
    ];
    if (scenario.timeoutMs) {
      args.push("--timeout-ms", String(scenario.timeoutMs));
    }
    if (scenario.allowPartial) {
      args.push("--allow-partial");
    }

    const result = spawnSync(process.execPath, args, {
      encoding: "utf8",
      cwd: process.cwd(),
      timeout: childTimeoutForScenario(scenario),
      maxBuffer: CHILD_MAX_BUFFER_BYTES
    });
    const auditPath = join(scenarioOutDir, "audit.json");
    const auditResult = existsSync(auditPath) ? JSON.parse(await readFile(auditPath, "utf8")) : undefined;
    summary.scenarios.push({
      id: scenario.id,
      name: scenario.name ?? scenario.id,
      url: scenario.url,
      outDir: scenarioOutDirRelative,
      exitCode: result.status ?? 1,
      timedOut: result.error?.code === "ETIMEDOUT",
      status: auditResult?.status ?? "failed",
      findingCount: Array.isArray(auditResult?.findings) ? auditResult.findings.length : 0,
      failedChecks: auditResult?.failedChecks ?? [],
      stdout: tailText(result.stdout.trim(), OUTPUT_TAIL_CHARACTERS),
      stderr: tailText(result.stderr.trim(), OUTPUT_TAIL_CHARACTERS)
    });
  }

  summary.finishedAt = new Date().toISOString();
  summary.status = summary.scenarios.every((scenario) => scenario.exitCode === 0) ? "success" : "failed";
  await writeFile(join(outDir.absolutePath, "scenario-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(join(outDir.absolutePath, "scenario-report.md"), `${renderScenarioReport(summary)}\n`);
  return summary;
}

function validateScenarioConfig(config) {
  if (config?.schemaVersion !== "design-harness-scenarios/v1") {
    throw new Error("Scenario config must use schemaVersion design-harness-scenarios/v1.");
  }
  if (!config.name || typeof config.name !== "string") {
    throw new Error("Scenario config requires a string name.");
  }
  if (!Array.isArray(config.scenarios) || config.scenarios.length === 0) {
    throw new Error("Scenario config requires at least one scenario.");
  }

  const directoryNames = new Set();
  for (const scenario of config.scenarios) {
    if (!scenario.id || typeof scenario.id !== "string") {
      throw new Error("Each scenario requires a string id.");
    }
    const directoryName = sanitizeId(scenario.id);
    if (directoryNames.has(directoryName)) {
      throw new Error(`Scenario id resolves to a duplicate output directory: ${scenario.id}`);
    }
    directoryNames.add(directoryName);
    assertLocalHttpUrl(scenario.url);
    if (scenario.timeoutMs !== undefined && (!Number.isInteger(scenario.timeoutMs) || scenario.timeoutMs < 100 || scenario.timeoutMs > 120_000)) {
      throw new Error(`Scenario ${scenario.id} has invalid timeoutMs.`);
    }
  }
}

function childTimeoutForScenario(scenario) {
  return (scenario.timeoutMs ?? 30_000) + CHILD_TIMEOUT_GRACE_MS;
}

function renderScenarioReport(summary) {
  const rows = summary.scenarios.map((scenario) => {
    return `| ${escapeTableCell(scenario.id)} | ${escapeTableCell(scenario.status)} | ${scenario.exitCode} | ${scenario.findingCount} | \`${relativeArtifactPath(scenario.outDir)}\` |`;
  });
  return [
    "# Design Harness Scenario Audit",
    "",
    `Scenario set: \`${summary.name}\``,
    `Status: \`${summary.status}\``,
    "",
    "| Scenario | Audit Status | Exit Code | Findings | Artifacts |",
    "| --- | --- | ---: | ---: | --- |",
    ...rows
  ].join("\n");
}

function escapeTableCell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function relativeArtifactPath(value) {
  return value.replace(`${process.cwd()}/`, "");
}

function sanitizeId(value) {
  const sanitized = value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!sanitized) {
    throw new Error(`Scenario id cannot be converted to a directory name: ${value}`);
  }
  return sanitized;
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${token}`);
    }
    values.set(token.slice(2), value);
    index += 1;
  }

  const configPath = values.get("config");
  const outDir = values.get("out");
  if (!configPath) {
    throw new Error("Missing required --config <file>.");
  }
  if (!outDir) {
    throw new Error("Missing required --out <directory>.");
  }
  return { configPath, outDir };
}

async function main(argv) {
  const summary = await runScenarioAudit(parseArgs(argv));
  console.log(`Scenario audit ${summary.status}: ${summary.outDir}`);
  if (summary.status !== "success") {
    process.exitCode = 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

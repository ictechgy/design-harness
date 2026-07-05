#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_MAX_CHARACTERS = 6000;

export function renderPrComment(input) {
  const maxCharacters = input.maxCharacters ?? DEFAULT_MAX_CHARACTERS;
  const auditResult = input.auditResult;
  const report = input.report ?? "";
  const runDir = input.runDir ?? "runs/design-harness";
  const findings = Array.isArray(auditResult?.findings) ? auditResult.findings : [];
  const deterministic = findings.filter((finding) => finding.determinism === "deterministic" || !finding.determinism);
  const heuristic = findings.filter((finding) => finding.determinism === "heuristic");
  const subjective = findings.filter((finding) => finding.determinism === "subjective");
  const topFindings = findings.slice(0, 8);
  const preview = report.trim() ? truncateMarkdown(report.trim(), Math.max(1200, Math.floor(maxCharacters * 0.45))) : "No report preview was available.";

  const lines = [
    "## Design Harness",
    "",
    `Artifact directory: \`${runDir}\``,
    `Status: \`${auditResult?.status ?? "unknown"}\``,
    `Advisory score: \`${auditResult?.advisoryScore?.value ?? "unknown"}/${auditResult?.advisoryScore?.max ?? 100}\` (${auditResult?.advisoryScore?.band ?? "unknown"})`,
    "",
    "### Finding Summary",
    "",
    "| Kind | Count |",
    "| --- | ---: |",
    `| Deterministic or default | ${deterministic.length} |`,
    `| Heuristic review prompts | ${heuristic.length} |`,
    `| Subjective review prompts | ${subjective.length} |`,
    "",
    "### Top Findings",
    "",
    ...topFindingLines(topFindings),
    "",
    "<details>",
    "<summary>Report preview</summary>",
    "",
    preview,
    "",
    "</details>",
    "",
    "Full audit artifacts should be uploaded with the workflow run."
  ];

  return truncateMarkdown(lines.join("\n"), maxCharacters);
}

export async function renderPrCommentFromRunDir(options) {
  const runDir = options.runDir;
  const auditResult = JSON.parse(await readFile(join(runDir, "audit.json"), "utf8"));
  const report = await readFile(join(runDir, "report.md"), "utf8");
  return renderPrComment({
    auditResult,
    report,
    runDir,
    maxCharacters: options.maxCharacters
  });
}

function topFindingLines(findings) {
  if (findings.length === 0) {
    return ["No findings were emitted."];
  }

  return findings.map((finding) => {
    const kind = finding.determinism ?? "deterministic";
    const criterion = finding.criterionId ? ` Criterion: \`${finding.criterionId}\`.` : "";
    return `- \`${finding.id}\` (${kind}/${finding.resultKind ?? "risk"}, ${finding.severity}/${finding.confidence}): ${finding.problem}${criterion}`;
  });
}

function truncateMarkdown(markdown, maxCharacters) {
  if (markdown.length <= maxCharacters) {
    return markdown;
  }

  return `${markdown.slice(0, Math.max(0, maxCharacters - 32)).trimEnd()}\n\n...truncated for PR comment length`;
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

  const runDir = values.get("run-dir");
  if (!runDir) {
    throw new Error("Missing required --run-dir <directory>");
  }

  const maxCharacters = values.has("max-chars") ? Number(values.get("max-chars")) : DEFAULT_MAX_CHARACTERS;
  if (!Number.isInteger(maxCharacters) || maxCharacters < 1000 || maxCharacters > 60_000) {
    throw new Error("Invalid --max-chars. Use an integer from 1000 to 60000.");
  }

  return {
    runDir,
    out: values.get("out"),
    maxCharacters
  };
}

async function main(argv) {
  const args = parseArgs(argv);
  const comment = await renderPrCommentFromRunDir(args);
  if (args.out) {
    await writeFile(args.out, `${comment}\n`);
  } else {
    process.stdout.write(`${comment}\n`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

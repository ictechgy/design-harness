#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { BENCHMARK_ROOT, MATRIX } from "./contract.mjs";

export const COMPLETION_PHRASE =
  "obedience-v1 descriptive snapshot complete";
export const BLOCKED_CLAIMS_STATEMENT =
  "Comparative, statistical, provider/model-ranking, general-obedience, and “reins” claims remain blocked pending a separately scheduled repeated/two-case benchmark.";
export const LIMITATIONS = Object.freeze([
  "One project-authored synthetic fixture.",
  "One run per cell and no variance estimate.",
  "Snapshot-specific CLI and resolved model versions.",
  "Provider-specific project-instruction and skill discovery.",
  "Only defects detectable by the pinned Harness checks.",
  "Advisory score and band are formula-bound secondary measurements.",
  "No causal comparison among delivery mechanisms, executors, or models.",
  "No generalization to real applications, general agent obedience, design quality, accessibility, or standards compliance."
]);

export function renderReport(results) {
  const cells = Array.isArray(results?.cells) ? results.cells : [];
  const aggregate = results?.aggregate ?? {};
  const comparability = results?.comparability ?? {};
  const allOperationallyCompleted =
    cells.length === MATRIX.length &&
    cells.every((cell) => cell?.terminalStatus === "completed");
  const completionLine = allOperationallyCompleted
    ? COMPLETION_PHRASE
    : "obedience-v1 descriptive snapshot incomplete";

  const lines = [
    "# Obedience v1 descriptive snapshot",
    "",
    `> ${completionLine}`,
    "",
    BLOCKED_CLAIMS_STATEMENT,
    "",
    "## Scope",
    "",
    "This public record contains one fresh execution for each fixed cell against",
    "one project-authored synthetic fixture. It describes whether each single",
    "executor pass closed the detectable deterministic failures and preserved the",
    "declared interface structure. It does not estimate treatment effects or rank",
    "executors, models, or delivery mechanisms.",
    "",
    `- Snapshot date: ${display(results?.snapshotDate)}`,
    `- Recorded at: ${display(results?.recordedAt)}`,
    `- Cells present: ${display(aggregate.totalCellCount)} / ${MATRIX.length}`,
    `- Operationally completed cells: ${display(aggregate.completedCellCount)} / ${MATRIX.length}`,
    "",
    "## Bounded aggregate",
    "",
    "| Measurement | Count |",
    "|---|---:|",
    `| Cells | ${display(aggregate.totalCellCount)} |`,
    `| Operationally completed | ${display(aggregate.completedCellCount)} |`,
    `| Deterministic closure | ${display(aggregate.deterministicClosureCellCount)} |`,
    `| Preservation pass | ${display(aggregate.preservationPassCellCount)} |`,
    `| Closure and preservation | ${display(aggregate.passedBothCellCount)} |`,
    `| Cells with an allowed operational retry | ${display(aggregate.operationalRetryCellCount)} |`,
    `| Cells with newly introduced deterministic failures | ${display(aggregate.cellsWithNewFailures)} |`,
    `| Initial deterministic failures | ${display(aggregate.initialDeterministicFailureCount)} |`,
    `| Final deterministic failures | ${display(aggregate.finalDeterministicFailureCount)} |`,
    `| Closed deterministic failures | ${display(aggregate.closedDeterministicFailureCount)} |`,
    `| Newly introduced deterministic failures | ${display(aggregate.newlyIntroducedDeterministicFailureCount)} |`,
    `| Aggregate closure rate | ${formatPercent(aggregate.closureRate)} |`,
    "",
    "Terminal outcomes stay in the table and denominator. A poor repair is a",
    "measurement result, not a reason to omit or rerun a cell.",
    "",
    "## Per-cell results",
    "",
    "| Cell | Executor and resolved model | Delivery | Terminal | Attempts | Deterministic failures | Closed | New | Preservation | Closure + preservation | Secondary advisory score | Remaining findings |",
    "|---|---|---|---|---:|---:|---:|---:|---|---|---|---|"
  ];

  for (const cell of cells) {
    const primary = cell?.primary ?? {};
    const secondary = cell?.secondary ?? {};
    lines.push(
      [
        `| \`${escapeTable(cell?.id)}\``,
        `${escapeTable(cell?.executorLabel)}; \`${escapeTable(cell?.executor?.requestedModel)}\` → \`${escapeTable(cell?.executor?.resolvedModel)}\``,
        `\`${escapeTable(cell?.mechanism)}\``,
        `\`${escapeTable(cell?.terminalStatus)}\``,
        display(cell?.attempts?.length),
        `${display(primary.initialDeterministicFailureCount)} → ${display(primary.finalDeterministicFailureCount)}`,
        `${display(primary.closedDeterministicFailureCount)} (${formatPercent(primary.closureRate)})`,
        display(primary.newlyIntroducedDeterministicFailureCount),
        primary.preservation?.passed ? "pass" : "fail",
        primary.passedBoth ? "yes" : "no",
        `${formatScore(secondary.initial?.advisoryScore)} → ${formatScore(secondary.final?.advisoryScore)}`,
        `${display(secondary.final?.deterministicRiskCount)} deterministic risk; ${display(secondary.final?.heuristicFindingCount)} heuristic; ${display(secondary.final?.needsReviewCount)} needs-review |`
      ].join(" | ")
    );
  }

  lines.push(
    "",
    "The score and band columns are secondary/advisory and formula-bound. They are",
    "not an objective grade and are not comparable with a different scoring",
    "formula.",
    "",
    "## Deterministic-failure identities",
    ""
  );

  for (const cell of cells) {
    lines.push(
      `### \`${cell?.id ?? "missing-cell-id"}\``,
      "",
      `- Initial: ${formatFailures(cell?.primary?.initialDeterministicFailures)}`,
      `- Final: ${formatFailures(cell?.primary?.finalDeterministicFailures)}`,
      `- Closed: ${formatFailures(cell?.primary?.closedDeterministicFailures)}`,
      `- Newly introduced: ${formatFailures(cell?.primary?.newlyIntroducedDeterministicFailures)}`,
      `- Public final source: [\`${basenameOnly(cell?.finalSourcePath)}\`](${relativeLink(cell?.finalSourcePath)})`,
      ""
    );
  }

  lines.push(
    "## Comparability pins",
    "",
    "| Pin | Value |",
    "|---|---|",
    `| Common task SHA-256 | \`${display(comparability.commonTaskSha256)}\` |`,
    `| Fixture SHA-256 | \`${display(comparability.fixtureSha256)}\` |`,
    `| Copy config SHA-256 | \`${display(comparability.copyStyleSha256)}\` |`,
    `| Preservation oracle SHA-256 | \`${display(comparability.preservationOracleSha256)}\` |`,
    `| Protocol SHA-256 | \`${display(comparability.protocolSha256)}\` |`,
    `| Harness build SHA-256 | \`${display(comparability.harnessBuildSha256)}\` |`,
    `| Harness config SHA-256 | \`${display(comparability.harnessConfigSha256)}\` |`,
    `| Audit schema / Harness | \`${display(comparability.auditSchemaVersion)}\` / \`${display(comparability.harnessVersion)}\` |`,
    `| Advisory score formula | \`${display(comparability.scoreFormulaVersion)}\` |`,
    `| Executor pass / final re-audit | ${display(comparability.agentPassCount)} / ${display(comparability.finalReauditCount)} |`,
    "",
    "Only executor/model identity and the predeclared delivery mechanism vary.",
    "Raw commands, transcripts, environment values, credentials, and private",
    "absolute paths are not part of this public record.",
    "",
    "## Limitations",
    ""
  );

  for (const limitation of results?.limitations ?? LIMITATIONS) {
    lines.push(`- ${limitation}`);
  }

  lines.push(
    "",
    "A repeated, two-case, real-application, or positioning experiment is a",
    "separate owner-scheduled milestone.",
    ""
  );

  return lines.join("\n");
}

function formatFailures(failures) {
  if (!Array.isArray(failures) || failures.length === 0) {
    return "none";
  }
  return failures
    .map((failure) => {
      const identity = [
        failure?.criterionId,
        failure?.checkName,
        failure?.viewport,
        failure?.selector
      ]
        .map((value) => String(value ?? ""))
        .join(" / ");
      return `\`${escapeInline(identity)}\` × ${display(failure?.count)}`;
    })
    .join("; ");
}

function formatScore(score) {
  if (!score || typeof score !== "object") {
    return "n/a";
  }
  return `${display(score.value)}/${display(score.max)} (${escapeTable(score.band)})`;
}

function formatPercent(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "n/a";
  }
  return `${(value * 100).toFixed(1)}%`;
}

function display(value) {
  return value === undefined || value === null ? "n/a" : String(value);
}

function escapeTable(value) {
  return display(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function escapeInline(value) {
  return String(value).replaceAll("`", "\\`").replaceAll("\n", " ");
}

function basenameOnly(path) {
  if (typeof path !== "string") {
    return "missing-source";
  }
  return path.split("/").at(-1) ?? "missing-source";
}

function relativeLink(path) {
  if (typeof path !== "string" || !path.startsWith("final-sources/")) {
    return "#missing-source";
  }
  return `./${path}`;
}

async function main() {
  const args = process.argv.slice(2);
  let root = BENCHMARK_ROOT;
  let check = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--benchmark-root") {
      if (!args[index + 1]) {
        throw new Error("--benchmark-root requires a path");
      }
      root = resolve(args[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--check") {
      check = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  const results = JSON.parse(await readFile(join(root, "results.json"), "utf8"));
  const expected = renderReport(results);
  const reportPath = join(root, "report.md");
  if (check) {
    const actual = await readFile(reportPath, "utf8");
    if (actual !== expected) {
      throw new Error(
        "Generated benchmark report is stale; run node scripts/obedience-benchmark/render.mjs"
      );
    }
    console.log("Validated deterministic obedience-v1 report parity.");
    return;
  }
  await writeFile(reportPath, expected, "utf8");
  console.log(`Rendered ${join(root, "report.md")}.`);
}

const isMain =
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

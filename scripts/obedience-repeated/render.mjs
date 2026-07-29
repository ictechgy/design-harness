#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BENCHMARK_ROOT } from "./contract.mjs";
import { renderRepeatedReport } from "./results.mjs";

export async function renderRepeatedBenchmark({
  benchmarkRoot = BENCHMARK_ROOT,
  check = false
} = {}) {
  const root = resolve(benchmarkRoot);
  const results = JSON.parse(
    await readFile(join(root, "results.json"), "utf8")
  );
  const expected = renderRepeatedReport(results);
  const reportPath = join(root, "report.md");
  if (check) {
    const actual = await readFile(reportPath, "utf8");
    if (actual !== expected) {
      throw new Error(
        "Repeated obedience report is stale or not deterministic"
      );
    }
    return;
  }
  await writeFile(reportPath, expected, "utf8");
}

function parseArgs(argv) {
  let benchmarkRoot = BENCHMARK_ROOT;
  let check = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--benchmark-root") {
      benchmarkRoot = argv[index + 1];
      index += 1;
      if (!benchmarkRoot || benchmarkRoot.startsWith("--")) {
        throw new Error("--benchmark-root requires a path");
      }
      continue;
    }
    if (argv[index] === "--check") {
      check = true;
      continue;
    }
    throw new Error(`Unknown argument: ${argv[index]}`);
  }
  return { benchmarkRoot, check };
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isDirectExecution) {
  try {
    const options = parseArgs(process.argv.slice(2));
    await renderRepeatedBenchmark(options);
    console.log(
      options.check
        ? "Validated deterministic repeated obedience report parity."
        : "Rendered repeated obedience report."
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

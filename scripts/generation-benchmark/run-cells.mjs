/**
 * Run every prepared cell through the executor. This is the only step that makes
 * a hosted call.
 *
 * Failures stay visible. A cell that errors, times out, or writes nothing is
 * recorded as incomplete rather than retried into looking successful.
 *
 *   node scripts/generation-benchmark/run-cells.mjs [--only <cellId>] [--timeout-ms N]
 */

import { spawnSync } from "node:child_process";
import { readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  BENCHMARK_ID,
  EXECUTOR,
  GENERATED_FILENAME,
  OUTPUT_ROOT,
  canonicalJson,
  sha256
} from "./contract.mjs";

const DEFAULT_TIMEOUT_MS = 300_000;

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function executorVersion() {
  const result = spawnSync(EXECUTOR.binary, ["--version"], { encoding: "utf8" });
  return (result.stdout ?? "").trim() || (result.stderr ?? "").trim() || "unknown";
}

async function fileInfo(path) {
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size === 0) return null;
    const bytes = await readFile(path, "utf8");
    return { bytes: info.size, sha256: sha256(bytes) };
  } catch {
    return null;
  }
}

/** One cell. Returns a record; never throws for an executor failure. */
export async function runCell(cell, timeoutMs) {
  const prompt = await readFile(resolve(cell.dir, "PROMPT.txt"), "utf8");
  const startedAt = new Date().toISOString();
  const result = spawnSync(
    EXECUTOR.binary,
    ["-p", "--permission-mode", "acceptEdits"],
    { cwd: cell.dir, input: prompt, encoding: "utf8", timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 }
  );
  const output = await fileInfo(resolve(cell.dir, GENERATED_FILENAME));
  return {
    id: cell.id,
    arm: cell.arm,
    generation: cell.generation,
    startedAt,
    finishedAt: new Date().toISOString(),
    exitStatus: result.status,
    timedOut: result.error?.code === "ETIMEDOUT",
    spawnError: result.error ? String(result.error.message) : null,
    stdoutSha256: sha256(result.stdout ?? ""),
    stderrExcerpt: (result.stderr ?? "").slice(0, 600),
    output,
    complete: output !== null
  };
}

async function main() {
  const manifestPath = resolve(OUTPUT_ROOT, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const only = arg("--only");
  const timeoutMs = Number(arg("--timeout-ms", String(DEFAULT_TIMEOUT_MS)));
  const cells = only ? manifest.cells.filter((cell) => cell.id === only) : manifest.cells;
  if (cells.length === 0) throw new Error(`no cell matched ${only}`);

  const version = executorVersion();
  console.log(`${BENCHMARK_ID}: running ${cells.length} cell(s) with ${EXECUTOR.binary} ${version}`);

  const records = [];
  for (const cell of cells) {
    process.stdout.write(`  ${cell.id.padEnd(18)} `);
    const record = await runCell(cell, timeoutMs);
    records.push(record);
    console.log(
      record.complete
        ? `ok   ${record.output.bytes} bytes  ${record.output.sha256.slice(0, 12)}`
        : `INCOMPLETE  exit=${record.exitStatus} timedOut=${record.timedOut}`
    );
  }

  const runPath = resolve(OUTPUT_ROOT, only ? `executions-${only}.json` : "executions.json");
  await writeFile(
    runPath,
    canonicalJson({
      benchmarkId: BENCHMARK_ID,
      executor: { ...EXECUTOR, resolvedVersion: version },
      timeoutMs,
      recordedAt: new Date().toISOString(),
      completeCount: records.filter((record) => record.complete).length,
      totalCount: records.length,
      records
    }),
    "utf8"
  );
  console.log(`  complete: ${records.filter((r) => r.complete).length}/${records.length}`);
  console.log(`  wrote ${runPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}

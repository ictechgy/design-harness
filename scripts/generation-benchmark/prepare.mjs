/**
 * Prepare isolated generation cells. Offline; makes no hosted call.
 *
 * Cells are created OUTSIDE the repository on purpose. If they lived inside it,
 * the executor could discover the project's own AGENTS.md and design-guide.yaml,
 * and the without-pack arm would silently become a with-pack arm.
 *
 *   node scripts/generation-benchmark/prepare.mjs --core <core dist index.js> [--root <dir>]
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  BENCHMARK_ID,
  BRIEF,
  EXECUTOR,
  EXPECTED_CELL_COUNT,
  GENERATED_FILENAME,
  GENERATIONS_PER_ARM,
  LIMITATIONS,
  MANIFEST_SCHEMA_VERSION,
  MATRIX,
  OUTPUT_CONSTRAINTS,
  OUTPUT_ROOT,
  buildPrompt,
  canonicalJson,
  sha256
} from "./contract.mjs";

const PACK_FILENAME = "DESIGN.md";

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

/** Compile the real pack from the example guide. */
async function compilePack(coreDistPath) {
  const core = await import(coreDistPath);
  const guide = core.createExampleDesignGuide();
  const compiled = core.compileDesignGuide(guide);
  return {
    markdown: compiled.markdown,
    profileId: compiled.profileId,
    sourceHash: compiled.sourceHash,
    ruleCount: compiled.rules.length,
    estimatedTokens: compiled.tokenEstimate.estimated,
    markdownSha256: sha256(compiled.markdown)
  };
}

export async function prepare({ coreDistPath, root }) {
  if (!coreDistPath) throw new Error("prepare requires --core <path to packages/core/dist/index.js>");
  const pack = await compilePack(coreDistPath);
  const cellRoot = resolve(root ?? resolve(tmpdir(), `${BENCHMARK_ID}-cells`));

  await rm(cellRoot, { recursive: true, force: true });
  await mkdir(cellRoot, { recursive: true });

  const cells = [];
  for (const cell of MATRIX) {
    const dir = resolve(cellRoot, cell.id);
    await mkdir(dir, { recursive: true });
    const prompt = buildPrompt(cell.arm, PACK_FILENAME);
    await writeFile(resolve(dir, "PROMPT.txt"), prompt, "utf8");
    if (cell.arm === "with-pack") {
      await writeFile(resolve(dir, PACK_FILENAME), pack.markdown, "utf8");
    }
    cells.push({
      ...cell,
      dir,
      promptSha256: sha256(prompt),
      packDelivered: cell.arm === "with-pack",
      expectedOutput: resolve(dir, GENERATED_FILENAME)
    });
  }

  // The two arms must differ in exactly one thing: the pack reference.
  const withPrompt = buildPrompt("with-pack", PACK_FILENAME);
  const withoutPrompt = buildPrompt("without-pack", PACK_FILENAME);
  if (!withoutPrompt.includes(BRIEF) || !withPrompt.includes(BRIEF)) {
    throw new Error("both arms must carry the identical brief");
  }
  for (const rule of OUTPUT_CONSTRAINTS) {
    if (!withPrompt.includes(rule) || !withoutPrompt.includes(rule)) {
      throw new Error(`output constraint missing from an arm: ${rule}`);
    }
  }
  if (withoutPrompt.includes(PACK_FILENAME)) {
    throw new Error("the without-pack prompt must not reference the pack");
  }

  const manifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    benchmarkId: BENCHMARK_ID,
    preparedAt: new Date().toISOString(),
    brief: BRIEF,
    briefSha256: sha256(BRIEF),
    executor: EXECUTOR,
    generationsPerArm: GENERATIONS_PER_ARM,
    expectedCellCount: EXPECTED_CELL_COUNT,
    cellRoot,
    outsideRepository: !cellRoot.startsWith(resolve(OUTPUT_ROOT, "../..")),
    pack: {
      filename: PACK_FILENAME,
      profileId: pack.profileId,
      sourceHash: pack.sourceHash,
      ruleCount: pack.ruleCount,
      estimatedTokens: pack.estimatedTokens,
      markdownSha256: pack.markdownSha256
    },
    promptSha256: {
      "with-pack": sha256(withPrompt),
      "without-pack": sha256(withoutPrompt)
    },
    cells,
    limitations: LIMITATIONS
  };

  await mkdir(OUTPUT_ROOT, { recursive: true });
  await writeFile(resolve(OUTPUT_ROOT, "manifest.json"), canonicalJson(manifest), "utf8");
  return manifest;
}

async function main() {
  const manifest = await prepare({ coreDistPath: arg("--core"), root: arg("--root") });
  console.log(`${BENCHMARK_ID}: prepared ${manifest.cells.length} cells`);
  console.log(`  cell root: ${manifest.cellRoot}`);
  console.log(`  outside repository: ${manifest.outsideRepository}`);
  console.log(
    `  pack: ${manifest.pack.ruleCount} rules, ~${manifest.pack.estimatedTokens} tokens, ` +
      `sha256 ${manifest.pack.markdownSha256.slice(0, 16)}...`
  );
  console.log(`  with-pack prompt:    ${manifest.promptSha256["with-pack"].slice(0, 16)}...`);
  console.log(`  without-pack prompt: ${manifest.promptSha256["without-pack"].slice(0, 16)}...`);
  console.log("  no hosted call was made by this step.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}

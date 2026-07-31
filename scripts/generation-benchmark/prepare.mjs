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
  ARMS,
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
  OFFTARGET_GUIDE_ADDITIONS,
  WIDENED_GUIDE_ADDITIONS,
  buildPrompt,
  canonicalJson,
  sha256
} from "./contract.mjs";

const PACK_FILENAME = "DESIGN.md";

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

/** Compile both packs: the baseline example guide and the ADR-003 widened guide. */
async function compilePacks(coreDistPath) {
  const core = await import(coreDistPath);
  const baseGuide = core.createExampleDesignGuide();
  const widen = (additions) => ({
    ...core.createExampleDesignGuide(),
    primaryTask: {
      statement: additions.primaryTask.statement,
      supportingTasks: [...additions.primaryTask.supportingTasks]
    },
    signatureCommitments: additions.signatureCommitments.map((entry) => ({ ...entry }))
  });
  const widenedGuide = widen(WIDENED_GUIDE_ADDITIONS);
  const offtargetGuide = widen(OFFTARGET_GUIDE_ADDITIONS);
  const describe = (compiled) => ({
    markdown: compiled.markdown,
    profileId: compiled.profileId,
    sourceHash: compiled.sourceHash,
    ruleCount: compiled.rules.length,
    estimatedTokens: compiled.tokenEstimate.estimated,
    markdownSha256: sha256(compiled.markdown)
  });
  return {
    "with-pack": describe(core.compileDesignGuide(baseGuide)),
    "with-widened-pack": describe(core.compileDesignGuide(widenedGuide)),
    "with-offtarget-pack": describe(core.compileDesignGuide(offtargetGuide))
  };
}

export async function prepare({ coreDistPath, root }) {
  if (!coreDistPath) throw new Error("prepare requires --core <path to packages/core/dist/index.js>");
  const packs = await compilePacks(coreDistPath);
  const hashes = new Set(Object.values(packs).map((pack) => pack.markdownSha256));
  if (hashes.size !== Object.keys(packs).length) {
    throw new Error("two packs hash identically; an arm would be a duplicate");
  }
  for (const arm of ["with-widened-pack", "with-offtarget-pack"]) {
    if (packs[arm].ruleCount <= packs["with-pack"].ruleCount) {
      throw new Error(`${arm} must carry more rules than the baseline pack`);
    }
  }
  if (packs["with-widened-pack"].ruleCount !== packs["with-offtarget-pack"].ruleCount) {
    throw new Error("the widened and off-target packs must carry equal rule counts; only the aim may differ");
  }
  const cellRoot = resolve(root ?? resolve(tmpdir(), `${BENCHMARK_ID}-cells`));

  await rm(cellRoot, { recursive: true, force: true });
  await mkdir(cellRoot, { recursive: true });

  const cells = [];
  for (const cell of MATRIX) {
    const dir = resolve(cellRoot, cell.id);
    await mkdir(dir, { recursive: true });
    const prompt = buildPrompt(cell.arm, PACK_FILENAME);
    await writeFile(resolve(dir, "PROMPT.txt"), prompt, "utf8");
    const pack = packs[cell.arm];
    if (pack) {
      await writeFile(resolve(dir, PACK_FILENAME), pack.markdown, "utf8");
    }
    cells.push({
      ...cell,
      dir,
      promptSha256: sha256(prompt),
      packDelivered: pack !== undefined,
      packSha256: pack?.markdownSha256 ?? null,
      expectedOutput: resolve(dir, GENERATED_FILENAME)
    });
  }

  // Every arm must carry the identical brief and identical output constraints.
  const prompts = Object.fromEntries(ARMS.map((arm) => [arm, buildPrompt(arm, PACK_FILENAME)]));
  for (const [arm, prompt] of Object.entries(prompts)) {
    if (!prompt.includes(BRIEF)) throw new Error(`${arm} lost the brief`);
    for (const rule of OUTPUT_CONSTRAINTS) {
      if (!prompt.includes(rule)) throw new Error(`${arm} lost output constraint: ${rule}`);
    }
  }
  if (prompts["without-pack"].includes(PACK_FILENAME)) {
    throw new Error("the without-pack prompt must not reference the pack");
  }
  const packPrompts = new Set(ARMS.filter((arm) => arm !== "without-pack").map((arm) => prompts[arm]));
  if (packPrompts.size !== 1) {
    throw new Error("every pack arm must receive byte-identical prompts; only the pack file may differ");
  }

  const manifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    benchmarkId: BENCHMARK_ID,
    preparedAt: new Date().toISOString(),
    brief: BRIEF,
    briefSha256: sha256(BRIEF),
    executor: EXECUTOR,
    arms: [...ARMS],
    generationsPerArm: GENERATIONS_PER_ARM,
    expectedCellCount: EXPECTED_CELL_COUNT,
    cellRoot,
    outsideRepository: !cellRoot.startsWith(resolve(OUTPUT_ROOT, "../..")),
    packs: Object.fromEntries(
      Object.entries(packs).map(([arm, pack]) => [
        arm,
        {
          filename: PACK_FILENAME,
          profileId: pack.profileId,
          sourceHash: pack.sourceHash,
          ruleCount: pack.ruleCount,
          estimatedTokens: pack.estimatedTokens,
          markdownSha256: pack.markdownSha256
        }
      ])
    ),
    promptSha256: Object.fromEntries(
      Object.entries(prompts).map(([arm, prompt]) => [arm, sha256(prompt)])
    ),
    cells,
    limitations: LIMITATIONS
  };

  await mkdir(OUTPUT_ROOT, { recursive: true });
  await writeFile(resolve(OUTPUT_ROOT, "manifest.json"), canonicalJson(manifest), "utf8");
  return manifest;
}

async function main() {
  const manifest = await prepare({ coreDistPath: arg("--core"), root: arg("--root") });
  console.log(`${BENCHMARK_ID}: prepared ${manifest.cells.length} cells across ${manifest.arms.length} arms`);
  console.log(`  cell root: ${manifest.cellRoot}`);
  console.log(`  outside repository: ${manifest.outsideRepository}`);
  for (const [arm, pack] of Object.entries(manifest.packs)) {
    console.log(
      `  ${arm.padEnd(18)} ${pack.ruleCount} rules, ~${pack.estimatedTokens} tokens, ` +
        `sha256 ${pack.markdownSha256.slice(0, 12)}`
    );
  }
  console.log("  prompts identical across all pack arms:", new Set(Object.values(manifest.promptSha256)).size === 2);
  console.log("  no hosted call was made by this step.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}

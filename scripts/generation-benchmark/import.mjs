/**
 * Import generated cells and measure the two axes separately.
 *
 * axis 1  token-adherence convergence, on pack-pinned dimensions.
 *         Lower distance = arms agree more on declared values.
 *         Expectation: with-pack LOWER than without-pack.
 *
 * axis 2  composition divergence, on pack-pushed dimensions.
 *         Higher distance = compositions differ more from each other.
 *         Expectation: with-pack HIGHER than without-pack.
 *
 * The two are never averaged. A one-sided or null result is reported as such.
 *
 *   node scripts/generation-benchmark/import.mjs
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { DIMENSION_CLASSIFICATION } from "../slop-convergence/pack-confound.mjs";
import { fingerprintDistance, fingerprintSource } from "../slop-convergence/fingerprint.mjs";
import {
  ARMS,
  BENCHMARK_ID,
  GENERATED_FILENAME,
  LIMITATIONS,
  OUTPUT_ROOT,
  RESULT_SCHEMA_VERSION,
  canonicalJson,
  sha256
} from "./contract.mjs";

const PINNED = Object.entries(DIMENSION_CLASSIFICATION)
  .filter(([, kind]) => kind === "pinned")
  .map(([id]) => id);
const PUSHED = Object.entries(DIMENSION_CLASSIFICATION)
  .filter(([, kind]) => kind === "pushed")
  .map(([id]) => id);

const round = (value) => Number(value.toFixed(6));

/** Mean pairwise distance restricted to a dimension subset. */
function subsetPairwise(fingerprints, dimensions) {
  const means = [];
  const perDimension = Object.fromEntries(dimensions.map((id) => [id, 0]));
  for (let i = 0; i < fingerprints.length; i += 1) {
    for (let j = i + 1; j < fingerprints.length; j += 1) {
      const { perDimension: all } = fingerprintDistance(fingerprints[i], fingerprints[j]);
      const values = dimensions.map((id) => all[id]);
      means.push(values.reduce((sum, value) => sum + value, 0) / values.length);
      for (const id of dimensions) perDimension[id] += all[id];
    }
  }
  return {
    pairCount: means.length,
    mean: round(means.reduce((sum, value) => sum + value, 0) / means.length),
    min: round(Math.min(...means)),
    max: round(Math.max(...means)),
    perDimensionMean: Object.fromEntries(
      Object.entries(perDimension).map(([id, total]) => [id, round(total / means.length)])
    )
  };
}

export async function importResults() {
  const manifest = JSON.parse(await readFile(resolve(OUTPUT_ROOT, "manifest.json"), "utf8"));
  const executions = JSON.parse(await readFile(resolve(OUTPUT_ROOT, "executions.json"), "utf8"));

  const incomplete = executions.records.filter((record) => !record.complete).map((r) => r.id);
  if (incomplete.length > 0) {
    throw new Error(`refusing to import an incomplete snapshot; incomplete cells: ${incomplete.join(", ")}`);
  }
  if (executions.records.length !== manifest.expectedCellCount) {
    throw new Error(
      `expected ${manifest.expectedCellCount} executions, found ${executions.records.length}`
    );
  }

  const byArm = {};
  const sources = {};
  for (const arm of ARMS) {
    const cells = manifest.cells.filter((cell) => cell.arm === arm);
    const prints = [];
    for (const cell of cells) {
      const source = await readFile(resolve(cell.dir, GENERATED_FILENAME), "utf8");
      sources[cell.id] = { bytes: source.length, sha256: sha256(source) };
      prints.push(fingerprintSource(source, cell.id));
    }
    byArm[arm] = {
      generations: cells.length,
      tokenAdherenceConvergence: subsetPairwise(prints, PINNED),
      compositionDivergence: subsetPairwise(prints, PUSHED)
    };
  }

  const baseline = byArm["without-pack"];
  const treatments = ARMS.filter((arm) => arm !== "without-pack");

  /** Each treatment arm is compared against the shared no-pack baseline. */
  const axes = {};
  for (const arm of treatments) {
    const pinnedDelta = round(
      byArm[arm].tokenAdherenceConvergence.mean - baseline.tokenAdherenceConvergence.mean
    );
    const pushedDelta = round(
      byArm[arm].compositionDivergence.mean - baseline.compositionDivergence.mean
    );
    axes[arm] = {
      tokenAdherenceConvergence: {
        expectation: "LOWER pairwise distance on pack-pinned dimensions than the no-pack baseline",
        baseline: baseline.tokenAdherenceConvergence.mean,
        arm: byArm[arm].tokenAdherenceConvergence.mean,
        delta: pinnedDelta,
        held: pinnedDelta < 0
      },
      compositionDivergence: {
        expectation: "HIGHER pairwise distance on pack-pushed dimensions than the no-pack baseline",
        baseline: baseline.compositionDivergence.mean,
        arm: byArm[arm].compositionDivergence.mean,
        delta: pushedDelta,
        held: pushedDelta > 0
      }
    };
  }

  const outcomeFor = (arm) => {
    const axis1 = axes[arm].tokenAdherenceConvergence.held;
    const axis2 = axes[arm].compositionDivergence.held;
    return axis1 && axis2
      ? "both-axes-moved-as-expected"
      : axis1
        ? "token-adherence-only"
        : axis2
          ? "composition-only"
          : "neither-axis-moved-as-expected";
  };

  /** Did widening the vocabulary move composition relative to the baseline pack? */
  const wideningEffect = round(
    byArm["with-widened-pack"].compositionDivergence.mean -
      byArm["with-pack"].compositionDivergence.mean
  );
  /**
   * Generality control: the off-target arm carries the same quantity of positive
   * vocabulary aimed at scopes no composition dimension measures. If it moves
   * composition too, richer vocabulary helps generally; if not, the widened gain
   * came from targeting.
   */
  const offtargetEffect = round(
    byArm["with-offtarget-pack"].compositionDivergence.mean -
      byArm["with-pack"].compositionDivergence.mean
  );

  return {
    schemaVersion: RESULT_SCHEMA_VERSION,
    benchmarkId: BENCHMARK_ID,
    brief: manifest.brief,
    briefSha256: manifest.briefSha256,
    executor: executions.executor,
    packs: manifest.packs,
    dimensions: { pinned: PINNED, pushed: PUSHED },
    sources,
    byArm,
    axes,
    outcomes: Object.fromEntries(treatments.map((arm) => [arm, outcomeFor(arm)])),
    wideningEffect: {
      question: "Does the ADR-003 widened vocabulary raise composition divergence over the baseline pack?",
      basePack: byArm["with-pack"].compositionDivergence.mean,
      widenedPack: byArm["with-widened-pack"].compositionDivergence.mean,
      delta: wideningEffect,
      raised: wideningEffect > 0
    },
    generality: {
      question:
        "Does equal-quantity vocabulary aimed AWAY from the measured dimensions move composition too?",
      onTargetEffectVsBasePack: wideningEffect,
      offTargetEffectVsBasePack: offtargetEffect,
      /**
       * The verdict must use the same reference as the pre-registered axis rule,
       * which is the no-pack baseline. Comparing only against the base pack
       * flatters the off-target arm: it can beat a pack that actively suppressed
       * composition while still sitting below the unguided baseline.
       */
      baselineComposition: baseline.compositionDivergence.mean,
      onTargetComposition: byArm["with-widened-pack"].compositionDivergence.mean,
      offTargetComposition: byArm["with-offtarget-pack"].compositionDivergence.mean,
      onTargetClearsBaseline: axes["with-widened-pack"].compositionDivergence.held,
      offTargetClearsBaseline: axes["with-offtarget-pack"].compositionDivergence.held,
      generalizes: axes["with-offtarget-pack"].compositionDivergence.held,
      readingIfNot:
        "The gain is largely targeting-specific: commitments move the dimensions they name. Equal-quantity vocabulary aimed elsewhere does not clear the unguided baseline."
    },
    limitations: LIMITATIONS
  };
}

async function main() {
  const result = await importResults();
  await writeFile(resolve(OUTPUT_ROOT, "result.json"), canonicalJson(result), "utf8");

  console.log(`${BENCHMARK_ID} result`);
  console.log(`  executor: ${result.executor.binary} ${result.executor.resolvedVersion}`);
  for (const [arm, pack] of Object.entries(result.packs)) {
    console.log(`  ${arm.padEnd(18)} ${pack.ruleCount} rules, ~${pack.estimatedTokens} tokens`);
  }
  console.log("");
  for (const [arm, armAxes] of Object.entries(result.axes)) {
    console.log(`  ${arm}  (outcome: ${result.outcomes[arm]})`);
    for (const [name, axis] of Object.entries(armAxes)) {
      console.log(
        `    ${name.padEnd(26)} baseline ${axis.baseline.toFixed(4)}  arm ${axis.arm.toFixed(4)}  ` +
          `delta ${axis.delta >= 0 ? "+" : ""}${axis.delta.toFixed(4)}  held=${axis.held}`
      );
    }
  }
  console.log("");
  console.log("  per-dimension mean pairwise distance");
  console.log("    dimension              class    no-pack   pack      widened");
  for (const id of [...result.dimensions.pinned, ...result.dimensions.pushed]) {
    const group = result.dimensions.pinned.includes(id)
      ? "tokenAdherenceConvergence"
      : "compositionDivergence";
    const cell = (arm) => result.byArm[arm][group].perDimensionMean[id].toFixed(4);
    console.log(
      `    ${id.padEnd(22)} ${DIMENSION_CLASSIFICATION[id].padEnd(8)} ` +
        `${cell("without-pack")}    ${cell("with-pack")}    ${cell("with-widened-pack")}`
    );
  }
  console.log("");
  const effect = result.wideningEffect;
  console.log(`  ADR-003 widening effect on composition: ${effect.basePack.toFixed(4)} -> ${effect.widenedPack.toFixed(4)} (${effect.delta >= 0 ? "+" : ""}${effect.delta.toFixed(4)}), raised=${effect.raised}`);
  const gen = result.generality;
  console.log("");
  console.log("  GENERALITY CONTROL");
  console.log(`    no-pack baseline composition   ${gen.baselineComposition.toFixed(4)}`);
  console.log(
    `    on-target  (layout+emphasis)   ${gen.onTargetComposition.toFixed(4)}  clears baseline: ${gen.onTargetClearsBaseline}` +
      `  (vs base pack ${gen.onTargetEffectVsBasePack >= 0 ? "+" : ""}${gen.onTargetEffectVsBasePack.toFixed(4)})`
  );
  console.log(
    `    off-target (navigation+state)  ${gen.offTargetComposition.toFixed(4)}  clears baseline: ${gen.offTargetClearsBaseline}` +
      `  (vs base pack ${gen.offTargetEffectVsBasePack >= 0 ? "+" : ""}${gen.offTargetEffectVsBasePack.toFixed(4)})`
  );
  console.log(`    generalizes: ${gen.generalizes}`);
  if (!gen.generalizes) console.log(`    -> ${gen.readingIfNot}`);
  console.log("  This authorizes no detector, criterion, score, or public claim.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}

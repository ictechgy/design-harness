/**
 * Run the browserless slop-convergence instrument probe.
 *
 * Writes aggregate-only evidence to a git-ignored path. Prints the verdict
 * produced by the decision rule that `contract.mjs` fixed before the run, so the
 * outcome cannot be tuned after it is seen.
 *
 *   node scripts/slop-convergence/run.mjs
 */

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  AGGREGATE_SCHEMA_VERSION,
  CORPUS_SEED,
  CORPUS_SIZE,
  DISTANCE_METHOD_ID,
  DIMENSION_IDS,
  FINGERPRINT_METHOD_ID,
  LIMITATIONS,
  OUTPUT_ROOT,
  PROBE_ID,
  REPEAT_RUNS,
  REQUIRED_MEAN_SEPARATION,
  REQUIRE_DISJOINT_RANGES,
  canonicalJson,
  sha256
} from "./contract.mjs";
import { buildCorpora } from "./corpus.mjs";
import { fingerprintSource, pairwiseSummary } from "./fingerprint.mjs";

/** One complete observation: corpora built, fingerprinted, summarized. */
export function observe() {
  const { brief, corpora } = buildCorpora();
  const summaries = {};
  const corpusHashes = {};

  for (const [name, sources] of Object.entries(corpora)) {
    const fingerprints = sources.map((source, index) =>
      fingerprintSource(source, `${name}[${index}]`)
    );
    summaries[name] = pairwiseSummary(fingerprints);
    corpusHashes[name] = sha256(sources.join("\u0000"));
  }

  return { brief, summaries, corpusHashes };
}

/**
 * Apply the pre-registered rule. Returns `discriminates: false` when the
 * instrument fails to separate the controls, which is a valid outcome.
 */
export function evaluate(summaries) {
  const convergent = summaries.convergent;
  const divergent = summaries.divergent;
  const separation = Number((divergent.meanDistance - convergent.meanDistance).toFixed(6));
  const rangesDisjoint = divergent.minDistance > convergent.maxDistance;
  const identicalFloorHolds = summaries.identical.meanDistance === 0;

  const failures = [];
  if (!identicalFloorHolds) {
    failures.push(
      `identical corpus must score exactly 0, scored ${summaries.identical.meanDistance}`
    );
  }
  if (separation < REQUIRED_MEAN_SEPARATION) {
    failures.push(
      `mean separation ${separation} is below the pre-registered ${REQUIRED_MEAN_SEPARATION}`
    );
  }
  if (REQUIRE_DISJOINT_RANGES && !rangesDisjoint) {
    failures.push(
      `ranges overlap: divergent min ${divergent.minDistance} <= convergent max ${convergent.maxDistance}`
    );
  }

  return {
    separation,
    rangesDisjoint,
    identicalFloorHolds,
    discriminates: failures.length === 0,
    failures
  };
}

async function main() {
  const runs = [];
  for (let index = 0; index < REPEAT_RUNS; index += 1) {
    const observation = observe();
    runs.push(sha256(canonicalJson(observation)));
  }
  const reproducible = new Set(runs).size === 1;

  const observation = observe();
  const verdict = evaluate(observation.summaries);

  const aggregate = {
    schemaVersion: AGGREGATE_SCHEMA_VERSION,
    probeId: PROBE_ID,
    question:
      "Can a browserless source-level fingerprint separate a corpus built to converge from a corpus built to diverge?",
    brief: observation.brief,
    method: {
      fingerprintMethodId: FINGERPRINT_METHOD_ID,
      distanceMethodId: DISTANCE_METHOD_ID,
      dimensions: DIMENSION_IDS,
      corpusSeed: CORPUS_SEED,
      corpusSize: CORPUS_SIZE,
      rendered: false,
      realGenerationsObserved: 0,
      guidePackApplied: false
    },
    preRegisteredRule: {
      requiredMeanSeparation: REQUIRED_MEAN_SEPARATION,
      requireDisjointRanges: REQUIRE_DISJOINT_RANGES
    },
    repeatability: { runCount: REPEAT_RUNS, byteIdentical: reproducible, observationSha256: runs[0] },
    corpusHashes: observation.corpusHashes,
    summaries: observation.summaries,
    verdict,
    limitations: LIMITATIONS
  };

  await mkdir(OUTPUT_ROOT, { recursive: true });
  const path = resolve(OUTPUT_ROOT, "aggregate.json");
  await writeFile(path, canonicalJson(aggregate), "utf8");

  const line = (label, summary) =>
    `  ${label.padEnd(11)} mean ${summary.meanDistance.toFixed(4)}  ` +
    `min ${summary.minDistance.toFixed(4)}  max ${summary.maxDistance.toFixed(4)}  ` +
    `(${summary.pairCount} pairs)`;

  console.log(`${PROBE_ID}: browserless source-level instrument probe`);
  console.log(`  brief: ${observation.brief}`);
  console.log(line("identical", observation.summaries.identical));
  console.log(line("convergent", observation.summaries.convergent));
  console.log(line("divergent", observation.summaries.divergent));
  console.log(`  separation: ${verdict.separation} (pre-registered >= ${REQUIRED_MEAN_SEPARATION})`);
  console.log(`  ranges disjoint: ${verdict.rangesDisjoint}`);
  console.log(`  byte-identical across ${REPEAT_RUNS} runs: ${reproducible}`);
  console.log("  per-dimension mean distance (convergent -> divergent):");
  for (const id of DIMENSION_IDS) {
    const from = observation.summaries.convergent.perDimensionMean[id];
    const to = observation.summaries.divergent.perDimensionMean[id];
    console.log(`    ${id.padEnd(20)} ${from.toFixed(4)} -> ${to.toFixed(4)}`);
  }
  console.log(
    verdict.discriminates
      ? "  VERDICT: instrument discriminates on constructed controls."
      : `  VERDICT: instrument does NOT discriminate. ${verdict.failures.join("; ")}`
  );
  console.log(`  wrote ${path}`);
  console.log("  This authorizes no detector, criterion, score, or public claim.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}

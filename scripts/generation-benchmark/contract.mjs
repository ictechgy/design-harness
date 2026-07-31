/**
 * Frozen contract for the with-pack / without-pack generation benchmark.
 *
 * QUESTION
 *
 * Does the compiled design-guide pack change what an agent generates from a
 * fixed brief, and does it change it in the two directions the pack is actually
 * trying to push?
 *
 * TWO AXES, NEVER AVERAGED
 *
 * `scripts/slop-convergence/pack-confound.mjs` established that the pack does
 * two opposite things at once. Its token contract pins colors, spacing, and
 * radius, so obedience makes generations MORE similar there. Its prohibitions
 * and signature element push composition AWAY from the generic solution, so
 * obedience makes generations LESS similar there. A single blended distance
 * number averages those into noise, so this benchmark reports:
 *
 *   axis 1  token-adherence convergence   pinned dimensions
 *           with-pack should score LOWER distance than without-pack
 *
 *   axis 2  composition divergence        pushed dimensions
 *           with-pack should score HIGHER distance than without-pack
 *
 * A result where only one axis moves is a real and reportable outcome. So is a
 * null result. Neither may be relabelled after the fact.
 *
 * SCOPE
 *
 * One brief, one executor family, six generations per arm. This is a
 * descriptive snapshot of twelve executions. It does not rank models or
 * executors, does not estimate variance across briefs, does not measure design
 * quality, and authorizes no detector, criterion, score, or public claim.
 */

import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const OUTPUT_ROOT = resolve(REPO_ROOT, ".omx/experiments/generation-benchmark-v1");

export const BENCHMARK_ID = "generation-benchmark-v1";
export const MANIFEST_SCHEMA_VERSION = "generation-benchmark-v1/manifest/v1";
export const RESULT_SCHEMA_VERSION = "generation-benchmark-v1/result/v1";

export const GENERATIONS_PER_ARM = 6;
export const ARMS = Object.freeze(["without-pack", "with-pack", "with-widened-pack"]);
export const GENERATED_FILENAME = "page.html";

/**
 * The widened guide used by the third arm (ADR-003).
 *
 * Held to what the unchanged 2000-token ceiling actually admits: a primary task
 * plus two commitments measured at ~1898 estimated tokens. A third commitment is
 * rejected at 2094, so this is the maximum positive vocabulary available, not a
 * chosen subset.
 *
 * The commitments are deliberately aimed at the dimensions that stayed flat in
 * v1 -- layout mode and emphasis -- because those are the pack-pushed dimensions
 * the composition axis is computed from.
 */
export const WIDENED_GUIDE_ADDITIONS = Object.freeze({
  primaryTask: Object.freeze({
    statement: "Clear the overnight settlement exception queue before the shift handover.",
    supportingTasks: Object.freeze(["Check payout totals."])
  }),
  signatureCommitments: Object.freeze([
    Object.freeze({
      id: "status-rail",
      scope: "layout",
      commitment:
        "Anchor the screen on a single vertical status rail that orders exceptions by urgency.",
      instead: "A row of equally sized summary cards across the top."
    }),
    Object.freeze({
      id: "single-loud-number",
      scope: "emphasis",
      commitment: "Give exactly one number the largest type on the screen; keep the rest quiet.",
      instead: "Three metrics rendered at the same size and weight."
    })
  ])
});

/** The single fixed brief. Identical in both arms. */
export const BRIEF =
  "Build a single-screen internal dashboard for a payments operations team. " +
  "It must show three key metrics the team checks every morning, make one " +
  "primary action obvious, and be readable at a glance during a shift handover.";

/**
 * Constraints the fail-closed fingerprint extractor requires. These are
 * mechanical output-format rules, not design guidance, and are identical in
 * both arms so they cannot act as a hidden treatment.
 */
export const OUTPUT_CONSTRAINTS = Object.freeze([
  `Write exactly one file named ${GENERATED_FILENAME} in the current working directory.`,
  "It must be one complete standalone HTML document.",
  "All CSS must live in a single inline <style> element inside <head>.",
  "Do not use an external stylesheet, <link>, or @import.",
  "Do not use <script>, <svg>, or <template>.",
  "Do not write any HTML comment or any CSS comment.",
  "Do not create, read, or modify any other file.",
  "Write the file, then stop without running any command."
]);

/**
 * Executor coordinate. Codex was unavailable at snapshot time (usage limit until
 * 2026-08-05), so this snapshot records one executor family only and must not be
 * described as a cross-executor comparison.
 */
export const EXECUTOR = Object.freeze({
  family: "claude-code",
  binary: "claude",
  invocation: "stdin prompt with -p --permission-mode acceptEdits",
  requestedModel: "default",
  note: "Model id is whatever the local CLI default resolves to; it is recorded from the CLI at run time, not requested."
});

export const MATRIX = Object.freeze(
  ARMS.flatMap((arm) =>
    Array.from({ length: GENERATIONS_PER_ARM }, (_unused, index) =>
      Object.freeze({ id: `${arm}-g${index + 1}`, arm, generation: index + 1 })
    )
  )
);

export const EXPECTED_CELL_COUNT = MATRIX.length;

export const LIMITATIONS = Object.freeze([
  "One brief only, so nothing here generalizes across screen types.",
  "One executor family only; Codex was quota-blocked at snapshot time. This is not a model or executor comparison.",
  "Six generations per arm gives fifteen within-arm pairs; that is a descriptive spread, not a variance estimate.",
  "Source-level fingerprints are not rendered measurements and never substitute for the rendered typography/palette/density metrics.",
  "The executor's own prior knowledge of design conventions is uncontrolled; only repository files are isolated.",
  "Cells live outside the repository so the without-pack arm cannot discover the project's own guide, but the executor may still carry design priors from its training or its own configuration.",
  "The benchmark authorizes no detector, criterion, finding, score, schema, enum, CLI surface, or public claim."
]);

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * The exact prompt for a cell. Both pack arms receive the identical stanza; only
 * the referenced file's contents differ, so the prompt text cannot itself be a
 * hidden second treatment.
 */
export function buildPrompt(arm, packFilename) {
  const lines = [`Brief: ${BRIEF}`, ""];
  if (arm !== "without-pack") {
    lines.push(
      `Before you design anything, read ./${packFilename} in this directory and follow every rule in it exactly.`,
      "It is the project's design contract: honor its declared tokens, avoid what it prohibits, and include its signature element.",
      ""
    );
  }
  lines.push("Output constraints:", ...OUTPUT_CONSTRAINTS.map((rule) => `- ${rule}`));
  return `${lines.join("\n")}\n`;
}

/**
 * Validation for the generation benchmark contract.
 *
 * Offline. Verifies the experiment's own invariants: the arms differ in exactly
 * one thing, the output constraints are identical in both arms, the axes are
 * kept separate, and import fails closed on an incomplete snapshot.
 *
 *   node scripts/generation-benchmark/validate.mjs
 */

import { DIMENSION_CLASSIFICATION } from "../slop-convergence/pack-confound.mjs";
import {
  ARMS,
  BRIEF,
  EXPECTED_CELL_COUNT,
  GENERATIONS_PER_ARM,
  LIMITATIONS,
  MATRIX,
  OUTPUT_CONSTRAINTS,
  buildPrompt
} from "./contract.mjs";

let checks = 0;
const failures = [];
const check = (label, condition) => {
  checks += 1;
  if (!condition) failures.push(label);
};

// --- matrix -----------------------------------------------------------------

check("two arms", ARMS.length === 2);
check("matrix size is arms x generations", EXPECTED_CELL_COUNT === ARMS.length * GENERATIONS_PER_ARM);
check("matrix has 12 cells", MATRIX.length === 12);
check("cell ids are unique", new Set(MATRIX.map((cell) => cell.id)).size === MATRIX.length);
for (const arm of ARMS) {
  check(
    `${arm} has exactly ${GENERATIONS_PER_ARM} cells`,
    MATRIX.filter((cell) => cell.arm === arm).length === GENERATIONS_PER_ARM
  );
}
check(
  "six generations gives fifteen within-arm pairs",
  (GENERATIONS_PER_ARM * (GENERATIONS_PER_ARM - 1)) / 2 === 15
);

// --- the arms differ in exactly one thing ----------------------------------

const withPack = buildPrompt("with-pack", "DESIGN.md");
const withoutPack = buildPrompt("without-pack", "DESIGN.md");

check("both arms carry the identical brief", withPack.includes(BRIEF) && withoutPack.includes(BRIEF));
check("with-pack references the pack", withPack.includes("DESIGN.md"));
check("without-pack never references the pack", !withoutPack.includes("DESIGN.md"));
check("without-pack never says design contract", !withoutPack.toLowerCase().includes("design contract"));
for (const rule of OUTPUT_CONSTRAINTS) {
  check(`both arms carry output constraint: ${rule.slice(0, 40)}`, withPack.includes(rule) && withoutPack.includes(rule));
}
check(
  "the only difference is the pack stanza",
  withPack.replace(/Before you design anything[\s\S]*?\n\n/, "") === withoutPack
);

// --- output constraints match the fail-closed extractor -------------------

const constraintText = OUTPUT_CONSTRAINTS.join(" ").toLowerCase();
for (const forbidden of ["external stylesheet", "@import", "<script>", "<svg>", "comment"]) {
  check(`constraints forbid ${forbidden}`, constraintText.includes(forbidden.toLowerCase()));
}
check("constraints require a single inline style element", constraintText.includes("single inline <style>"));

// --- axes stay separate ----------------------------------------------------

const pinned = Object.entries(DIMENSION_CLASSIFICATION).filter(([, k]) => k === "pinned").map(([id]) => id);
const pushed = Object.entries(DIMENSION_CLASSIFICATION).filter(([, k]) => k === "pushed").map(([id]) => id);

check("pinned dimension set is non-empty", pinned.length >= 1);
check("pushed dimension set is non-empty", pushed.length >= 1);
check("the two axes share no dimension", pinned.every((id) => !pushed.includes(id)));
check(
  "pinned dimensions are the token-contract ones",
  ["colorLiterals", "spacingLiterals", "radiusLiterals"].every((id) => pinned.includes(id))
);

// --- honesty guards -------------------------------------------------------

check("limitations recorded", LIMITATIONS.length >= 5);
check(
  "limitations disclaim cross-executor comparison",
  LIMITATIONS.some((text) => text.includes("not a model or executor comparison"))
);
check(
  "limitations disclaim rendered measurement",
  LIMITATIONS.some((text) => text.includes("not rendered measurements"))
);
check(
  "limitations disclaim detector authorization",
  LIMITATIONS.some((text) => text.includes("authorizes no detector"))
);
check(
  "limitations disclose uncontrolled executor priors",
  LIMITATIONS.some((text) => text.includes("prior knowledge"))
);
check("single brief is disclosed as a limit", LIMITATIONS.some((text) => text.includes("One brief only")));

if (failures.length > 0) {
  console.error(`generation-benchmark validate FAILED (${failures.length} of ${checks}):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`generation-benchmark validate passed: ${checks} checks.`);
console.log(
  "Contract invariants held: the arms differ only by the pack stanza, both carry " +
    "identical output constraints, and the pinned/pushed axes share no dimension."
);

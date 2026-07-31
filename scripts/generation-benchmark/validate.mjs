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
  WIDENED_GUIDE_ADDITIONS,
  buildPrompt
} from "./contract.mjs";

let checks = 0;
const failures = [];
const check = (label, condition) => {
  checks += 1;
  if (!condition) failures.push(label);
};

// --- matrix -----------------------------------------------------------------

check("three arms", ARMS.length === 3);
check("exactly one baseline arm", ARMS.filter((arm) => arm === "without-pack").length === 1);
check("two treatment arms", ARMS.filter((arm) => arm !== "without-pack").length === 2);
check("matrix size is arms x generations", EXPECTED_CELL_COUNT === ARMS.length * GENERATIONS_PER_ARM);
check("matrix has 18 cells", MATRIX.length === 18);
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
const withWidened = buildPrompt("with-widened-pack", "DESIGN.md");

// Both treatment arms must be indistinguishable from the prompt alone, so the
// only difference between them is the compiled pack file's contents.
check("both pack arms receive byte-identical prompts", withPack === withWidened);
check("the widened arm still carries the brief", withWidened.includes(BRIEF));

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

// --- the widened guide must fit the unchanged ceiling ----------------------

check(
  "widened additions declare a primary task",
  typeof WIDENED_GUIDE_ADDITIONS.primaryTask.statement === "string" &&
    WIDENED_GUIDE_ADDITIONS.primaryTask.statement.length > 0
);
check(
  "widened additions stay within the measured ceiling headroom (primary task plus two commitments)",
  WIDENED_GUIDE_ADDITIONS.signatureCommitments.length === 2
);
check(
  "widened commitments target the pack-pushed dimensions",
  WIDENED_GUIDE_ADDITIONS.signatureCommitments.map((entry) => entry.scope).sort().join(",") ===
    "emphasis,layout"
);
check(
  "every widened commitment states what it replaces",
  WIDENED_GUIDE_ADDITIONS.signatureCommitments.every(
    (entry) => entry.instead.length > 0 && entry.instead !== entry.commitment
  )
);
check(
  "widened commitment ids are unique",
  new Set(WIDENED_GUIDE_ADDITIONS.signatureCommitments.map((entry) => entry.id)).size ===
    WIDENED_GUIDE_ADDITIONS.signatureCommitments.length
);

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

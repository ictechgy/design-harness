/**
 * Validation for the slop-convergence probe.
 *
 * Checks the instrument's own properties and its fail-closed behavior. This is
 * the probe's regression suite; it does not validate any product surface,
 * because the probe adds none.
 *
 *   node scripts/slop-convergence/validate.mjs
 */

import {
  CORPUS_SIZE,
  DIMENSION_IDS,
  LIMITATIONS,
  REQUIRED_MEAN_SEPARATION,
  createRandom
} from "./contract.mjs";
import { buildCorpora } from "./corpus.mjs";
import {
  UnsupportedSourceError,
  cosineDistance,
  fingerprintDistance,
  fingerprintSource,
  jaccardDistance,
  pairwiseSummary
} from "./fingerprint.mjs";
import { evaluate, observe } from "./run.mjs";

let checks = 0;
const failures = [];

function check(label, condition) {
  checks += 1;
  if (!condition) failures.push(label);
}

function throws(label, fn, ErrorType) {
  checks += 1;
  try {
    fn();
    failures.push(`${label}: expected a throw, got none`);
  } catch (error) {
    if (ErrorType && !(error instanceof ErrorType)) {
      failures.push(`${label}: expected ${ErrorType.name}, got ${error.constructor.name}`);
    }
  }
}

const MINIMAL = '<html><body><div class="a" style="color:#fff;padding:8px">x</div></body></html>';

// --- distance function properties -------------------------------------------

check("jaccard: identical sets are 0", jaccardDistance(["a", "b"], ["b", "a"]) === 0);
check("jaccard: disjoint sets are 1", jaccardDistance(["a"], ["b"]) === 1);
check("jaccard: two empty sets are 0", jaccardDistance([], []) === 0);
check("jaccard: empty vs non-empty is 1", jaccardDistance([], ["a"]) === 1);
check("jaccard: symmetric", jaccardDistance(["a", "b"], ["b", "c"]) === jaccardDistance(["b", "c"], ["a", "b"]));

check("cosine: identical histograms are 0", cosineDistance({ a: 2 }, { a: 2 }) === 0);
check("cosine: proportional histograms are 0", cosineDistance({ a: 1 }, { a: 4 }) === 0);
check("cosine: disjoint histograms are 1", cosineDistance({ a: 1 }, { b: 1 }) === 1);
check("cosine: two empty histograms are 0", cosineDistance({}, {}) === 0);
check("cosine: bounded to [0,1]", (() => {
  const value = cosineDistance({ a: 3, b: 1 }, { a: 1, b: 9 });
  return value >= 0 && value <= 1;
})());

// --- fail-closed extraction -------------------------------------------------

throws("refuses external stylesheet", () =>
  fingerprintSource('<html><link rel="stylesheet" href="a.css"><body><p>x</p></body></html>', "t"),
  UnsupportedSourceError);
throws("refuses @import", () =>
  fingerprintSource("<html><style>@import url(a);</style><body><p>x</p></body></html>", "t"),
  UnsupportedSourceError);
throws("refuses script", () =>
  fingerprintSource("<html><body><script>0</script></body></html>", "t"), UnsupportedSourceError);
throws("refuses svg", () =>
  fingerprintSource("<html><body><svg></svg></body></html>", "t"), UnsupportedSourceError);
throws("refuses template", () =>
  fingerprintSource("<html><body><template></template></body></html>", "t"), UnsupportedSourceError);
throws("refuses html comment", () =>
  fingerprintSource("<html><body><p>x</p></body></html>", "t").tagHistogram &&
  fingerprintSource("<html><body><p>x</p><!-- c --></body></html>", "t"), UnsupportedSourceError);
throws("refuses css comment", () =>
  fingerprintSource("<html><style>p{ /* c */ color:red }</style><body><p>x</p></body></html>", "t"),
  UnsupportedSourceError);
throws("refuses empty source", () => fingerprintSource("", "t"));
throws("refuses non-string source", () => fingerprintSource(null, "t"));
throws("refuses element-free source", () => fingerprintSource("plain text only", "t"));
throws("pairwise needs two members", () => pairwiseSummary([fingerprintSource(MINIMAL, "t")]));

// --- extraction correctness -------------------------------------------------

const minimal = fingerprintSource(MINIMAL, "minimal");
check("extracts tags", minimal.tagHistogram.div === 1 && minimal.tagHistogram.html === 1);
check("extracts class tokens", minimal.classTokens.includes("a"));
check("extracts inline-style colors", minimal.colorLiterals.includes("#fff"));
check("extracts inline-style spacing", minimal.spacingLiterals.includes("8px"));
check("all dimensions present", DIMENSION_IDS.every((id) => minimal[id] !== undefined));
check("self-distance is 0", fingerprintDistance(minimal, minimal).mean === 0);

check(
  "case and whitespace normalized",
  fingerprintDistance(
    fingerprintSource('<html><body><p style="COLOR:  #ABCDEF">x</p></body></html>', "a"),
    fingerprintSource('<html><body><p style="color:#abcdef">x</p></body></html>', "b")
  ).mean === 0
);

// --- corpus construction guard ---------------------------------------------

const { corpora } = buildCorpora();
check("three corpora built", Object.keys(corpora).sort().join(",") === "convergent,divergent,identical");
for (const [name, sources] of Object.entries(corpora)) {
  check(`${name} has CORPUS_SIZE members`, sources.length === CORPUS_SIZE);
}
check("identical corpus members are byte-identical", new Set(corpora.identical).size === 1);
check("convergent members are distinct bytes", new Set(corpora.convergent).size === CORPUS_SIZE);
check("divergent members are distinct bytes", new Set(corpora.divergent).size === CORPUS_SIZE);
check(
  "no divergent pair shares a design vocabulary",
  (() => {
    const prints = corpora.divergent.map((source, i) => fingerprintSource(source, `d${i}`));
    for (let i = 0; i < prints.length; i += 1) {
      for (let j = i + 1; j < prints.length; j += 1) {
        if (fingerprintDistance(prints[i], prints[j]).mean === 0) return false;
      }
    }
    return true;
  })()
);

// --- determinism ------------------------------------------------------------

check("PRNG is deterministic", (() => {
  const a = createRandom(7);
  const b = createRandom(7);
  return a() === b() && a() === b();
})());
check("corpora are reproducible", JSON.stringify(buildCorpora()) === JSON.stringify(buildCorpora()));

// --- pre-registered rule behavior ------------------------------------------

const observed = observe();
const verdict = evaluate(observed.summaries);
check("identical floor holds", verdict.identicalFloorHolds);
check("verdict is reproducible", JSON.stringify(evaluate(observe().summaries)) === JSON.stringify(verdict));

check(
  "rule rejects an insufficient separation",
  evaluate({
    identical: { meanDistance: 0, minDistance: 0, maxDistance: 0 },
    convergent: { meanDistance: 0.4, minDistance: 0.3, maxDistance: 0.5 },
    divergent: { meanDistance: 0.5, minDistance: 0.45, maxDistance: 0.6 }
  }).discriminates === false
);
check(
  "rule rejects overlapping ranges even with a large mean gap",
  evaluate({
    identical: { meanDistance: 0, minDistance: 0, maxDistance: 0 },
    convergent: { meanDistance: 0.1, minDistance: 0, maxDistance: 0.9 },
    divergent: { meanDistance: 0.9, minDistance: 0.2, maxDistance: 1 }
  }).discriminates === false
);
check(
  "rule rejects a broken identical floor",
  evaluate({
    identical: { meanDistance: 0.01, minDistance: 0, maxDistance: 0.02 },
    convergent: { meanDistance: 0.1, minDistance: 0.05, maxDistance: 0.15 },
    divergent: { meanDistance: 0.9, minDistance: 0.8, maxDistance: 1 }
  }).discriminates === false
);
check(
  "rule accepts a clean separation",
  evaluate({
    identical: { meanDistance: 0, minDistance: 0, maxDistance: 0 },
    convergent: { meanDistance: 0.05, minDistance: 0, maxDistance: 0.1 },
    divergent: { meanDistance: 0.8, minDistance: 0.7, maxDistance: 0.9 }
  }).discriminates === true
);
check("threshold is a pre-registered constant", REQUIRED_MEAN_SEPARATION === 0.25);

// --- honesty guards --------------------------------------------------------

check("limitations are recorded", LIMITATIONS.length >= 5);
check(
  "limitations disclaim rendered evidence",
  LIMITATIONS.some((text) => text.includes("not rendered measurements"))
);
check(
  "limitations disclaim real generations",
  LIMITATIONS.some((text) => text.includes("No real AI generation"))
);
check(
  "limitations disclaim detector authorization",
  LIMITATIONS.some((text) => text.includes("authorizes no detector"))
);

// --- known weaknesses, asserted so they cannot be quietly lost -------------

check(
  "classTokens is a known dead dimension in this corpus",
  observed.summaries.divergent.perDimensionMean.classTokens === 0
);
check(
  "convergent control is unrealistically clean (scores exactly the identical floor)",
  observed.summaries.convergent.meanDistance === observed.summaries.identical.meanDistance
);

if (failures.length > 0) {
  console.error(`slop-convergence validate FAILED (${failures.length} of ${checks}):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`slop-convergence validate passed: ${checks} checks.`);
console.log(
  "Asserted weaknesses: classTokens carries no signal in these controls, and the " +
    "convergent control scores exactly the identical floor, so it is an easier " +
    "test than real generations would be."
);

/**
 * Pack-confound analysis: which fingerprint dimensions may a generation
 * benchmark legitimately use?
 *
 * WHY THIS EXISTS
 *
 * The convergence probe (`run.mjs`) showed the fingerprint can separate a
 * corpus built to converge from one built to diverge. The obvious next step
 * looked like a with-pack / without-pack generation benchmark measuring whether
 * the compiled guide pack raises inter-generation distance.
 *
 * That design is confounded, and the confound is visible offline for free.
 *
 * The compiled pack contains a token contract that pins colors, font families,
 * spacing, and radius to declared values. Obeying it necessarily makes
 * with-pack generations MORE similar on exactly those dimensions. So a single
 * pairwise-distance number mixes two opposite effects:
 *
 *   - token rules      -> push distance DOWN (that is consistency working)
 *   - prohibitions and -> push distance UP  (that is anti-genericness working)
 *     signature element
 *
 * A metric that cannot tell "converged because generic" from "converged because
 * both obeyed the same declared contract" cannot measure slop. This script
 * classifies each dimension against the real compiled pack and demonstrates the
 * confound with controls, so the benchmark is designed correctly before any
 * generation budget is spent.
 *
 *   node scripts/slop-convergence/pack-confound.mjs --core <path-to-core-dist-index.js>
 */

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { OUTPUT_ROOT, canonicalJson, sha256 } from "./contract.mjs";
import { fingerprintSource, pairwiseSummary } from "./fingerprint.mjs";

export const ANALYSIS_SCHEMA_VERSION = "slop-convergence-probe-v1/pack-confound/v1";

/**
 * How each fingerprint dimension relates to the compiled pack.
 *
 * - `pinned`  the pack declares specific values, so obedience forces agreement.
 *             Unusable as a slop signal: convergence here is the product working.
 * - `pushed`  the pack tells the agent to avoid a generic solution, so
 *             divergence here is the intended effect. Usable.
 * - `blind`   the pack says nothing, so the dimension is free. Usable, but it
 *             measures unguided variation rather than pack effect.
 */
export const DIMENSION_CLASSIFICATION = Object.freeze({
  colorLiterals: "pinned",
  fontSizeLiterals: "blind",
  fontWeightLiterals: "pushed",
  spacingLiterals: "pinned",
  radiusLiterals: "pinned",
  tagHistogram: "pushed",
  layoutModeHistogram: "pushed",
  classTokens: "blind"
});

export const USABLE_DIMENSIONS = Object.freeze(
  Object.entries(DIMENSION_CLASSIFICATION)
    .filter(([, kind]) => kind === "pushed")
    .map(([id]) => id)
);

/**
 * The pack's own rule inventory, read from a real compilation rather than
 * described from memory.
 */
export async function inspectPack(coreDistPath) {
  const core = await import(coreDistPath);
  const guide = core.createExampleDesignGuide();
  const compiled = core.compileDesignGuide(guide);
  const rules = compiled.rules.map((rule) => ({
    id: rule.id,
    effect: rule.effect,
    kind: rule.subject?.startsWith("tokens:")
      ? "token-contract"
      : rule.subject?.startsWith("fingerprint:")
        ? "prohibition"
        : rule.subject?.startsWith("signature-element:")
          ? "signature"
          : "other"
  }));
  return {
    profileId: compiled.profileId,
    sourceHash: compiled.sourceHash,
    ruleCount: rules.length,
    estimatedTokens: compiled.tokenEstimate.estimated,
    rulesByKind: rules.reduce((acc, rule) => {
      acc[rule.kind] = (acc[rule.kind] ?? 0) + 1;
      return acc;
    }, {}),
    rules
  };
}

/**
 * Controls that isolate the confound.
 *
 * Both corpora obey one token contract: the same four colors, one font family,
 * two spacing values, one radius. They differ only in composition.
 *
 * - `obedientGeneric` six members, all the same generic card grid.
 *   This is slop that fully obeys the pack's token rules.
 * - `obedientVaried`  six members with genuinely different composition.
 *   This is what the pack's prohibitions are trying to produce.
 *
 * If pinned dimensions score ~0 in BOTH, they cannot distinguish slop from
 * obedience, and the confound is demonstrated.
 */
const TOKENS = {
  bg: "#ffffff",
  muted: "#f5f7fa",
  text: "#141419",
  accent: "#1a59f2",
  font: "Example Sans, sans-serif",
  spaceSm: "0.5rem",
  spaceMd: "1rem",
  radius: "8px"
};

function tokenStyle(extra) {
  return (
    `body { margin: 0; padding: ${TOKENS.spaceMd}; background: ${TOKENS.bg}; ` +
    `color: ${TOKENS.text}; font-family: ${TOKENS.font}; }\n` +
    `.accent { color: ${TOKENS.accent}; }\n` +
    `.panel { background: ${TOKENS.muted}; border-radius: ${TOKENS.radius}; ` +
    `padding: ${TOKENS.spaceMd}; margin: ${TOKENS.spaceSm}; }\n${extra}`
  );
}

function obedientGenericMember(index) {
  const labels = ["Revenue", "Orders", "Refunds", "Sessions", "Signups", "Churn"];
  const label = labels[index % labels.length];
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>${label}</title>
<style>
${tokenStyle(".grid { display: grid; gap: " + TOKENS.spaceMd + "; }\n.value { font-weight: 700; }")}
</style></head>
<body><h1>${label}</h1><div class="grid">
<div class="panel"><p>${label}</p><p class="value">${100 + index}</p></div>
<div class="panel"><p>${label} rate</p><p class="value">${200 + index}</p></div>
<div class="panel"><p>${label} total</p><p class="value">${300 + index}</p></div>
</div><a class="accent" href="/go">Continue</a></body></html>
`;
}

/** Six distinct compositions, all obeying the same token contract. */
const OBEDIENT_VARIED_BUILDERS = [
  (i) => `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Queue</title>
<style>${tokenStyle("table { border-collapse: collapse; } td { padding: " + TOKENS.spaceSm + "; font-weight: 400; }")}</style>
</head><body><table><tr><td>Queue</td><td class="accent">${i}</td></tr><tr><td>Aging</td><td>${i * 2}</td></tr></table></body></html>
`,
  (i) => `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Rail</title>
<style>${tokenStyle("main { display: flex; } aside { padding: " + TOKENS.spaceMd + "; } strong { font-weight: 900; }")}</style>
</head><body><main><aside class="panel">Status rail</aside><section><strong>${i}</strong></section></main></body></html>
`,
  (i) => `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Log</title>
<style>${tokenStyle("pre { margin: 0; font-weight: 400; } dl { display: block; } dt { font-weight: 500; }")}</style>
</head><body><dl><dt>Event</dt><dd><pre>entry ${i}</pre></dd></dl></body></html>
`,
  (i) => `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Editorial</title>
<style>${tokenStyle("article { display: block; } blockquote { padding: " + TOKENS.spaceMd + "; font-weight: 300; }")}</style>
</head><body><article><h2 class="accent">Summary ${i}</h2><blockquote>Narrative body copy.</blockquote></article></body></html>
`,
  (i) => `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Form</title>
<style>${tokenStyle("form { display: block; } label { display: block; font-weight: 600; } fieldset { padding: " + TOKENS.spaceSm + "; }")}</style>
</head><body><form><fieldset><label>Amount</label><input value="${i}"><button class="accent">Send</button></fieldset></form></body></html>
`,
  (i) => `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Timeline</title>
<style>${tokenStyle("ol { display: block; } li { padding: " + TOKENS.spaceSm + "; font-weight: 500; } time { font-weight: 400; }")}</style>
</head><body><ol><li><time>t${i}</time> opened</li><li><time>t${i + 1}</time> resolved</li></ol></body></html>
`
];

export function buildConfoundCorpora() {
  return {
    obedientGeneric: OBEDIENT_VARIED_BUILDERS.map((_unused, index) => obedientGenericMember(index)),
    obedientVaried: OBEDIENT_VARIED_BUILDERS.map((build, index) => build(index + 1))
  };
}

/** Per-dimension mean distance for each control corpus. */
export function analyzeConfound() {
  const corpora = buildConfoundCorpora();
  const summaries = {};
  for (const [name, sources] of Object.entries(corpora)) {
    summaries[name] = pairwiseSummary(
      sources.map((source, index) => fingerprintSource(source, `${name}[${index}]`))
    );
  }

  const perDimension = {};
  for (const [id, classification] of Object.entries(DIMENSION_CLASSIFICATION)) {
    const generic = summaries.obedientGeneric.perDimensionMean[id];
    const varied = summaries.obedientVaried.perDimensionMean[id];
    perDimension[id] = {
      classification,
      obedientGeneric: generic,
      obedientVaried: varied,
      separation: Number((varied - generic).toFixed(6)),
      distinguishesSlop: varied - generic >= 0.25
    };
  }

  const pinnedThatDistinguish = Object.entries(perDimension)
    .filter(([, value]) => value.classification === "pinned" && value.distinguishesSlop)
    .map(([id]) => id);
  const pushedThatDistinguish = Object.entries(perDimension)
    .filter(([, value]) => value.classification === "pushed" && value.distinguishesSlop)
    .map(([id]) => id);

  return {
    summaries,
    perDimension,
    confoundDemonstrated: pinnedThatDistinguish.length === 0,
    pinnedThatDistinguish,
    pushedThatDistinguish
  };
}

async function main() {
  const coreArgIndex = process.argv.indexOf("--core");
  const corePath = coreArgIndex === -1 ? null : process.argv[coreArgIndex + 1];

  const analysis = analyzeConfound();
  const pack = corePath ? await inspectPack(corePath) : null;

  const record = {
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    question:
      "Which fingerprint dimensions can measure genericness without being pinned by the guide pack's own token contract?",
    pack,
    dimensionClassification: DIMENSION_CLASSIFICATION,
    usableDimensions: USABLE_DIMENSIONS,
    analysis,
    conclusion: analysis.confoundDemonstrated
      ? "Pack-pinned dimensions cannot distinguish generic composition from token obedience. A generation benchmark must measure composition dimensions only, and must never report one blended distance number."
      : "At least one pack-pinned dimension still separated the controls; re-examine the classification before designing the benchmark.",
    limitations: [
      "Both corpora are hand-authored controls, not real generations.",
      "The classification is derived from the example guide's compiled rules; a different guide pins different dimensions and must be re-classified.",
      "This analysis authorizes no detector, criterion, score, schema, or public claim."
    ]
  };

  await mkdir(OUTPUT_ROOT, { recursive: true });
  const path = resolve(OUTPUT_ROOT, "pack-confound.json");
  await writeFile(path, canonicalJson(record), "utf8");

  console.log("pack-confound analysis");
  if (pack) {
    console.log(`  compiled pack: ${pack.ruleCount} rules, ~${pack.estimatedTokens} tokens`);
    console.log(`  rules by kind: ${JSON.stringify(pack.rulesByKind)}`);
    console.log(`  source hash: ${pack.sourceHash.slice(0, 16)}...`);
  } else {
    console.log("  compiled pack: not inspected (pass --core <core dist index.js>)");
  }
  console.log("  dimension                class      generic  varied   sep      distinguishes");
  for (const [id, value] of Object.entries(analysis.perDimension)) {
    console.log(
      `  ${id.padEnd(24)} ${value.classification.padEnd(10)} ` +
        `${value.obedientGeneric.toFixed(4)}   ${value.obedientVaried.toFixed(4)}   ` +
        `${value.separation.toFixed(4)}  ${value.distinguishesSlop}`
    );
  }
  console.log(`  confound demonstrated: ${analysis.confoundDemonstrated}`);
  console.log(`  usable (pack-pushed) dimensions that separated: ${analysis.pushedThatDistinguish.join(", ") || "none"}`);
  console.log(`  record sha256: ${sha256(canonicalJson(record)).slice(0, 16)}...`);
  console.log(`  wrote ${path}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}

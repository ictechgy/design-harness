import {
  KIWI_MODEL_CONTRACT,
  KIWI_NLP_VERSION,
  prepareKiwiMorphologyAnalyzer
} from "../packages/copy-audit/dist/index.js";

const modelDir = parseModelDirectory(process.argv.slice(2));
const analyze = await prepareKiwiMorphologyAnalyzer(modelDir);
const inventories = [{
  viewport: "real-model-smoke",
  evidenceRef: "text-inventory-real-model-smoke",
  items: [
    { selector: "#mismatch", text: "마을를" },
    { selector: "#correct", text: "가을을" },
    { selector: "#vowel-skip-1", text: "사과을" },
    { selector: "#vowel-skip-2", text: "아이을" },
    { selector: "#non-noun-skip", text: "먹는를" }
  ]
}];
const runs = [];
let reference;

for (let run = 1; run <= 3; run += 1) {
  const started = performance.now();
  const result = await analyze(inventories);
  const elapsedMs = Number((performance.now() - started).toFixed(2));
  assertResult(result);
  const normalized = JSON.stringify(result);
  if (reference !== undefined && normalized !== reference) {
    throw new Error(`Kiwi real-model run ${run} was not byte-repeatable.`);
  }
  reference = normalized;
  runs.push({
    run,
    elapsedMs,
    maxRssKiB: process.resourceUsage().maxRSS,
    findingIds: result.findings.map(({ id }) => id)
  });
}

console.log(JSON.stringify({
  status: "passed",
  node: process.version,
  kiwiNlpVersion: KIWI_NLP_VERSION,
  modelVersion: KIWI_MODEL_CONTRACT.version,
  modelType: KIWI_MODEL_CONTRACT.modelType,
  modelBytes: KIWI_MODEL_CONTRACT.files.reduce((sum, file) => sum + file.bytes, 0),
  runs
}, null, 2));

function parseModelDirectory(args) {
  if (
    args.length !== 2
    || args[0] !== "--model-dir"
    || !args[1]
  ) {
    throw new Error(
      "Usage: pnpm smoke:kiwi-real-model -- --model-dir <verified-kiwi-0.23.0-cong-directory>"
    );
  }
  return args[1];
}

function assertResult(result) {
  if (
    result.notices.length !== 0
    || result.findings.length !== 1
    || result.findings[0]?.selector !== "#mismatch"
    || result.findings[0]?.checkName !== "josa-batchim-mismatch"
    || result.findings[0]?.determinism !== "heuristic"
    || result.findings[0]?.resultKind !== "risk"
    || result.findings[0]?.confidence !== "low"
    || result.provenance?.kiwiNlpVersion !== KIWI_NLP_VERSION
    || result.provenance?.modelVersion !== KIWI_MODEL_CONTRACT.version
    || result.provenance?.modelType !== KIWI_MODEL_CONTRACT.modelType
    || result.provenance?.modelBytes !== 93_885_643
  ) {
    throw new Error(`Kiwi real-model contract drifted: ${JSON.stringify(result)}`);
  }
}

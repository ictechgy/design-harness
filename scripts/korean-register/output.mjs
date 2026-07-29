import {
  CALIBRATION_ID,
  LABELS,
  OBSERVED_SOURCE_ROWS,
  REFERENCE_COUNT,
  TASK_PAGE_DESCRIBED_SOURCE_ROWS
} from "./contract.mjs";

export function renderObservationReadme(aggregate, repeatability) {
  const counts = aggregate.counts;
  const lines = [
    "# Korean register evidence calibration v1",
    "",
    "> Aggregate-only browserless observation complete.",
    "",
    "This record measures offline Kiwi token/POS evidence for the pinned IWSLT",
    "2023 EN-KO binary formality references. It is not a product detector.",
    "",
    "## Scope",
    "",
    `- Calibration ID: \`${CALIBRATION_ID}\``,
    `- Pinned source rows: ${OBSERVED_SOURCE_ROWS}`,
    `- Korean references: ${REFERENCE_COUNT}`,
    `- Upstream task-page description: ${TASK_PAGE_DESCRIBED_SOURCE_ROWS} test pairs`,
    `- Labels preserved: ${LABELS.map((label) => `\`${label}\``).join(", ")}`,
    `- Real offline model loaded: ${aggregate.analyzer.realModelLoaded}`,
    `- Independent normalized runs: ${aggregate.analyzer.runCount}`,
    `- Byte-identical aggregate SHA-256: \`${repeatability.aggregateSha256}\``,
    "",
    "The official task page and pinned artifact disagree on row count: the page",
    "describes 600 test pairs, while every pinned EN-KO file contains 597 rows.",
    "",
    "## Aggregate evidence buckets",
    "",
    "| Bucket | Formal | Informal | Total |",
    "|---|---:|---:|---:|"
  ];
  for (const bucket of Object.keys(counts.overallBuckets)) {
    lines.push(
      `| \`${bucket}\` | ${counts.byLabel.formal.buckets[bucket]} | ${counts.byLabel.informal.buckets[bucket]} | ${counts.overallBuckets[bucket]} |`
    );
  }
  lines.push(
    "",
    `All ${counts.accountedReferences} references are accounted for; invalid token offsets: ${counts.invalidTokenOffsetCount}.`,
    `Kiwi zero-length inserted morpheme tokens retained: ${counts.zeroLengthTokenCount}.`,
    "",
    "## Limitations",
    ""
  );
  for (const limitation of aggregate.limitations) {
    lines.push(`- ${limitation}`);
  }
  lines.push(
    "",
    "No four-way accuracy, UI precision, real-product false-positive, causal,",
    "ranking, or detector-readiness claim is supported by this observation.",
    ""
  );
  return lines.join("\n");
}

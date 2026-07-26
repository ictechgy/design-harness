export const VISUAL_METRICS_CORPUS_PROJECTION_PROFILE =
  "visual-metrics-corpus-portable-v1";

export const VISUAL_METRICS_CORPUS_OMITTED_FIELDS = Object.freeze([
  "measurement.density.textClusters.textFragmentCount",
  "measurement.density.textClusters.edgeTestCount"
]);

export function toPortableVisualMetricsCorpusProjection(profile, projection) {
  if (profile !== VISUAL_METRICS_CORPUS_PROJECTION_PROFILE) {
    throw new Error(`Unsupported visual-metrics corpus projection profile: ${profile}`);
  }
  const textClusters = projection?.measurement?.density?.textClusters;
  if (
    !isRecord(textClusters)
    || !Object.hasOwn(textClusters, "textFragmentCount")
    || !Object.hasOwn(textClusters, "edgeTestCount")
  ) {
    throw new Error(
      "Full visual-metrics corpus projection must contain text-fragment and edge-test diagnostics."
    );
  }
  const {
    textFragmentCount: _textFragmentCount,
    edgeTestCount: _edgeTestCount,
    ...portableTextClusters
  } = textClusters;
  return {
    ...projection,
    measurement: {
      ...projection.measurement,
      density: {
        ...projection.measurement.density,
        textClusters: portableTextClusters
      }
    }
  };
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

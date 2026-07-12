export const CALIBRATION_SUMMARY_VERSION = "calibration-summary/v1";

export function buildCalibrationSummary(runs) {
  const aggregate = new Map();
  const fixtures = runs.map(({ record, auditResult, error }) => {
    const expectedFindings = sortedCounts(Object.fromEntries(
      record.expectedFindings.map(({ checkName, count }) => [checkName, count])
    ));
    const checkNames = new Set([
      ...Object.keys(expectedFindings),
      ...record.shouldNotFlag.registeredCheckNames
    ]);
    const allActualFindings = countFindings(auditResult.findings);
    const actualFindings = sortedCounts(Object.fromEntries(
      Object.entries(allActualFindings).filter(([checkName]) => checkNames.has(checkName))
    ));
    const outOfScopeFindings = sortedCounts(Object.fromEntries(
      Object.entries(allActualFindings).filter(([checkName]) => !checkNames.has(checkName))
    ));
    const checks = {};

    for (const checkName of [...checkNames].sort()) {
      const expected = expectedFindings[checkName] ?? 0;
      const actual = actualFindings[checkName] ?? 0;
      const metrics = {
        tp: Math.min(expected, actual),
        fp: Math.max(actual - expected, 0),
        fn: Math.max(expected - actual, 0)
      };
      checks[checkName] = metrics;
      addMetrics(aggregate, checkName, metrics);
    }

    const totals = sumMetrics(Object.values(checks));
    const auditComplete = auditResult.status === "success" && (auditResult.failedChecks?.length ?? 0) === 0 && !error;
    return {
      fixturePath: record.fixturePath,
      status: hasDrift(totals) || !auditComplete ? "drift" : "pass",
      audit: {
        status: auditResult.status,
        failedChecks: auditResult.failedChecks ?? [],
        error: error ?? null
      },
      expectedFindings,
      actualFindings,
      outOfScopeFindings,
      shouldNotFlag: {
        registeredCheckNames: [...record.shouldNotFlag.registeredCheckNames].sort(),
        futureCriteria: [...record.shouldNotFlag.futureCriteria]
          .sort((left, right) => left.criterionId.localeCompare(right.criterionId))
      },
      checks,
      totals
    };
  });

  const checks = Object.fromEntries([...aggregate.entries()].sort(([left], [right]) => left.localeCompare(right)));
  const totals = sumMetrics(Object.values(checks));
  const auditFailures = fixtures.filter((fixture) => fixture.audit.status !== "success" || fixture.audit.failedChecks.length > 0 || fixture.audit.error).length;
  return {
    schemaVersion: CALIBRATION_SUMMARY_VERSION,
    status: hasDrift(totals) || auditFailures > 0 ? "drift" : "pass",
    fixtures,
    checks,
    totals,
    auditFailures
  };
}

function countFindings(findings) {
  const counts = {};
  for (const finding of findings) {
    counts[finding.checkName] = (counts[finding.checkName] ?? 0) + 1;
  }
  return sortedCounts(counts);
}

function sortedCounts(counts) {
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function addMetrics(aggregate, checkName, metrics) {
  const current = aggregate.get(checkName) ?? { tp: 0, fp: 0, fn: 0 };
  aggregate.set(checkName, {
    tp: current.tp + metrics.tp,
    fp: current.fp + metrics.fp,
    fn: current.fn + metrics.fn
  });
}

function sumMetrics(metrics) {
  return metrics.reduce(
    (totals, current) => ({
      tp: totals.tp + current.tp,
      fp: totals.fp + current.fp,
      fn: totals.fn + current.fn
    }),
    { tp: 0, fp: 0, fn: 0 }
  );
}

function hasDrift(metrics) {
  return metrics.fp > 0 || metrics.fn > 0;
}

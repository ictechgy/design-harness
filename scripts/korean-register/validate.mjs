#!/usr/bin/env node

import { validateKoreanRegisterCalibration } from "./validate-lib.mjs";

try {
  const result = await validateKoreanRegisterCalibration();
  console.log(JSON.stringify({
    sourceRows: result.dataset.provenance.upstream.observedSourceRows,
    references: result.dataset.records.length,
    runs: result.output.status.runCount,
    aggregateSha256: result.output.status.aggregateSha256
  }));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

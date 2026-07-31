#!/usr/bin/env node
/**
 * Report the ratio of verification machinery to shipped product.
 *
 * From the 2026-07-31 direction review: the gate and benchmark scripts had grown
 * larger than the product they protect. That review recommended this check and
 * then dismissed it as "a number nobody agreed to act on" -- and the very session
 * that dismissed it added roughly two thousand more lines of scripts, which is
 * exactly the drift the finding was about.
 *
 * So this reports rather than blocks. There is no evidence for a correct ratio,
 * and inventing a threshold would be the unproven-precision mistake the project's
 * own invariants forbid. It fails only if the numbers cannot be collected, or if
 * the ratio crosses a deliberately generous ceiling that exists to force a
 * conversation rather than to encode a target.
 *
 *   node scripts/report-gate-product-ratio.mjs [--json]
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));

/**
 * Deliberately generous. Not a target, not validated, and crossing it is a prompt
 * to discuss allocation, never an instruction to delete tests.
 */
export const RATIO_CONVERSATION_CEILING = 3;

function tracked(...args) {
  return execFileSync("git", ["ls-files", ...args], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

function countLines(paths) {
  let total = 0;
  for (const path of paths) {
    total += readFileSync(resolve(root, path), "utf8").split("\n").length;
  }
  return total;
}

export function collect() {
  const packageSources = tracked("packages").filter(
    (path) => /^packages\/[^/]+\/src\/.+\.ts$/u.test(path)
  );
  const productSources = packageSources.filter((path) => !path.endsWith(".test.ts"));
  const productTests = packageSources.filter((path) => path.endsWith(".test.ts"));
  const scripts = tracked("scripts").filter((path) => path.endsWith(".mjs"));

  const product = countLines(productSources);
  const tests = countLines(productTests);
  const machinery = countLines(scripts);

  return {
    product: { files: productSources.length, lines: product },
    packageTests: { files: productTests.length, lines: tests },
    machinery: { files: scripts.length, lines: machinery },
    machineryToProductRatio: Number((machinery / product).toFixed(3)),
    testsToProductRatio: Number((tests / product).toFixed(3))
  };
}

function main() {
  const report = collect();
  if (report.product.lines === 0) {
    console.error("report-gate-product-ratio failed: no product sources found.");
    process.exit(1);
  }

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const row = (label, value) => `  ${label.padEnd(34)} ${String(value.lines).padStart(6)}  (${value.files} files)`;
  console.log("gate-versus-product allocation");
  console.log(row("product source (packages/*/src)", report.product));
  console.log(row("package tests", report.packageTests));
  console.log(row("verification machinery (scripts)", report.machinery));
  console.log(`  machinery / product              ${report.machineryToProductRatio.toFixed(3)}`);
  console.log(`  package tests / product          ${report.testsToProductRatio.toFixed(3)}`);

  if (report.machineryToProductRatio > RATIO_CONVERSATION_CEILING) {
    console.error(
      `report-gate-product-ratio failed: machinery/product ${report.machineryToProductRatio} exceeds the ` +
        `conversation ceiling ${RATIO_CONVERSATION_CEILING}. This is not a quality threshold. It means allocation ` +
        "should be discussed with the owner before more gate code lands."
    );
    process.exit(1);
  }
  console.log(
    `  reported only; the ceiling ${RATIO_CONVERSATION_CEILING} exists to force a conversation, not to encode a target.`
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

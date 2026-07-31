#!/usr/bin/env node
/**
 * Render an `audit.json` into textlint's JSON result shape.
 *
 * WHY THIS EXISTS
 *
 * The 2026-07-31 direction review found zero external demand signal and argued
 * the highest-leverage move is reaching a real consumer of the file contract.
 * textlint 15.x is alive, has an established editor ecosystem, and ships zero
 * Korean rules — so an output adapter is a cheap way for an existing toolchain to
 * consume Design Harness findings without Design Harness owning a plugin.
 *
 * WHAT THIS IS NOT
 *
 * Not a textlint plugin, not a rule, not a package export, and not a lint pass.
 * It is a checkout-local recipe in the same family as the PR-comment renderer and
 * the scenario-audit runner: it reads the canonical artifact and writes a
 * different serialization. `audit.json` and `report.md` remain the integration
 * boundary. No textlint dependency is added — the format is emitted, not linked.
 *
 * SEVERITY MAPPING IS DELIBERATELY CONSERVATIVE
 *
 * textlint has three levels: 0 info, 1 warning, 2 error. Design Harness grades on
 * `determinism` and `resultKind`. Only a deterministic failure becomes a textlint
 * error, because the project's first hard rule is that heuristic and subjective
 * findings may never carry failure language. Everything heuristic is a warning and
 * everything `needs-review` is info, regardless of the finding's own severity
 * field. That keeps the epistemic grading intact across the format boundary rather
 * than flattening it into an editor's red squiggle.
 *
 *   node scripts/render-textlint-output.mjs --run runs/demo [--out runs/demo/textlint.json]
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export const TEXTLINT_SEVERITY = Object.freeze({ info: 0, warning: 1, error: 2 });
export const ADAPTER_ID = "design-harness-textlint-output-v1";

/**
 * Map one finding to a textlint severity.
 *
 * Deterministic failure is the only path to `error`. This mirrors hard rule 1 and
 * `packages/core/src/integrity.ts`: a heuristic or subjective finding may never
 * be presented as a failure, and an editor's error level is failure language.
 */
export function severityFor(finding) {
  const determinism = finding.determinism ?? "deterministic";
  const resultKind = finding.resultKind ?? "risk";
  if (determinism === "deterministic" && resultKind === "failure") return TEXTLINT_SEVERITY.error;
  if (resultKind === "needs-review" || determinism === "subjective") return TEXTLINT_SEVERITY.info;
  return TEXTLINT_SEVERITY.warning;
}

/** textlint expects a rule id per message; the check name is the honest one. */
function ruleIdFor(finding) {
  const check = finding.checkName ?? "design-harness";
  return `design-harness/${check}`;
}

function messageFor(finding) {
  const parts = [finding.problem ?? "Design Harness finding"];
  if (finding.recommendation) parts.push(finding.recommendation);
  const grading = [finding.determinism, finding.resultKind].filter(Boolean).join("/");
  if (grading) parts.push(`[${grading}]`);
  if (finding.criterionId) parts.push(`criterion=${finding.criterionId}`);
  return parts.join(" ");
}

/**
 * Build the textlint result array.
 *
 * textlint groups messages by file path. An audit has no source file, so the
 * grouping key is the viewport: it is the closest honest analogue and keeps
 * desktop and mobile findings separable in an editor list. Line and column are
 * fixed at 1 and disclosed as synthetic, because a rendered-DOM finding does not
 * map to a source position and inventing one would be a false provenance claim.
 */
export function renderTextlintOutput(auditResult, options = {}) {
  const findings = Array.isArray(auditResult?.findings) ? auditResult.findings : [];
  const label = options.sourceLabel ?? auditResult?.metadata?.url ?? "design-harness";
  const byViewport = new Map();

  for (const finding of findings) {
    const viewport = finding.viewport ?? "unknown";
    const key = `${label}#${viewport}`;
    const messages = byViewport.get(key) ?? [];
    messages.push({
      type: "lint",
      ruleId: ruleIdFor(finding),
      message: messageFor(finding),
      index: 0,
      line: 1,
      column: 1,
      severity: severityFor(finding),
      // Adapter-specific provenance. textlint ignores unknown keys; a consumer
      // that wants the real evidence must read audit.json.
      designHarness: {
        adapter: ADAPTER_ID,
        findingId: finding.id ?? null,
        category: finding.category ?? null,
        determinism: finding.determinism ?? null,
        resultKind: finding.resultKind ?? null,
        confidence: finding.confidence ?? null,
        selector: finding.selector ?? null,
        positionIsSynthetic: true
      }
    });
    byViewport.set(key, messages);
  }

  return [...byViewport.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([filePath, messages]) => ({ filePath, messages }));
}

/** Counts by severity, so a caller can decide its own exit policy. */
export function summarize(results) {
  const counts = { error: 0, warning: 0, info: 0 };
  for (const result of results) {
    for (const message of result.messages) {
      if (message.severity === TEXTLINT_SEVERITY.error) counts.error += 1;
      else if (message.severity === TEXTLINT_SEVERITY.warning) counts.warning += 1;
      else counts.info += 1;
    }
  }
  return counts;
}

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

async function main() {
  const runDir = arg("--run");
  if (!runDir) {
    console.error("usage: node scripts/render-textlint-output.mjs --run <runDir> [--out <file>]");
    process.exit(1);
  }
  const auditPath = resolve(runDir, "audit.json");
  const auditResult = JSON.parse(await readFile(auditPath, "utf8"));
  const results = renderTextlintOutput(auditResult, { sourceLabel: arg("--label") ?? undefined });
  const counts = summarize(results);
  const serialized = `${JSON.stringify(results, null, 2)}\n`;

  const outPath = arg("--out");
  if (outPath) {
    await writeFile(resolve(outPath), serialized, "utf8");
    console.log(`${ADAPTER_ID}: wrote ${resolve(outPath)}`);
  } else {
    process.stdout.write(serialized);
  }
  console.error(
    `${ADAPTER_ID}: ${results.length} group(s), ${counts.error} error, ${counts.warning} warning, ${counts.info} info. ` +
      "Only deterministic failures map to textlint error severity; audit.json remains the canonical artifact."
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}

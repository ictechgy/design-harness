#!/usr/bin/env node
/**
 * Docs claim checker (ROADMAP backlog item).
 *
 * Epistemic discipline is this project's product, so a measured-sounding number
 * in a committed doc that cites nothing is a self-inflicted wound. This check
 * finds quantitative claims in tracked documentation and requires each one to sit
 * near an evidence citation.
 *
 * PRECISION FIRST
 *
 * The project's own invariant is precision over recall: a noisy check causes
 * banner blindness and kills trust. So this check is deliberately narrow.
 *
 * It flags only percentages and ratio-style claims -- the shapes that read as
 * "we measured this". It does not flag versions, dates, standard thresholds,
 * counts, code, or tables, because those are not claims about measured outcomes.
 *
 * Evidence is accepted generously. A claim passes if its paragraph, or the
 * paragraph before it, references any of: a benchmarks path, an experiment or
 * calibration record, a dated measurement, an external author-year citation, a
 * URL, a named standard, or an explicit in-repo evidence document. The goal is to
 * catch numbers with no provenance at all, not to police citation style.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));

/** Only tracked Markdown under docs/ plus the root README. Research docs included. */
function trackedDocs() {
  const output = execFileSync("git", ["ls-files", "docs", "README.md"], {
    cwd: root,
    encoding: "utf8"
  });
  return output.split("\n").filter((path) => path.endsWith(".md"));
}

/**
 * Docs whose entire purpose is to quote or define rules rather than assert
 * measurements. `agent-protocol.md` documents process; ADRs carry their own
 * References section and are reviewed as decisions.
 */
const EXEMPT = new Set(["docs/agent-protocol.md"]);
const EXEMPT_PREFIXES = ["docs/adr/"];

/** Percentages and ratio phrasing: the shapes that read as a measured outcome. */
const CLAIM_PATTERNS = [
  /\b\d{1,3}(?:\.\d+)?\s?%/u,
  /\b\d+\s*(?:of|\/)\s*\d+\s+(?:cells|samples|runs|pages|screens|references|findings|selectors)\b/iu
];

/** Shapes that look numeric but are not measured-outcome claims. */
const NOT_A_CLAIM = [
  /^\s*[|>]/u, // table rows and blockquotes
  /^\s*```/u,
  /^\s*[-*]\s+\[[ x]\]/u // task list
];

/** Generously accepted evidence signals. */
const EVIDENCE_PATTERNS = [
  /docs\/benchmarks\//u,
  /docs\/calibration\//u,
  /docs\/research\//u,
  /\.omx\//u,
  /\bexperiment\b/iu,
  /\bcalibration\b/iu,
  /\bmeasured\b/iu,
  /\bsnapshot\b/iu,
  /\bpinned\b/iu,
  /\bet al\b/iu,
  /\bhttps?:\/\//u,
  /\bWCAG\b|\bKWCAG\b|\bCHI \d{4}\b|\bUIST \d{4}\b|\bISO \d+\b|\bEN \d+\b/u,
  /\b20\d{2}-\d{2}-\d{2}\b/u,
  /\b(?:recorded|observed|verified|reported)\b/iu,
  /`(?:pnpm|node) [^`]+`/u
];

function paragraphsOf(text) {
  const lines = text.split("\n");
  const paragraphs = [];
  let current = { startLine: 1, lines: [] };
  let inFence = false;
  lines.forEach((line, index) => {
    if (/^\s*```/u.test(line)) inFence = !inFence;
    if (!inFence && line.trim() === "") {
      if (current.lines.length > 0) paragraphs.push(current);
      current = { startLine: index + 2, lines: [] };
      return;
    }
    if (current.lines.length === 0) current.startLine = index + 1;
    current.lines.push({ number: index + 1, text: line, inFence });
  });
  if (current.lines.length > 0) paragraphs.push(current);
  return paragraphs;
}

function hasEvidence(text) {
  return EVIDENCE_PATTERNS.some((pattern) => pattern.test(text));
}

export function findUncitedClaims(relativePath, text) {
  const paragraphs = paragraphsOf(text);
  const findings = [];
  paragraphs.forEach((paragraph, index) => {
    const body = paragraph.lines.map((line) => line.text).join("\n");
    const previous = index === 0 ? "" : paragraphs[index - 1].lines.map((line) => line.text).join("\n");
    for (const line of paragraph.lines) {
      if (line.inFence) continue;
      if (NOT_A_CLAIM.some((pattern) => pattern.test(line.text))) continue;
      if (!CLAIM_PATTERNS.some((pattern) => pattern.test(line.text))) continue;
      if (hasEvidence(body) || hasEvidence(previous)) continue;
      findings.push({
        file: relativePath,
        line: line.number,
        excerpt: line.text.trim().slice(0, 120)
      });
      break; // one finding per paragraph is enough to require a citation
    }
  });
  return findings;
}

function main() {
  const docs = trackedDocs().filter(
    (path) => !EXEMPT.has(path) && !EXEMPT_PREFIXES.some((prefix) => path.startsWith(prefix))
  );
  const findings = [];
  let claimParagraphs = 0;
  for (const path of docs) {
    const text = readFileSync(resolve(root, path), "utf8");
    const uncited = findUncitedClaims(path, text);
    findings.push(...uncited);
    claimParagraphs += (text.match(/\b\d{1,3}(?:\.\d+)?\s?%/gu) ?? []).length;
  }

  if (findings.length > 0) {
    console.error(
      `check-docs-claims failed: ${findings.length} quantitative claim(s) with no nearby evidence citation.`
    );
    for (const finding of findings) {
      console.error(`  ${finding.file}:${finding.line}  ${finding.excerpt}`);
    }
    console.error(
      "Cite a benchmarks/calibration/experiment record, a dated measurement, or an external source in the same or preceding paragraph."
    );
    process.exit(1);
  }
  console.log(
    `check-docs-claims passed: ${docs.length} tracked doc(s) scanned, ${claimParagraphs} percentage mention(s), every quantitative claim sits near an evidence citation.`
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

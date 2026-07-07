#!/usr/bin/env node
/**
 * Guards local-only artifacts against accidental commits (git add -f, future
 * .gitignore edits): the owner strategy report, .omx working state, and
 * generated Midjourney assets must never be tracked. Also enforces the
 * AGENTS.md size budget — 150 lines is a budget, not science: the repo's own
 * research says short, developer-written, concrete guidance is what agents
 * actually follow, so growth beyond the budget must be a deliberate decision.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

const root = resolve(new URL("..", import.meta.url).pathname);
const failures = [];

const FORBIDDEN_TRACKED = [
  /^REPORT\.md$/,
  /^\.omx\//,
  /^datasets\/midjourney-reference-lab\/local-assets\//
];

const trackedFiles = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
  .split("\n")
  .filter(Boolean);

for (const file of trackedFiles) {
  for (const pattern of FORBIDDEN_TRACKED) {
    if (pattern.test(file)) {
      failures.push(`${file} is tracked but must remain local-only (AGENTS.md).`);
    }
  }
}

const AGENTS_LINE_BUDGET = 150;
const agentsLines = readFileSync(resolve(root, "AGENTS.md"), "utf8").split("\n").length;
if (agentsLines > AGENTS_LINE_BUDGET) {
  failures.push(
    `AGENTS.md is ${agentsLines} lines (budget: ${AGENTS_LINE_BUDGET}). Move detail to docs/ROADMAP.md or docs/agent-protocol.md instead of growing the always-loaded core.`
  );
}

if (failures.length > 0) {
  console.error("check-tracked-hygiene failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`check-tracked-hygiene passed: no local-only files tracked; AGENTS.md at ${agentsLines}/${AGENTS_LINE_BUDGET} lines.`);

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const recipePath = resolve("docs/recipes/agent-loop.md");
const recipe = await readFile(recipePath, "utf8");

const requiredFragments = [
  "## Evidence Packet",
  "## Fix Loop Contract",
  "## Codex",
  "## Claude Code",
  "## Gemini CLI",
  "## Human Reviewer",
  "## PR Comment Template",
  "report.md",
  "audit.json",
  "screenshots/desktop.png",
  "screenshots/mobile.png",
  "deterministic",
  "heuristic",
  "needs-review",
  "Rerun the exact audit command"
];

const missing = requiredFragments.filter((fragment) => !recipe.includes(fragment));
if (missing.length > 0) {
  throw new Error(`Missing required agent recipe fragment(s): ${missing.join(", ")}`);
}

console.log("Validated agent loop recipes.");

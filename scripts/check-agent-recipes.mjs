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
  "screenshots/<viewport-name>.png",
  "deterministic",
  "heuristic",
  "needs-review",
  "Rerun the exact audit command"
];

const missing = requiredFragments.filter((fragment) => !recipe.includes(fragment));
if (missing.length > 0) {
  throw new Error(`Missing required agent recipe fragment(s): ${missing.join(", ")}`);
}

// Adapter parity: every adapter SKILL.md must embed the canonical shared rule
// block from adapters/shared/rules.md verbatim. One-sided edits are the
// documented multi-agent drift failure mode; the only escape hatch is an
// entry in adapters/intentional-differences.json.
const SHARED_BEGIN = "<!-- design-harness:shared:begin -->";
const SHARED_END = "<!-- design-harness:shared:end -->";
const ADAPTERS = ["codex-skill", "claude-code-skill"];

function extractSharedBlock(content, label) {
  const begin = content.indexOf(SHARED_BEGIN);
  const end = content.indexOf(SHARED_END);
  if (begin === -1 || end === -1 || end < begin) {
    throw new Error(`${label}: shared rule markers are missing or malformed.`);
  }
  return content
    .slice(begin + SHARED_BEGIN.length, end)
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

const canonical = extractSharedBlock(
  await readFile(resolve("adapters/shared/rules.md"), "utf8"),
  "adapters/shared/rules.md"
);
const intentionalDifferences = JSON.parse(
  await readFile(resolve("adapters/intentional-differences.json"), "utf8")
);

for (const adapter of ADAPTERS) {
  if (intentionalDifferences[adapter]?.reason) {
    console.warn(`Adapter parity skipped for ${adapter}: ${intentionalDifferences[adapter].reason}`);
    continue;
  }
  const skillPath = `adapters/${adapter}/SKILL.md`;
  const block = extractSharedBlock(await readFile(resolve(skillPath), "utf8"), skillPath);
  if (block !== canonical) {
    const canonicalLines = canonical.split("\n");
    const blockLines = block.split("\n");
    const firstDiff = canonicalLines.findIndex((line, index) => line !== blockLines[index]);
    throw new Error(
      `${skillPath} shared rule block diverges from adapters/shared/rules.md (first difference at shared-block line ${firstDiff + 1}). Update both in the same change or add an intentional-differences entry.`
    );
  }
}

console.log(`Validated agent loop recipes and adapter parity (${ADAPTERS.join(", ")}).`);

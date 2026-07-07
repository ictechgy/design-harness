#!/usr/bin/env node
/**
 * Claude Code PreToolUse hook enforcing AGENTS.md hard rule 2: publishing,
 * tagging, and releasing require the owner's explicit approval in the current
 * session. CLAUDE.md/AGENTS.md prose is advisory; this hook is deterministic.
 * (Codex has no equivalent hook surface — for Codex the rule stays prose.)
 * Exit 2 blocks the tool call and surfaces the message to the agent.
 */
const BLOCKED = [
  { pattern: /\bnpm\s+publish\b/, label: "npm publish" },
  { pattern: /\bpnpm\s+(-r\s+|--filter\s+\S+\s+)?publish\b/, label: "pnpm publish" },
  { pattern: /\bgit\s+tag\b.*\bv?\d/, label: "git tag" },
  { pattern: /\bgit\s+push\b.*--tags/, label: "git push --tags" },
  { pattern: /\bgh\s+release\s+create\b/, label: "gh release create" },
  { pattern: /\bgit\s+add\b.*-f\b.*(REPORT\.md|\.omx)/, label: "force-adding local-only files" }
];

let raw = "";
process.stdin.on("data", (chunk) => {
  raw += chunk;
});
process.stdin.on("end", () => {
  let command = "";
  try {
    const payload = JSON.parse(raw);
    command = payload?.tool_input?.command ?? "";
  } catch {
    process.exit(0);
  }
  for (const { pattern, label } of BLOCKED) {
    if (pattern.test(command)) {
      console.error(
        `Blocked by AGENTS.md hard rule 2 (${label}): publish/tag/release actions require the owner's explicit approval in the current session. Ask the owner, and only retry after they approve this specific action.`
      );
      process.exit(2);
    }
  }
  process.exit(0);
});

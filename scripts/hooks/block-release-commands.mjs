#!/usr/bin/env node
/**
 * Claude Code PreToolUse hook enforcing AGENTS.md hard rule 2: publishing,
 * tagging, and releasing require the owner's explicit approval in the current
 * session. CLAUDE.md/AGENTS.md prose is advisory; this hook is deterministic.
 * (Codex has no equivalent hook surface — for Codex the rule stays prose.)
 * Exit 2 blocks the tool call and surfaces the message to the agent.
 */
const BLOCKED = [
  { pattern: /\bnpm\s+(?:(?:--workspace|-w)\s+\S+\s+)*publish\b/, label: "npm publish" },
  { pattern: /\bpnpm\s+(?:(?:-r|--recursive|--filter\s+\S+|-F\s+\S+)\s+)*publish\b/, label: "pnpm publish" },
  { pattern: /\byarn\s+(?:npm\s+)?publish\b/, label: "yarn publish" },
  { pattern: /\b(?:npm|pnpm|yarn)\s+(?:(?:-r|--recursive)\s+|(?:(?:--filter|-F|--workspace|-w)\s+\S+\s+))*version\b/, label: "package version bump" },
  { pattern: /\b(?:npm|pnpm)\s+dist-tag\b/, label: "npm dist-tag" },
  { pattern: /\byarn\s+npm\s+tag\b/, label: "yarn npm tag" },
  { pattern: /\bgit\s+tag\s+(?!--list\b|-l\b)/, label: "git tag" },
  { pattern: /\bgit\s+push\b.*\bv?\d+\.\d+\.\d+\b/, label: "git push version tag" },
  { pattern: /\bgit\s+push\b.*--tags/, label: "git push --tags" },
  { pattern: /\bgh\s+release\s+(?:create|upload|edit|delete)\b/, label: "gh release" },
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

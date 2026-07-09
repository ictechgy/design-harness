#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const hookPath = resolve(root, "scripts/hooks/block-release-commands.mjs");
const failures = [];

const blocked = [
  "npm publish --access public",
  "pnpm --filter @design-harness/core publish --access public",
  "pnpm -F @design-harness/cli publish --access public",
  "npm version 0.4.0",
  "pnpm version 0.4.0",
  "pnpm -r version 0.4.0",
  "yarn version --new-version 0.4.0",
  "npm dist-tag add @design-harness/cli@0.4.0 latest",
  "pnpm dist-tag add @design-harness/cli@0.4.0 latest",
  "git tag v0.4.0",
  "git tag -a v0.4.0 -m release",
  "git push origin v0.4.0",
  "git push origin --tags",
  "gh release create v0.4.0",
  "gh release upload v0.4.0 ./artifact.tgz",
  "gh release edit v0.4.0 --latest"
];

const allowed = [
  "pnpm release:check",
  "pnpm pack:dry-run",
  "git tag --list",
  "git push origin codex/v04a-release-prep-fixes",
  "gh pr create --draft"
];

for (const command of blocked) {
  const result = runHook(command);
  if (result.status !== 2) {
    failures.push(`Expected hook to block ${JSON.stringify(command)}, got status ${result.status}.`);
  }
}

for (const command of allowed) {
  const result = runHook(command);
  if (result.status !== 0) {
    failures.push(`Expected hook to allow ${JSON.stringify(command)}, got status ${result.status}: ${result.stderr.trim()}`);
  }
}

if (failures.length > 0) {
  console.error("check-release-hook-policy failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`check-release-hook-policy passed: ${blocked.length} blocked samples, ${allowed.length} allowed samples.`);

function runHook(command) {
  return spawnSync(process.execPath, [hookPath], {
    input: JSON.stringify({ tool_input: { command } }),
    encoding: "utf8"
  });
}

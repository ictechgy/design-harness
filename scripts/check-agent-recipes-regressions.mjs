#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const checker = join(repoRoot, "scripts/check-agent-recipes.mjs");
const SHARED_BEGIN = "<!-- design-harness:shared:begin -->";
const SHARED_END = "<!-- design-harness:shared:end -->";
const temporaryRoot = await mkdtemp(
  join(tmpdir(), "agent-recipes-regression-")
);

function runCheck() {
  return spawnSync(process.execPath, [checker], {
    cwd: temporaryRoot,
    encoding: "utf8"
  });
}

try {
  await mkdir(join(temporaryRoot, "docs/recipes"), { recursive: true });
  await cp(
    join(repoRoot, "docs/recipes/agent-loop.md"),
    join(temporaryRoot, "docs/recipes/agent-loop.md")
  );
  await cp(join(repoRoot, "adapters"), join(temporaryRoot, "adapters"), {
    recursive: true
  });

  const baseline = runCheck();
  if (baseline.status !== 0) {
    throw new Error(
      `Agent recipe baseline failed: ${baseline.stderr || baseline.stdout}`
    );
  }

  const differencesPath = join(
    temporaryRoot,
    "adapters/intentional-differences.json"
  );
  await writeFile(
    differencesPath,
    `${JSON.stringify({
      _comment: "regression fixture",
      "codex-skill": { reason: "intentional shared-block divergence" }
    }, null, 2)}\n`
  );

  const skillPath = join(
    temporaryRoot,
    "adapters/codex-skill/SKILL.md"
  );
  const skill = await readFile(skillPath, "utf8");
  const divergentSkill = skill.replace(
    "## Workflow",
    "## Deliberately divergent workflow"
  );
  if (divergentSkill === skill) {
    throw new Error("Regression fixture could not create adapter divergence");
  }
  await writeFile(skillPath, divergentSkill);

  const allowedParityDifference = runCheck();
  if (allowedParityDifference.status !== 0) {
    throw new Error(
      "A documented shared-block parity difference should remain allowed"
    );
  }

  const markerMutations = [
    [
      "missing begin marker",
      divergentSkill.replace(`${SHARED_BEGIN}\n`, ""),
      "exactly one begin/end pair"
    ],
    [
      "missing end marker",
      divergentSkill.replace(`${SHARED_END}\n`, ""),
      "exactly one begin/end pair"
    ],
    [
      "duplicate begin marker",
      divergentSkill.replace(SHARED_BEGIN, `${SHARED_BEGIN}\n${SHARED_BEGIN}`),
      "exactly one begin/end pair"
    ],
    [
      "duplicate end marker",
      divergentSkill.replace(SHARED_END, `${SHARED_END}\n${SHARED_END}`),
      "exactly one begin/end pair"
    ],
    [
      "reversed marker order",
      divergentSkill
        .replace(SHARED_BEGIN, "<!-- shared-marker-swap -->")
        .replace(SHARED_END, SHARED_BEGIN)
        .replace("<!-- shared-marker-swap -->", SHARED_END),
      "begin marker must precede"
    ]
  ];
  for (const [label, mutation, expectedMessage] of markerMutations) {
    if (mutation === divergentSkill) {
      throw new Error(`Regression fixture could not create ${label}`);
    }
    await writeFile(skillPath, mutation);
    const rejectedMarkerMutation = runCheck();
    if (
      rejectedMarkerMutation.status === 0 ||
      !rejectedMarkerMutation.stderr.includes(expectedMessage)
    ) {
      throw new Error(
        `Intentional parity differences must not bypass ${label} validation`
      );
    }
  }

  await writeFile(skillPath, divergentSkill);
  const brokenContract = divergentSkill.replace(
    "$product-ui-designer",
    "product-ui-designer"
  );
  if (brokenContract === divergentSkill) {
    throw new Error("Regression fixture could not remove the invocation contract");
  }
  await writeFile(skillPath, brokenContract);

  const rejectedContract = runCheck();
  if (
    rejectedContract.status === 0 ||
    !rejectedContract.stderr.includes("missing invocation contract fragment")
  ) {
    throw new Error(
      "Intentional parity differences must not bypass adapter contract checks"
    );
  }

  console.log(
    "Validated adapter parity exceptions remain scoped to shared-block parity."
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  MATRIX,
  canonicalJson,
  deliveryStanzaFor,
  expectedExecutableFor,
  readCanonicalSharedBlock,
  readCommonInputs,
  sha256
} from "./contract.mjs";
import {
  validateOperatorEvidence,
  validatePreparedDelivery
} from "./import.mjs";
import { prepareCellRoots } from "./prepare.mjs";

const temporaryRoot = await mkdtemp(join(tmpdir(), "obedience-v1-prepare-regression-"));
try {
  const destination = join(temporaryRoot, "prepared");
  await mkdir(destination);
  const { root, manifest } = await prepareCellRoots(destination);
  const inputs = await readCommonInputs();
  const sharedBlock = await readCanonicalSharedBlock();

  assert.equal(root, await realpath(destination));
  assert.equal(manifest.matrixSize, MATRIX.length);
  assert.equal(manifest.providerExecution, "not-performed");
  assert.deepEqual(manifest.commonInputHashes, inputs.hashes);
  assert.equal(manifest.cells.length, MATRIX.length);
  validateOperatorEvidence(operatorEvidenceRegressionFixture());

  for (const expected of MATRIX) {
    const cellRoot = join(root, "cells", expected.id);
    const request = JSON.parse(await readFile(join(cellRoot, "request-metadata.json"), "utf8"));
    assert.equal(request.id, expected.id);
    assert.equal(request.requestedModel, expected.requestedModel);
    assert.equal(request.mechanism, expected.mechanism);
    assert.equal(
      request.inputHashes.deliveryStanzaSha256,
      sha256(deliveryStanzaFor(expected))
    );
    assert.equal(
      await readFile(join(cellRoot, "fixture.html"), "utf8"),
      inputs.fixture.toString("utf8")
    );
    assert.equal(
      await readFile(join(cellRoot, "common-task.md"), "utf8"),
      inputs.commonTask.toString("utf8")
    );
    assert.equal(
      await readFile(join(cellRoot, "delivery-stanza.md"), "utf8"),
      deliveryStanzaFor(expected)
    );
    await validatePreparedDelivery(cellRoot, expected, inputs);

    const instructionName =
      expected.executorFamily === "claude-code" ? "CLAUDE.md" : "AGENTS.md";
    const expectedSkill =
      expected.executorFamily === "claude-code"
        ? ".claude/skills/product-ui-designer/SKILL.md"
        : ".agents/skills/product-ui-designer/SKILL.md";
    if (expected.mechanism === "inline") {
      assert.equal(await readFile(join(cellRoot, instructionName), "utf8"), sharedBlock);
      await assertMissing(join(cellRoot, expectedSkill));
    } else if (expected.mechanism === "skill") {
      await assertMissing(join(cellRoot, instructionName));
      const skill = await readFile(join(cellRoot, expectedSkill), "utf8");
      assert.match(skill, /^---\nname: product-ui-designer\n/m);
      if (expected.executorFamily === "codex-cli") {
        assert.match(skill, /\.agents\/skills\/product-ui-designer\//);
        assert.match(skill, /\$product-ui-designer/);
      } else {
        assert.match(skill, /\.claude\/skills\/product-ui-designer\//);
        assert.match(skill, /\/product-ui-designer/);
      }
    } else {
      await assertMissing(join(cellRoot, instructionName));
      await assertMissing(join(cellRoot, expectedSkill));
    }
  }

  const inline = MATRIX.find((cell) => cell.id === "claude-haiku-inline");
  const inlineRoot = join(root, "cells", inline.id);
  const inlineRequestPath = join(inlineRoot, "request-metadata.json");
  const inlineRequest = JSON.parse(
    await readFile(inlineRequestPath, "utf8")
  );

  const reversedPromptOrder = structuredClone(inlineRequest);
  reversedPromptOrder.taskInput.promptInputMode =
    "delivery-stanza-then-common-task";
  await writeFile(inlineRequestPath, canonicalJson(reversedPromptOrder));
  await assert.rejects(
    validatePreparedDelivery(inlineRoot, inline, inputs),
    /taskInput/
  );

  const contradictoryDelivery = structuredClone(inlineRequest);
  contradictoryDelivery.delivery.instructionFile = "AGENTS.md";
  await writeFile(inlineRequestPath, canonicalJson(contradictoryDelivery));
  await assert.rejects(
    validatePreparedDelivery(inlineRoot, inline, inputs),
    /delivery/
  );

  const contradictoryGit = structuredClone(inlineRequest);
  contradictoryGit.git = {
    initialized: false,
    reason: "git-unavailable"
  };
  await writeFile(inlineRequestPath, canonicalJson(contradictoryGit));
  await assert.rejects(
    validatePreparedDelivery(inlineRoot, inline, inputs),
    /git metadata contradicts/
  );
  await writeFile(inlineRequestPath, canonicalJson(inlineRequest));

  const inlineCommonTask = join(inlineRoot, "common-task.md");
  await writeFile(inlineCommonTask, "tampered task\n");
  await assert.rejects(
    validatePreparedDelivery(inlineRoot, inline, inputs),
    /prepared delivery common-task\.md/
  );
  await writeFile(inlineCommonTask, inputs.commonTask);
  const inlineGit = join(inlineRoot, ".git");
  await rm(inlineGit, { recursive: true });
  await symlink(temporaryRoot, inlineGit);
  await assert.rejects(
    validatePreparedDelivery(inlineRoot, inline, inputs),
    /prepared \.git must be a real directory/i
  );
  await rm(inlineGit);
  await mkdir(inlineGit);
  await assert.rejects(
    validatePreparedDelivery(inlineRoot, inline, inputs),
    /prepared \.git HEAD must be a regular non-symbolic-link file/i
  );

  const plausibleHead = "ref: refs/heads/main\n";
  const plausibleConfig = [
    "[core]",
    "\trepositoryformatversion = 0",
    "\tbare = false",
    ""
  ].join("\n");
  const externalHead = join(temporaryRoot, "external-head");
  await Promise.all([
    writeFile(externalHead, plausibleHead),
    writeFile(join(inlineGit, "config"), plausibleConfig)
  ]);
  await symlink(externalHead, join(inlineGit, "HEAD"));
  await assert.rejects(
    validatePreparedDelivery(inlineRoot, inline, inputs),
    /prepared \.git HEAD must be a regular non-symbolic-link file/i
  );
  await rm(join(inlineGit, "HEAD"));
  await writeFile(join(inlineGit, "HEAD"), "not a plausible Git HEAD\n");
  await assert.rejects(
    validatePreparedDelivery(inlineRoot, inline, inputs),
    /prepared \.git HEAD is not plausible Git metadata/i
  );
  await writeFile(join(inlineGit, "HEAD"), plausibleHead);
  await writeFile(join(inlineGit, "config"), "not a plausible Git config\n");
  await assert.rejects(
    validatePreparedDelivery(inlineRoot, inline, inputs),
    /prepared \.git config is not plausible Git metadata/i
  );
  const externalConfig = join(temporaryRoot, "external-config");
  await writeFile(externalConfig, plausibleConfig);
  await rm(join(inlineGit, "config"));
  await symlink(externalConfig, join(inlineGit, "config"));
  await assert.rejects(
    validatePreparedDelivery(inlineRoot, inline, inputs),
    /prepared \.git config must be a regular non-symbolic-link file/i
  );

  const skill = MATRIX.find((cell) => cell.id === "claude-haiku-skill");
  const skillRoot = join(root, "cells", skill.id);
  const injectedSkillFile = join(
    skillRoot,
    ".claude",
    "skills",
    "product-ui-designer",
    "tampered.md"
  );
  await writeFile(injectedSkillFile, "tampered skill\n");
  await assert.rejects(
    validatePreparedDelivery(skillRoot, skill, inputs),
    /prepared cell tree/
  );
  await rm(injectedSkillFile);

  const noPack = MATRIX.find(
    (cell) => cell.id === "codex-gpt-5-6-sol-no-pack"
  );
  const noPackRoot = join(root, "cells", noPack.id);
  const leakedInstruction = join(noPackRoot, "AGENTS.md");
  await writeFile(leakedInstruction, sharedBlock);
  await assert.rejects(
    validatePreparedDelivery(noPackRoot, noPack, inputs),
    /prepared cell tree/
  );
  await rm(leakedInstruction);

  const unexpectedFile = join(noPackRoot, "unexpected-notes.md");
  await writeFile(unexpectedFile, "unexpected output\n");
  await assert.rejects(
    validatePreparedDelivery(noPackRoot, noPack, inputs),
    /prepared cell tree/
  );
  await rm(unexpectedFile);

  for (const phase of ["baseline", "final"]) {
    const phaseRoot = join(noPackRoot, "runs", phase);
    await mkdir(join(phaseRoot, "screenshots"), { recursive: true });
    await Promise.all([
      writeFile(join(phaseRoot, "audit.json"), "{}\n"),
      writeFile(join(phaseRoot, "metadata.json"), "{}\n"),
      writeFile(join(phaseRoot, "report-manifest.json"), "{}\n"),
      writeFile(join(phaseRoot, "report.md"), "# report\n"),
      writeFile(join(phaseRoot, "screenshots", "desktop.png"), "desktop"),
      writeFile(join(phaseRoot, "screenshots", "mobile.png"), "mobile")
    ]);
  }
  await validatePreparedDelivery(noPackRoot, noPack, inputs, {
    allowAuditArtifacts: true
  });
  const unexpectedAuditFile = join(
    noPackRoot,
    "runs",
    "final",
    "unexpected.json"
  );
  await writeFile(unexpectedAuditFile, "{}\n");
  await assert.rejects(
    validatePreparedDelivery(noPackRoot, noPack, inputs, {
      allowAuditArtifacts: true
    }),
    /prepared cell tree/
  );
  await rm(join(noPackRoot, "runs"), { recursive: true });

  const nonEmpty = join(temporaryRoot, "non-empty");
  await mkdir(nonEmpty);
  await writeFile(join(nonEmpty, "sentinel"), "keep");
  await assert.rejects(
    prepareCellRoots(nonEmpty),
    /destination must be empty/i
  );

  await assert.rejects(
    prepareCellRoots(join(process.cwd(), ".obedience-v1-invalid-inside-repo")),
    /outside and must not contain the source repository/i
  );
  await assert.rejects(
    prepareCellRoots(join(process.cwd(), "..scratch")),
    /outside and must not contain the source repository/i
  );

  const noGitDestination = join(temporaryRoot, "prepared-without-git");
  await mkdir(noGitDestination);
  const originalPath = process.env.PATH;
  let noGitPreparation;
  try {
    process.env.PATH = "";
    noGitPreparation = await prepareCellRoots(noGitDestination);
  } finally {
    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }
  }
  for (const expected of MATRIX) {
    const cellRoot = join(noGitPreparation.root, "cells", expected.id);
    const request = JSON.parse(
      await readFile(join(cellRoot, "request-metadata.json"), "utf8")
    );
    assert.deepEqual(request.git, {
      initialized: false,
      reason: "git-unavailable"
    });
    await assertMissing(join(cellRoot, ".git"));
    await validatePreparedDelivery(cellRoot, expected, inputs);
  }
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log(
  "Validated obedience-v1 preparation isolation, Git/no-Git delivery, and private retry evidence."
);

async function assertMissing(path) {
  await assert.rejects(stat(path), (error) => error?.code === "ENOENT");
}

function operatorEvidenceRegressionFixture() {
  const cells = Object.fromEntries(
    MATRIX.map((expected, index) => [
      expected.id,
      operatorEvidenceCell(expected, index)
    ])
  );

  const successfulRetry = cells[MATRIX[0].id];
  successfulRetry.attempts = [
    failedAttempt(successfulRetry.attempts[0], {
      operationalFailureKind: "authentication",
      retryReason: "operator-recorded authentication retry",
      resolvedModel: null
    }),
    {
      ...successfulRetry.attempts[0],
      index: 2,
      startedAt: "2026-07-24T00:00:04.000Z",
      endedAt: "2026-07-24T00:00:05.000Z",
      privateTranscriptSha256: sha256("private-successful-retry")
    }
  ];
  successfulRetry.acceptedAttemptIndex = 2;

  const exhaustedRetry = cells[MATRIX[1].id];
  exhaustedRetry.attempts = [
    failedAttempt(exhaustedRetry.attempts[0], {
      operationalFailureKind: "transient-tool",
      retryReason: "operator-recorded transient tool retry"
    }),
    failedAttempt(
      {
        ...exhaustedRetry.attempts[0],
        index: 2,
        startedAt: "2026-07-24T00:01:04.000Z",
        endedAt: "2026-07-24T00:01:05.000Z",
        privateTranscriptSha256: sha256("private-exhausted-retry")
      },
      {
        operationalFailureKind: null,
        retryReason: null
      }
    )
  ];
  exhaustedRetry.acceptedAttemptIndex = 2;

  const unavailable = cells[MATRIX[2].id];
  unavailable.executor.resolvedModel = null;
  unavailable.attempts[0] = {
    ...unavailable.attempts[0],
    status: "unavailable",
    exitStatus: null,
    resolvedModel: null
  };

  return {
    schemaVersion: "obedience-v1/operator-evidence/v1",
    recordedAt: "2026-07-24T00:59:00.000Z",
    cells
  };
}

function operatorEvidenceCell(expected, index) {
  const resolvedModel =
    expected.executorFamily === "codex-cli"
      ? expected.requestedModel
      : `claude-${expected.requestedModel}-regression`;
  const minute = String(index).padStart(2, "0");
  return {
    executor: {
      binaryName: expectedExecutableFor(expected),
      cliVersion: "regression-1.0.0",
      versionSource: "operator-path",
      requestedModel: expected.requestedModel,
      resolvedModel,
      effort: expected.effort ?? "provider-default"
    },
    commandDescriptor: {
      executable: expectedExecutableFor(expected),
      invocationMode: "non-interactive",
      requestedModel: expected.requestedModel,
      effort: expected.effort ?? "provider-default",
      promptInputMode: "common-task-then-delivery-stanza",
      deliveryMechanism: expected.mechanism
    },
    editBoundary: {
      passed: true,
      modifiedPaths: []
    },
    attempts: [
      {
        index: 1,
        status: "completed",
        operationalFailureKind: null,
        retryReason: null,
        startedAt: `2026-07-24T00:${minute}:02.000Z`,
        endedAt: `2026-07-24T00:${minute}:03.000Z`,
        wallTimeMs: 1000,
        exitStatus: 0,
        signal: null,
        timedOut: false,
        usage: null,
        privateTranscriptSha256: sha256(`private-${expected.id}`),
        resolvedModel
      }
    ],
    acceptedAttemptIndex: 1
  };
}

function failedAttempt(
  attempt,
  {
    operationalFailureKind,
    retryReason,
    resolvedModel = attempt.resolvedModel
  }
) {
  return {
    ...attempt,
    status: "error",
    operationalFailureKind,
    retryReason,
    exitStatus: 1,
    resolvedModel
  };
}

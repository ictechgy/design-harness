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
  readCanonicalSharedBlock,
  readCommonInputs,
  sha256
} from "./contract.mjs";
import { validatePreparedDelivery } from "./import.mjs";
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
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log("Validated obedience-v1 preparation isolation and delivery matrix.");

async function assertMissing(path) {
  await assert.rejects(stat(path), (error) => error?.code === "ENOENT");
}

#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  cp,
  mkdir,
  writeFile
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BENCHMARK_ID,
  EXPECTED_EXECUTION_COUNT,
  MATRIX,
  REPO_ROOT,
  canonicalEmptyExternalDestination,
  canonicalJson,
  currentSourceCommit,
  deliveryStanzaForExecution,
  executionInputHashes,
  expectedDeliveryForExecution,
  hashHarnessBuild,
  hashDeliveryMaterial,
  publicExecutionDescriptor,
  readAllInputs,
  readCanonicalSharedBlock,
  sha256
} from "./contract.mjs";

const MANIFEST_NAME = "preparation-manifest.json";
const REQUEST_NAME = "request-metadata.json";

export async function prepareRepeatedBenchmark(destination) {
  const root = await canonicalEmptyExternalDestination(destination);
  const [inputs, sharedBlock, harnessBuildSha256] = await Promise.all([
    readAllInputs(),
    readCanonicalSharedBlock(),
    hashHarnessBuild()
  ]);
  const sharedRulesSha256 = sha256(sharedBlock);
  const sourceCommit = currentSourceCommit();
  await mkdir(root, { recursive: true });

  const executions = [];
  for (const execution of MATRIX) {
    const cellRoot = join(root, "cells", execution.id);
    const caseInputs = inputs.cases.get(execution.caseId);
    await mkdir(cellRoot, { recursive: true });
    const deliveryStanza = deliveryStanzaForExecution(execution);

    await Promise.all([
      writeFile(join(cellRoot, "fixture.html"), caseInputs.fixture, {
        flag: "wx"
      }),
      writeFile(join(cellRoot, "copy-style.yaml"), inputs.shared.copyStyle, {
        flag: "wx"
      }),
      writeFile(join(cellRoot, "common-task.md"), inputs.shared.commonTask, {
        flag: "wx"
      }),
      writeFile(
        join(cellRoot, "preservation-oracle.json"),
        caseInputs.preservationOracleBytes,
        { flag: "wx" }
      ),
      writeFile(join(cellRoot, "delivery-stanza.md"), deliveryStanza, {
        flag: "wx"
      })
    ]);

    const delivery = await materializeDelivery(
      execution,
      cellRoot,
      sharedBlock
    );
    const deliveryMaterialSha256 = await hashDeliveryMaterial(
      execution,
      sharedBlock
    );
    const git = initializeGitRoot(cellRoot);
    const request = {
      schemaVersion: "obedience-repeated-v1/request/v1",
      benchmarkId: BENCHMARK_ID,
      ...publicExecutionDescriptor(execution),
      cellRoot: `cells/${execution.id}`,
      taskInput: {
        commonTaskPath: "common-task.md",
        deliveryStanzaPath: "delivery-stanza.md",
        promptInputMode: "common-task-then-delivery-stanza"
      },
      delivery,
      inputHashes: executionInputHashes({
        shared: inputs.shared,
        caseInputs,
        deliveryStanza,
        sharedRulesSha256,
        deliveryMaterialSha256
      }),
      harness: {
        sourceCommit,
        buildSha256: harnessBuildSha256
      },
      executionContract: {
        providerCommand: "operator-supplied-untracked",
        agentPassCount: 1,
        baselineAuditCount: 1,
        finalAuditCount: 1,
        maximumAttempts: 2,
        retryPolicy: "pre-result-authentication-or-transient-tool-only",
        editablePaths: ["fixture.html"]
      },
      git
    };
    await writeFile(
      join(cellRoot, REQUEST_NAME),
      canonicalJson(request),
      { flag: "wx" }
    );
    executions.push(request);
  }

  const manifest = {
    schemaVersion: "obedience-repeated-v1/preparation/v1",
    benchmarkId: BENCHMARK_ID,
    destination: "operator-selected-external-root",
    providerExecution: "not-performed",
    matrixSize: MATRIX.length,
    expectedExecutionCount: EXPECTED_EXECUTION_COUNT,
    sourceCommit,
    harnessBuildSha256,
    sharedInputHashes: inputs.shared.hashes,
    caseInputHashes: Object.fromEntries(
      [...inputs.cases].map(([caseId, value]) => [caseId, value.hashes])
    ),
    executions
  };
  await writeFile(
    join(root, MANIFEST_NAME),
    canonicalJson(manifest),
    { flag: "wx" }
  );
  return { root, manifest };
}

async function materializeDelivery(execution, cellRoot, sharedBlock) {
  const expected = expectedDeliveryForExecution(execution);
  if (expected.instructionFile) {
    await writeFile(
      join(cellRoot, expected.instructionFile),
      sharedBlock,
      { flag: "wx" }
    );
  }
  if (expected.skillDirectory) {
    const source =
      execution.executorFamily === "claude-code"
        ? resolve(REPO_ROOT, "adapters/claude-code-skill")
        : resolve(REPO_ROOT, "adapters/codex-skill");
    await mkdir(dirname(join(cellRoot, expected.skillDirectory)), {
      recursive: true
    });
    await cp(source, join(cellRoot, expected.skillDirectory), {
      recursive: true,
      errorOnExist: true,
      force: false
    });
  }
  return expected;
}

function initializeGitRoot(cellRoot) {
  const result = spawnSync("git", ["init", "--quiet"], {
    cwd: cellRoot,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "" }
  });
  if (result.error?.code === "ENOENT") {
    return { initialized: false, reason: "git-unavailable" };
  }
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `Could not initialize isolated Git root: ${(result.stderr || result.stdout).trim()}`
    );
  }
  return { initialized: true, reason: null };
}

function parseArgs(argv) {
  let destination;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      return { help: true };
    }
    if (argument === "--destination") {
      if (destination !== undefined) {
        throw new Error("--destination may be provided only once");
      }
      destination = argv[index + 1];
      index += 1;
      if (!destination || destination.startsWith("--")) {
        throw new Error("--destination requires a path");
      }
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  if (!destination) {
    throw new Error("--destination is required");
  }
  return { destination };
}

function usage() {
  return [
    "Usage:",
    "  node scripts/obedience-repeated/prepare.mjs --destination <outside-repository-directory>",
    "",
    "Creates exactly 72 isolated cells and never invokes a provider."
  ].join("\n");
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isDirectExecution) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
    } else {
      const { root, manifest } = await prepareRepeatedBenchmark(
        options.destination
      );
      console.log(
        `Prepared ${manifest.matrixSize} provider-neutral ${BENCHMARK_ID} cells at ${relative(process.cwd(), root) || "."}.`
      );
    }
  } catch (error) {
    console.error(`${BENCHMARK_ID} preparation failed: ${error.message}`);
    console.error(usage());
    process.exitCode = 1;
  }
}

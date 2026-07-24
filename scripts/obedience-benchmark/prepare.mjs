#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  cp,
  lstat,
  mkdir,
  readdir,
  realpath,
  writeFile
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MATRIX,
  REPO_ROOT,
  canonicalJson,
  deliveryStanzaFor,
  expectedDeliveryForCell,
  isPathInside,
  publicCellDescriptor,
  readCommonInputs,
  sha256
} from "./contract.mjs";

const MANIFEST_NAME = "preparation-manifest.json";
const REQUEST_NAME = "request-metadata.json";

function usage() {
  return [
    "Usage:",
    "  node scripts/obedience-benchmark/prepare.mjs --destination <outside-repository-directory>",
    "",
    "Creates the exact twelve isolated benchmark cells. It never invokes a model provider."
  ].join("\n");
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

async function canonicalDestination(candidate) {
  const absolute = resolve(candidate);
  let cursor = absolute;
  const suffix = [];

  while (true) {
    try {
      const info = await lstat(cursor);
      if (!info.isDirectory()) {
        throw new Error(`Destination ancestor is not a directory: ${cursor}`);
      }
      const canonicalParent = await realpath(cursor);
      return resolve(canonicalParent, ...suffix.reverse());
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
      const parent = dirname(cursor);
      if (parent === cursor) {
        throw new Error(`Could not resolve a real ancestor for destination: ${absolute}`);
      }
      suffix.push(cursor.slice(parent.length + (parent.endsWith("/") ? 0 : 1)));
      cursor = parent;
    }
  }
}

async function assertSafeEmptyDestination(candidate) {
  const canonical = await canonicalDestination(candidate);
  const canonicalRepo = await realpath(REPO_ROOT);

  if (
    canonical === canonicalRepo ||
    isPathInside(canonicalRepo, canonical) ||
    isPathInside(canonical, canonicalRepo)
  ) {
    throw new Error("Benchmark destination must be outside and must not contain the source repository");
  }

  try {
    const destinationInfo = await lstat(canonical);
    if (!destinationInfo.isDirectory() || destinationInfo.isSymbolicLink()) {
      throw new Error("Benchmark destination must be a real directory, not a file or symbolic link");
    }
    const entries = await readdir(canonical);
    if (entries.length > 0) {
      throw new Error("Benchmark destination must be empty");
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  return canonical;
}

function initializeGitRoot(cellRoot) {
  const outcome = spawnSync("git", ["init", "--quiet"], {
    cwd: cellRoot,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH ?? ""
    }
  });

  if (outcome.error?.code === "ENOENT") {
    return { initialized: false, reason: "git-unavailable" };
  }
  if (outcome.error) {
    throw outcome.error;
  }
  if (outcome.status !== 0) {
    const message = (outcome.stderr || outcome.stdout || "unknown git init error").trim();
    throw new Error(`Could not initialize isolated Git root: ${message}`);
  }
  return { initialized: true, reason: null };
}

async function materializeDelivery(cell, cellRoot, sharedBlock) {
  const expected = expectedDeliveryForCell(cell);
  if (expected.instructionFile) {
    await writeFile(join(cellRoot, expected.instructionFile), sharedBlock, { flag: "wx" });
  }

  if (expected.skillDirectory) {
    const source =
      cell.executorFamily === "claude-code"
        ? resolve(REPO_ROOT, "adapters/claude-code-skill")
        : resolve(REPO_ROOT, "adapters/codex-skill");
    await mkdir(dirname(join(cellRoot, expected.skillDirectory)), { recursive: true });
    await cp(source, join(cellRoot, expected.skillDirectory), {
      recursive: true,
      errorOnExist: true,
      force: false
    });
  }
  return expected;
}

export async function prepareCellRoots(destination) {
  const root = await assertSafeEmptyDestination(destination);
  const inputs = await readCommonInputs();
  await mkdir(root, { recursive: true });

  const cells = [];
  for (const cell of MATRIX) {
    const cellRoot = join(root, "cells", cell.id);
    await mkdir(cellRoot, { recursive: true });

    await Promise.all([
      writeFile(join(cellRoot, "fixture.html"), inputs.fixture, { flag: "wx" }),
      writeFile(join(cellRoot, "copy-style.yaml"), inputs.copyStyle, { flag: "wx" }),
      writeFile(join(cellRoot, "common-task.md"), inputs.commonTask, { flag: "wx" }),
      writeFile(join(cellRoot, "preservation-oracle.json"), inputs.preservationOracleBytes, {
        flag: "wx"
      })
    ]);

    const stanza = deliveryStanzaFor(cell);
    await writeFile(join(cellRoot, "delivery-stanza.md"), stanza, { flag: "wx" });
    const delivery = await materializeDelivery(cell, cellRoot, inputs.sharedBlock);
    const git = initializeGitRoot(cellRoot);

    const request = {
      schemaVersion: "obedience-v1/request-metadata/v1",
      benchmarkId: "obedience-v1",
      ...publicCellDescriptor(cell),
      cellRoot: `cells/${cell.id}`,
      taskInput: {
        commonTaskPath: "common-task.md",
        deliveryStanzaPath: "delivery-stanza.md",
        promptInputMode: "common-task-then-delivery-stanza"
      },
      delivery,
      inputHashes: {
        ...inputs.hashes,
        deliveryStanzaSha256: sha256(stanza)
      },
      executionContract: {
        providerCommand: "operator-supplied-untracked",
        agentPassCount: 1,
        baselineAuditCount: 1,
        finalAuditCount: 1,
        editablePaths: ["fixture.html"]
      },
      git
    };
    await writeFile(join(cellRoot, REQUEST_NAME), canonicalJson(request), { flag: "wx" });
    cells.push(request);
  }

  const manifest = {
    schemaVersion: "obedience-v1/preparation/v1",
    benchmarkId: "obedience-v1",
    destination: "operator-selected-external-root",
    providerExecution: "not-performed",
    matrixSize: MATRIX.length,
    commonInputHashes: inputs.hashes,
    cells
  };
  await writeFile(join(root, MANIFEST_NAME), canonicalJson(manifest), { flag: "wx" });
  return { root, manifest };
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
      const { root, manifest } = await prepareCellRoots(options.destination);
      const relativeFromCwd = relative(process.cwd(), root) || ".";
      console.log(
        `Prepared ${manifest.matrixSize} provider-neutral obedience-v1 cells at ${relativeFromCwd}.`
      );
    }
  } catch (error) {
    console.error(`obedience-v1 preparation failed: ${error.message}`);
    console.error(usage());
    process.exitCode = 1;
  }
}

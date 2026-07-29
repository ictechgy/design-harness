import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  lstat,
  readFile,
  readdir,
  realpath,
  stat
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  MATRIX as BASE_MATRIX,
  REPO_ROOT,
  canonicalJson,
  deliveryStanzaFor,
  expectedDeliveryForCell,
  expectedExecutableFor,
  resolvedModelMatches,
  sha256
} from "../obedience-benchmark/contract.mjs";

export {
  REPO_ROOT,
  canonicalJson,
  expectedExecutableFor,
  resolvedModelMatches,
  sha256
};

export const BENCHMARK_ID = "obedience-repeated-v1";
export const BENCHMARK_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../docs/benchmarks/obedience-repeated-v1"
);
export const V1_ROOT = resolve(BENCHMARK_ROOT, "../obedience-v1");
export const REPEAT_COUNT = 3;
export const EXPECTED_EXECUTION_COUNT = 72;
export const AUDIT_CONFIG_DESCRIPTOR = Object.freeze({
  command: "design-harness audit",
  copyStyle: "copy-style.yaml",
  output: "runs/<stage>",
  target: "http://127.0.0.1:<ephemeral>/fixture.html",
  viewportSet: "default-desktop-mobile"
});
export const AUDIT_CONFIG_SHA256 = sha256(
  canonicalJson(AUDIT_CONFIG_DESCRIPTOR)
);

export const CASES = Object.freeze([
  Object.freeze({
    id: "operations-queue",
    label: "Operations queue",
    fixturePath: resolve(V1_ROOT, "fixture.html"),
    preservationOraclePath: resolve(V1_ROOT, "preservation-oracle.json")
  }),
  Object.freeze({
    id: "support-triage",
    label: "Support triage",
    fixturePath: resolve(
      BENCHMARK_ROOT,
      "cases/support-triage/fixture.html"
    ),
    preservationOraclePath: resolve(
      BENCHMARK_ROOT,
      "cases/support-triage/preservation-oracle.json"
    )
  })
]);

export const CASE_BY_ID = new Map(CASES.map((entry) => [entry.id, entry]));

export const MATRIX = Object.freeze(
  CASES.flatMap((benchmarkCase) =>
    Array.from({ length: REPEAT_COUNT }, (_, index) => index + 1).flatMap(
      (repeat) =>
        BASE_MATRIX.map((coordinate) =>
          Object.freeze({
            id: `${benchmarkCase.id}-r${repeat}-${coordinate.id}`,
            caseId: benchmarkCase.id,
            caseLabel: benchmarkCase.label,
            repeat,
            coordinateId: coordinate.id,
            executorFamily: coordinate.executorFamily,
            executorLabel: coordinate.executorLabel,
            requestedModel: coordinate.requestedModel,
            effort: coordinate.effort,
            effortSupport: coordinate.effortSupport,
            mechanism: coordinate.mechanism
          })
        )
    )
  )
);

export const EXECUTION_BY_ID = new Map(MATRIX.map((entry) => [entry.id, entry]));

export function baseCoordinateFor(execution) {
  const coordinate = BASE_MATRIX.find(
    (entry) => entry.id === execution?.coordinateId
  );
  if (!coordinate) {
    throw new Error(
      `Unknown repeated obedience coordinate: ${execution?.coordinateId ?? "<missing>"}`
    );
  }
  return coordinate;
}

export function deliveryStanzaForExecution(execution) {
  return deliveryStanzaFor(baseCoordinateFor(execution));
}

export function expectedDeliveryForExecution(execution) {
  return expectedDeliveryForCell(baseCoordinateFor(execution));
}

export function expectedExecutableForExecution(execution) {
  return expectedExecutableFor(baseCoordinateFor(execution));
}

export function resolvedModelMatchesExecution(execution, resolvedModel) {
  return resolvedModelMatches(baseCoordinateFor(execution), resolvedModel);
}

export function publicExecutionDescriptor(execution) {
  if (!EXECUTION_BY_ID.has(execution?.id)) {
    throw new Error(
      `Unknown repeated obedience execution: ${execution?.id ?? "<missing>"}`
    );
  }
  return {
    id: execution.id,
    caseId: execution.caseId,
    caseLabel: execution.caseLabel,
    repeat: execution.repeat,
    coordinateId: execution.coordinateId,
    executorFamily: execution.executorFamily,
    executorLabel: execution.executorLabel,
    requestedModel: execution.requestedModel,
    effort: execution.effort,
    effortSupport: execution.effortSupport,
    mechanism: execution.mechanism
  };
}

export async function readSharedInputs({
  benchmarkRoot = BENCHMARK_ROOT
} = {}) {
  const root = resolve(benchmarkRoot);
  const [commonTask, copyStyle, protocol] = await Promise.all([
    readFile(resolve(root, "common-task.md")),
    readFile(resolve(root, "copy-style.yaml")),
    readFile(resolve(root, "protocol.md"))
  ]);
  return {
    commonTask,
    copyStyle,
    protocol,
    hashes: {
      commonTaskSha256: sha256(commonTask),
      copyStyleSha256: sha256(copyStyle),
      protocolSha256: sha256(protocol)
    }
  };
}

export async function readCaseInputs(
  caseId,
  { benchmarkRoot = BENCHMARK_ROOT } = {}
) {
  const benchmarkCase = CASE_BY_ID.get(caseId);
  if (!benchmarkCase) {
    throw new Error(`Unknown repeated obedience case: ${String(caseId)}`);
  }
  const root = resolve(benchmarkRoot);
  const fixturePath =
    caseId === "operations-queue"
      ? benchmarkCase.fixturePath
      : resolve(root, "cases", caseId, "fixture.html");
  const preservationOraclePath =
    caseId === "operations-queue"
      ? benchmarkCase.preservationOraclePath
      : resolve(root, "cases", caseId, "preservation-oracle.json");
  const [fixture, preservationOracleBytes] = await Promise.all([
    readFile(fixturePath),
    readFile(preservationOraclePath)
  ]);
  let preservationOracle;
  try {
    preservationOracle = JSON.parse(
      preservationOracleBytes.toString("utf8")
    );
  } catch (error) {
    throw new Error(
      `${caseId} preservation oracle is invalid JSON: ${error.message}`
    );
  }
  return {
    benchmarkCase,
    fixture,
    preservationOracleBytes,
    preservationOracle,
    hashes: {
      fixtureSha256: sha256(fixture),
      preservationOracleSha256: sha256(preservationOracleBytes)
    }
  };
}

export async function readAllInputs({
  benchmarkRoot = BENCHMARK_ROOT
} = {}) {
  const [shared, caseEntries] = await Promise.all([
    readSharedInputs({ benchmarkRoot }),
    Promise.all(
      CASES.map((entry) =>
        readCaseInputs(entry.id, { benchmarkRoot })
      )
    )
  ]);
  return {
    shared,
    cases: new Map(
      caseEntries.map((entry) => [entry.benchmarkCase.id, entry])
    )
  };
}

export function executionInputHashes({
  shared,
  caseInputs,
  deliveryStanza,
  sharedRulesSha256,
  deliveryMaterialSha256
}) {
  return {
    ...shared.hashes,
    ...caseInputs.hashes,
    deliveryStanzaSha256: sha256(deliveryStanza),
    deliveryMaterialSha256,
    sharedRulesSha256,
    harnessConfigSha256: AUDIT_CONFIG_SHA256
  };
}

export async function hashDeliveryMaterial(execution, sharedBlock) {
  if (execution.mechanism === "inline") {
    return sha256(sharedBlock);
  }
  if (execution.mechanism === "no-pack") {
    return sha256("obedience-repeated-v1:no-pack\n");
  }
  const source =
    execution.executorFamily === "claude-code"
      ? resolve(REPO_ROOT, "adapters/claude-code-skill")
      : resolve(REPO_ROOT, "adapters/codex-skill");
  const hash = createHash("sha256");
  for (const path of await regularFilesRecursively(source)) {
    hash.update(relative(source, path).split(sep).join("/"));
    hash.update("\0");
    hash.update(await readFile(path));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export async function readCanonicalSharedBlock() {
  const path = resolve(REPO_ROOT, "adapters/shared/rules.md");
  const source = await readFile(path, "utf8");
  const beginMarker = "<!-- design-harness:shared:begin -->";
  const endMarker = "<!-- design-harness:shared:end -->";
  const begin = source.indexOf(beginMarker);
  const end = source.indexOf(endMarker);
  if (begin === -1 || end === -1 || end <= begin) {
    throw new Error(
      "adapters/shared/rules.md has missing or malformed shared-rule markers"
    );
  }
  const block = source
    .slice(begin + beginMarker.length, end)
    .replace(/^\r?\n/, "")
    .replace(/\s+$/, "");
  if (!block) {
    throw new Error("adapters/shared/rules.md has an empty shared-rule block");
  }
  return `${block}\n`;
}

export function isPathInside(parent, candidate) {
  const pathFromParent = relative(resolve(parent), resolve(candidate));
  return (
    pathFromParent !== "" &&
    pathFromParent !== ".." &&
    !pathFromParent.startsWith(`..${sep}`) &&
    !isAbsolute(pathFromParent)
  );
}

export async function canonicalEmptyExternalDestination(candidate) {
  const absolute = resolve(candidate);
  let cursor = absolute;
  const suffix = [];
  while (true) {
    try {
      const info = await lstat(cursor);
      if (!info.isDirectory() || info.isSymbolicLink()) {
        throw new Error(
          `Destination ancestor must be a real directory: ${cursor}`
        );
      }
      const canonicalParent = await realpath(cursor);
      const canonical = resolve(canonicalParent, ...suffix.reverse());
      const canonicalRepo = await realpath(REPO_ROOT);
      if (
        canonical === canonicalRepo ||
        isPathInside(canonicalRepo, canonical) ||
        isPathInside(canonical, canonicalRepo)
      ) {
        throw new Error(
          "Benchmark destination must be outside and must not contain the repository"
        );
      }
      try {
        const destinationInfo = await lstat(canonical);
        if (
          !destinationInfo.isDirectory() ||
          destinationInfo.isSymbolicLink()
        ) {
          throw new Error(
            "Benchmark destination must be a real directory"
          );
        }
        if ((await readdir(canonical)).length > 0) {
          throw new Error("Benchmark destination must be empty");
        }
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw error;
        }
      }
      return canonical;
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
      const parent = dirname(cursor);
      if (parent === cursor) {
        throw new Error(
          `Could not resolve a real ancestor for destination: ${absolute}`
        );
      }
      suffix.push(cursor.slice(parent.length + (parent.endsWith("/") ? 0 : 1)));
      cursor = parent;
    }
  }
}

export async function hashHarnessBuild() {
  const roots = [
    "packages/core/dist",
    "packages/copy-audit/dist",
    "packages/visual-audit/dist",
    "packages/cli/dist"
  ];
  const hash = createHash("sha256");
  for (const relativeRoot of roots) {
    const absoluteRoot = resolve(REPO_ROOT, relativeRoot);
    const files = await regularFilesRecursively(absoluteRoot);
    for (const path of files) {
      const label = relative(REPO_ROOT, path).split(sep).join("/");
      hash.update(label);
      hash.update("\0");
      hash.update(await readFile(path));
      hash.update("\0");
    }
  }
  return hash.digest("hex");
}

async function regularFilesRecursively(root) {
  const output = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      output.push(...await regularFilesRecursively(path));
    } else if (entry.isFile()) {
      const info = await stat(path);
      if (info.isFile()) {
        output.push(path);
      }
    } else {
      throw new Error(`Harness build contains unsupported entry: ${path}`);
    }
  }
  return output.sort();
}

export function currentSourceCommit() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "" }
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error("Could not resolve Harness source commit");
  }
  return result.stdout.trim();
}

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const BENCHMARK_ROOT = resolve(REPO_ROOT, "docs/benchmarks/obedience-v1");

export const INPUT_PATHS = Object.freeze({
  fixture: resolve(BENCHMARK_ROOT, "fixture.html"),
  copyStyle: resolve(BENCHMARK_ROOT, "copy-style.yaml"),
  commonTask: resolve(BENCHMARK_ROOT, "common-task.md"),
  preservationOracle: resolve(BENCHMARK_ROOT, "preservation-oracle.json"),
  protocol: resolve(BENCHMARK_ROOT, "protocol.md"),
  sharedRules: resolve(REPO_ROOT, "adapters/shared/rules.md"),
  claudeSkill: resolve(REPO_ROOT, "adapters/claude-code-skill"),
  codexSkill: resolve(REPO_ROOT, "adapters/codex-skill")
});

const MECHANISMS = Object.freeze(["inline", "skill", "no-pack"]);

const modelRows = [
  {
    executorFamily: "claude-code",
    executorLabel: "Claude Code",
    requestedModel: "haiku",
    effort: null,
    effortSupport: "unsupported"
  },
  {
    executorFamily: "claude-code",
    executorLabel: "Claude Code",
    requestedModel: "sonnet",
    effort: "low",
    effortSupport: "explicit"
  },
  {
    executorFamily: "claude-code",
    executorLabel: "Claude Code",
    requestedModel: "opus",
    effort: "low",
    effortSupport: "explicit"
  },
  {
    executorFamily: "codex-cli",
    executorLabel: "Codex CLI",
    requestedModel: "gpt-5.6-sol",
    effort: "low",
    effortSupport: "explicit"
  }
];

function modelSlug(model) {
  return model.replaceAll(".", "-");
}

export const MATRIX = Object.freeze(
  modelRows.flatMap((row) =>
    MECHANISMS.map((mechanism) =>
      Object.freeze({
        id: `${row.executorFamily === "claude-code" ? "claude" : "codex"}-${modelSlug(row.requestedModel)}-${mechanism}`,
        ...row,
        mechanism
      })
    )
  )
);

export const CELL_BY_ID = new Map(MATRIX.map((cell) => [cell.id, cell]));

const EXECUTABLE_BY_EXECUTOR_FAMILY = Object.freeze({
  "claude-code": "claude",
  "codex-cli": "codex"
});

export function expectedExecutableFor(cell) {
  const executable = EXECUTABLE_BY_EXECUTOR_FAMILY[cell?.executorFamily];
  if (executable === undefined) {
    throw new Error(
      `Unsupported obedience benchmark executor family: ${String(cell?.executorFamily)}`
    );
  }
  return executable;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)])
    );
  }
  return value;
}

export function canonicalJson(value) {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
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

export function resolvedModelMatches(cell, resolvedModel) {
  if (typeof resolvedModel !== "string" || resolvedModel.trim() === "") {
    return false;
  }
  const resolved = resolvedModel.toLowerCase();
  const requested = cell.requestedModel.toLowerCase();
  if (cell.executorFamily === "codex-cli") {
    return resolved === requested;
  }
  const claudePrefix = `claude-${requested}`;
  return resolved === claudePrefix || resolved.startsWith(`${claudePrefix}-`);
}

export async function readCanonicalSharedBlock() {
  const source = await readFile(INPUT_PATHS.sharedRules, "utf8");
  const beginMarker = "<!-- design-harness:shared:begin -->";
  const endMarker = "<!-- design-harness:shared:end -->";
  const begin = source.indexOf(beginMarker);
  const end = source.indexOf(endMarker);

  if (begin === -1 || end === -1 || end <= begin) {
    throw new Error("adapters/shared/rules.md has missing or malformed shared-rule markers");
  }

  const beforeBlock = begin + beginMarker.length;
  const block = source.slice(beforeBlock, end).replace(/^\r?\n/, "").replace(/\s+$/, "");
  if (block.length === 0) {
    throw new Error("adapters/shared/rules.md has an empty shared-rule block");
  }
  return `${block}\n`;
}

export async function readCommonInputs() {
  const [fixture, copyStyle, commonTask, preservationOracleBytes, protocol, sharedBlock] =
    await Promise.all([
      readFile(INPUT_PATHS.fixture),
      readFile(INPUT_PATHS.copyStyle),
      readFile(INPUT_PATHS.commonTask),
      readFile(INPUT_PATHS.preservationOracle),
      readFile(INPUT_PATHS.protocol),
      readCanonicalSharedBlock()
    ]);

  let preservationOracle;
  try {
    preservationOracle = JSON.parse(preservationOracleBytes.toString("utf8"));
  } catch (error) {
    throw new Error(`Invalid preservation oracle JSON: ${error.message}`);
  }

  return {
    fixture,
    copyStyle,
    commonTask,
    preservationOracleBytes,
    preservationOracle,
    protocol,
    sharedBlock,
    hashes: Object.freeze({
      fixtureSha256: sha256(fixture),
      copyStyleSha256: sha256(copyStyle),
      commonTaskSha256: sha256(commonTask),
      preservationOracleSha256: sha256(preservationOracleBytes),
      protocolSha256: sha256(protocol),
      sharedRulesSha256: sha256(sharedBlock)
    })
  };
}

export function deliveryStanzaFor(cell) {
  if (!CELL_BY_ID.has(cell?.id)) {
    throw new Error(`Unknown obedience benchmark cell: ${cell?.id ?? "<missing>"}`);
  }

  if (cell.mechanism === "inline") {
    const instructionFile = cell.executorFamily === "claude-code" ? "CLAUDE.md" : "AGENTS.md";
    return `The canonical Design Harness rules are present in \`${instructionFile}\`. Follow those rules while completing the unchanged common task.\n`;
  }
  if (cell.mechanism === "skill") {
    const invocation =
      cell.executorFamily === "claude-code"
        ? "`/product-ui-designer`"
        : "`$product-ui-designer`";
    return `Invoke ${invocation} while completing the unchanged common task.\n`;
  }
  return "No Design Harness rule pack is installed. Complete the unchanged common task.\n";
}

export function expectedDeliveryForCell(cell) {
  if (!CELL_BY_ID.has(cell?.id)) {
    throw new Error(`Unknown obedience benchmark cell: ${cell?.id ?? "<missing>"}`);
  }

  if (cell.mechanism === "inline") {
    return {
      instructionFile: cell.executorFamily === "claude-code" ? "CLAUDE.md" : "AGENTS.md",
      skillDirectory: null
    };
  }
  if (cell.mechanism === "skill") {
    return {
      instructionFile: null,
      skillDirectory:
        cell.executorFamily === "claude-code"
          ? ".claude/skills/product-ui-designer"
          : ".agents/skills/product-ui-designer"
    };
  }
  return { instructionFile: null, skillDirectory: null };
}

export function publicCellDescriptor(cell) {
  if (!CELL_BY_ID.has(cell?.id)) {
    throw new Error(`Unknown obedience benchmark cell: ${cell?.id ?? "<missing>"}`);
  }

  return {
    id: cell.id,
    executorFamily: cell.executorFamily,
    executorLabel: cell.executorLabel,
    requestedModel: cell.requestedModel,
    effort: cell.effort,
    effortSupport: cell.effortSupport,
    mechanism: cell.mechanism
  };
}

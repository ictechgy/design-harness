import { spawn } from "node:child_process";
import {
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const tempRoot = await mkdtemp(join(tmpdir(), "design-harness-guide-smoke-"));
const cliPath = resolve("packages/cli/dist/index.js");
const guideFixture = resolve("examples/configs/design-guide.example.yaml");
const copyFixture = resolve("examples/configs/copy-style.ko-example.yaml");

try {
  await assertGoldenProject();
  await assertExistingClaudeImport();
  await assertOutsideTargetFailsClosed();
  console.log("Guide smoke passed: compile/check, idempotence, drift, existing import, and containment verified.");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

async function assertGoldenProject() {
  const target = join(tempRoot, "golden");
  await createProject(target);
  await writeFile(join(target, "AGENTS.md"), "# Project agents\n\nKeep this prefix.\n");
  await writeFile(join(target, "DESIGN.md"), "# Human design notes\n");

  const first = await runGuide(target, "compile");
  assert(first.code === 0, `guide compile failed:\n${first.stderr}`);
  assert(first.stdout.includes("guide-token-estimate-v1"), "compile omitted the estimate method");

  const ownedPaths = ["AGENTS.md", "CLAUDE.md", "DESIGN.md", "design.tokens.json"];
  const before = await snapshot(target, ownedPaths);
  assert(before.get("AGENTS.md").source.startsWith("# Project agents\n\nKeep this prefix.\n"), "AGENTS prefix changed");
  assert(before.get("DESIGN.md").source.startsWith("# Human design notes\n"), "DESIGN prefix changed");
  assert(before.get("CLAUDE.md").source.includes("@AGENTS.md"), "Claude import was not generated");
  const tokenDocument = JSON.parse(before.get("design.tokens.json").source);
  assert(tokenDocument.$extensions?.["dev.design-harness"]?.sourceHash, "token ownership provenance missing");
  assert(tokenDocument.audit === undefined, "audit overlay leaked into generated token JSON");
  for (const [path, artifact] of before) {
    assert(
      !artifact.source.includes(".third-party-color-widget"),
      `color audit selector leaked into generated artifact: ${path}`
    );
  }

  const second = await runGuide(target, "compile");
  assert(second.code === 0, `second guide compile failed:\n${second.stderr}`);
  const afterSecond = await snapshot(target, ownedPaths);
  assertSnapshotsEqual(before, afterSecond, "second compile changed an owned artifact or mtime");

  const check = await runGuide(target, "check", ["--max-tokens", "2000"]);
  assert(check.code === 0, `guide check failed:\n${check.stderr}`);
  assert(check.stdout.includes("guide-token-estimate-v1"), "check omitted the estimate method");
  const afterCheck = await snapshot(target, ownedPaths);
  assertSnapshotsEqual(afterSecond, afterCheck, "guide check wrote an owned artifact");
  assert(!(await exists(join(target, ".design-harness-guide.lock"))), "guide transaction lock residue remained");

  const agentsPath = join(target, "AGENTS.md");
  await writeFile(agentsPath, before.get("AGENTS.md").source.replace("Purposeful", "Drifted"));
  const driftBefore = await snapshot(target, ownedPaths);
  const drift = await runGuide(target, "check");
  assert(drift.code === 1, `drifted guide check exited ${drift.code}, expected 1`);
  const driftAfter = await snapshot(target, ownedPaths);
  assertSnapshotsEqual(driftBefore, driftAfter, "drifted guide check performed a write");
}

async function assertExistingClaudeImport() {
  const target = join(tempRoot, "existing-import");
  await createProject(target);
  const original = "@AGENTS.md\n\n# Claude-only notes\n";
  await writeFile(join(target, "CLAUDE.md"), original);
  const result = await runGuide(target, "compile", [], false);
  assert(result.code === 0, `existing-import compile failed:\n${result.stderr}`);
  assert(await readFile(join(target, "CLAUDE.md"), "utf8") === original, "standalone Claude import changed");
}

async function assertOutsideTargetFailsClosed() {
  const target = join(tempRoot, "contained-project");
  await mkdir(target, { recursive: true });
  const outsideGuide = join(tempRoot, "outside-guide.yaml");
  await copyFile(guideFixture, outsideGuide);
  const result = await runProcess([
    "guide",
    "compile",
    "--guide",
    "outside-guide.yaml",
    "--target",
    "contained-project"
  ]);
  assert(result.code === 1, `outside-target guide exited ${result.code}, expected 1`);
  assert(result.stderr.includes("containment"), `outside-target error omitted containment phase:\n${result.stderr}`);
  assert(result.stderr.includes("inside --target"), `outside-target error was not actionable:\n${result.stderr}`);
  for (const file of ["AGENTS.md", "CLAUDE.md", "DESIGN.md", "design.tokens.json"]) {
    assert(!(await exists(join(target, file))), `outside-target failure created ${file}`);
  }
}

async function createProject(target) {
  await mkdir(target, { recursive: true });
  await copyFile(guideFixture, join(target, "design-guide.yaml"));
  await copyFile(copyFixture, join(target, "copy-style.yaml"));
}

async function runGuide(target, action, extra = [], includeCopy = true) {
  const relativeTarget = target.slice(tempRoot.length + 1);
  const args = [
    "guide",
    action,
    "--guide",
    `${relativeTarget}/design-guide.yaml`,
    "--target",
    relativeTarget
  ];
  if (includeCopy) {
    args.push("--copy", `${relativeTarget}/copy-style.yaml`);
  }
  args.push(...extra);
  return runProcess(args);
}

function runProcess(args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: tempRoot,
      env: { ...process.env, CI: "true" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => resolvePromise({ code: code ?? 1, stdout, stderr }));
  });
}

async function snapshot(target, paths) {
  const result = new Map();
  for (const path of paths) {
    const absolute = join(target, path);
    const [source, metadata] = await Promise.all([readFile(absolute, "utf8"), stat(absolute)]);
    result.set(path, { source, mode: metadata.mode, mtimeMs: metadata.mtimeMs });
  }
  return result;
}

function assertSnapshotsEqual(expected, actual, message) {
  for (const [path, value] of expected) {
    const next = actual.get(path);
    assert(next?.source === value.source, `${message}: ${path} content`);
    assert(next?.mode === value.mode, `${message}: ${path} mode`);
    assert(next?.mtimeMs === value.mtimeMs, `${message}: ${path} mtime`);
  }
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

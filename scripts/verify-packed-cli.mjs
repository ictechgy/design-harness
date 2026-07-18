import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const tempRoot = await mkdtemp(join(tmpdir(), "design-harness-packed-cli-"));

try {
  const packDir = join(tempRoot, "packs");
  const consumerDir = join(tempRoot, "consumer");
  await mkdir(packDir, { recursive: true });
  await mkdir(consumerDir, { recursive: true });

  const coreTarball = await packPackage("@design-harness/core", packDir);
  const copyAuditTarball = await packPackage("@design-harness/copy-audit", packDir);
  const visualAuditTarball = await packPackage("@design-harness/visual-audit", packDir);
  const cliTarball = await packPackage("@design-harness/cli", packDir);

  const coreDependency = fileDependency(consumerDir, coreTarball);
  const copyAuditDependency = fileDependency(consumerDir, copyAuditTarball);
  const visualAuditDependency = fileDependency(consumerDir, visualAuditTarball);
  const cliDependency = fileDependency(consumerDir, cliTarball);

  await writeFile(join(consumerDir, "package.json"), `${JSON.stringify({
    name: "design-harness-packed-cli-smoke",
    private: true,
    type: "module",
    dependencies: {
      "@design-harness/cli": cliDependency
    }
  }, null, 2)}\n`);
  await writeFile(join(consumerDir, "pnpm-workspace.yaml"), [
    "packages: []",
    "overrides:",
    `  "@design-harness/core": "${coreDependency}"`,
    `  "@design-harness/copy-audit": "${copyAuditDependency}"`,
    `  "@design-harness/visual-audit": "${visualAuditDependency}"`,
    ""
  ].join("\n"));

  await runPnpm(["install", "--prefer-offline", "--ignore-scripts=false"], { cwd: consumerDir });
  const help = await runPnpm(["exec", "design-harness", "--help"], { cwd: consumerDir, capture: true });

  if (
    !help.includes("Design Harness")
    || !help.includes("design-harness audit")
    || !help.includes("--copy <copy-style.yaml>")
    || !help.includes("guide compile")
    || !help.includes("guide check")
  ) {
    throw new Error(`Packed CLI help output did not include expected usage text:\n${help}`);
  }

  await assertPackedGuideCommands(consumerDir);

  await assertFailClosedCopyConfig({
    consumerDir,
    name: "malformed",
    source: "schemaVersion: [\n",
    expectedStage: "parse"
  });
  await assertFailClosedCopyConfig({
    consumerDir,
    name: "schema-invalid",
    source: "schemaVersion: '0.2'\nlocale: NOT_VALID\n",
    expectedStage: "schema"
  });
  await assertFailClosedGuideConfig({
    consumerDir,
    name: "guide-malformed",
    source: "schemaVersion: [\n",
    expectedStage: "parse"
  });
  await assertFailClosedGuideConfig({
    consumerDir,
    name: "guide-schema-invalid",
    source: `${packedGuideYaml()}unknown: true\n`,
    expectedStage: "schema"
  });
  await assertFailClosedGuideConfig({
    consumerDir,
    name: "guide-profile-invalid",
    source: packedGuideYaml().replace("generic-card-grid", "unknown-fingerprint"),
    expectedStage: "profile"
  });

  console.log("Validated packed CLI audit config gates plus guide fail-closed/compile/check/idempotence/drift without root data lookup.");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

async function assertPackedGuideCommands(consumerDir) {
  const target = join(consumerDir, "guide-project");
  await mkdir(target, { recursive: true });
  await writeFile(join(target, "design-guide.yaml"), packedGuideYaml());
  await writeFile(join(target, "AGENTS.md"), "# Packed consumer agents\n");

  const command = [
    "exec",
    "design-harness",
    "guide",
    "compile",
    "--guide",
    "guide-project/design-guide.yaml",
    "--target",
    "guide-project"
  ];
  const firstOutput = await runPnpm(command, { cwd: consumerDir, capture: true });
  if (!firstOutput.includes("guide-token-estimate-v1")) {
    throw new Error(`Packed guide compile omitted estimate output:\n${firstOutput}`);
  }
  const paths = ["AGENTS.md", "CLAUDE.md", "DESIGN.md", "design.tokens.json"];
  const first = await fileSnapshot(target, paths);
  const ownership = JSON.parse(first.get("design.tokens.json").source).$extensions?.["dev.design-harness"];
  if (!ownership?.sourceHash) {
    throw new Error("Packed guide compile omitted token ownership provenance.");
  }

  await runPnpm(command, { cwd: consumerDir, capture: true });
  const second = await fileSnapshot(target, paths);
  assertFileSnapshotsEqual(first, second, "Packed second compile changed owned output");

  await runPnpm([
    "exec",
    "design-harness",
    "guide",
    "check",
    "--guide",
    "guide-project/design-guide.yaml",
    "--target",
    "guide-project",
    "--max-tokens",
    "2000"
  ], { cwd: consumerDir, capture: true });

  const agentsPath = join(target, "AGENTS.md");
  await writeFile(agentsPath, first.get("AGENTS.md").source.replace("Content-shaped", "Drifted"));
  const beforeDriftCheck = await fileSnapshot(target, paths);
  const drift = await runPnpm([
    "exec",
    "design-harness",
    "guide",
    "check",
    "--guide",
    "guide-project/design-guide.yaml",
    "--target",
    "guide-project"
  ], { cwd: consumerDir, capture: true, allowFailure: true });
  if (drift.code !== 1) {
    throw new Error(`Packed drifted guide check exited ${drift.code}, expected 1.`);
  }
  const afterDriftCheck = await fileSnapshot(target, paths);
  assertFileSnapshotsEqual(beforeDriftCheck, afterDriftCheck, "Packed guide check wrote while reporting drift");
}

async function assertFailClosedCopyConfig({ consumerDir, name, source, expectedStage }) {
  const configPath = join(consumerDir, `${name}.yaml`);
  const outDir = join(consumerDir, `${name}-out`);
  await writeFile(configPath, source);
  const result = await runPnpm([
    "exec",
    "design-harness",
    "audit",
    "--url",
    "http://localhost:1",
    "--out",
    outDir,
    "--copy",
    configPath
  ], { cwd: consumerDir, capture: true, allowFailure: true });
  if (result.code !== 1) {
    throw new Error(`Packed CLI ${name} config exited ${result.code}, expected 1.\n${result.stderr}`);
  }
  if (!result.stderr.includes(`Copy style ${expectedStage} error`)) {
    throw new Error(`Packed CLI ${name} config did not report ${expectedStage} stage:\n${result.stderr}`);
  }
  try {
    await stat(outDir);
    throw new Error(`Packed CLI ${name} config created output artifacts`);
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }
}

async function assertFailClosedGuideConfig({ consumerDir, name, source, expectedStage }) {
  const target = join(consumerDir, name);
  const configPath = join(target, "design-guide.yaml");
  await mkdir(target, { recursive: true });
  await writeFile(configPath, source);
  const before = (await readdir(target)).sort();

  for (const action of ["compile", "check"]) {
    const result = await runPnpm([
      "exec",
      "design-harness",
      "guide",
      action,
      "--guide",
      relative(consumerDir, configPath),
      "--target",
      relative(consumerDir, target)
    ], { cwd: consumerDir, capture: true, allowFailure: true });
    if (result.code !== 1) {
      throw new Error(`Packed guide ${action} ${name} exited ${result.code}, expected 1.\n${result.stderr}`);
    }
    if (!result.stderr.includes(`Guide ${expectedStage} error at --guide:`)) {
      throw new Error(`Packed guide ${action} ${name} did not report ${expectedStage} stage:\n${result.stderr}`);
    }
    const after = (await readdir(target)).sort();
    if (JSON.stringify(after) !== JSON.stringify(before)) {
      throw new Error(`Packed guide ${action} ${name} created output or transaction residue: ${after.join(", ")}`);
    }
  }
}

async function packPackage(filter, packDir) {
  const before = new Set(await tgzFiles(packDir));
  await runPnpm(["--filter", filter, "pack", "--pack-destination", packDir], { cwd: repoRoot });
  const after = await tgzFiles(packDir);
  const created = after.filter((file) => !before.has(file));
  if (created.length !== 1) {
    throw new Error(`Expected one tarball for ${filter}, found ${created.length}.`);
  }
  return join(packDir, created[0]);
}

async function tgzFiles(dir) {
  return (await readdir(dir)).filter((file) => file.endsWith(".tgz")).sort();
}

async function fileSnapshot(root, paths) {
  const result = new Map();
  for (const path of paths) {
    const absolute = join(root, path);
    const [source, metadata] = await Promise.all([readFile(absolute, "utf8"), stat(absolute)]);
    result.set(path, { source, mode: metadata.mode, mtimeMs: metadata.mtimeMs });
  }
  return result;
}

function assertFileSnapshotsEqual(expected, actual, message) {
  for (const [path, value] of expected) {
    const next = actual.get(path);
    if (!next || next.source !== value.source || next.mode !== value.mode || next.mtimeMs !== value.mtimeMs) {
      throw new Error(`${message}: ${path}`);
    }
  }
}

function packedGuideYaml() {
  return [
    "schemaVersion: '0.2'",
    "tokens:",
    "  color:",
    "    semantic:",
    "      $type: color",
    "      background: { $value: { colorSpace: srgb, components: [1, 1, 1], alpha: 1 } }",
    "      surface: { $value: { colorSpace: srgb, components: [0.95, 0.95, 0.95], alpha: 1 } }",
    "      text: { $value: { colorSpace: srgb, components: [0.08, 0.08, 0.08], alpha: 1 } }",
    "      accent: { $value: { colorSpace: srgb, components: [0.1, 0.4, 0.8], alpha: 1 } }",
    "  font:",
    "    family:",
    "      $type: fontFamily",
    "      heading: { $value: [Inter, sans-serif] }",
    "      body: { $value: [Inter, sans-serif] }",
    "  spacing:",
    "    $type: dimension",
    "    sm: { $value: { value: 0.5, unit: rem } }",
    "    md: { $value: { value: 1, unit: rem } }",
    "  radius:",
    "    $type: dimension",
    "    sm: { $value: { value: 4, unit: px } }",
    "    md: { $value: { value: 8, unit: px } }",
    "prohibitions: [generic-card-grid]",
    "signatureElement: Use one compact status rail.",
    ""
  ].join("\n");
}

function fileDependency(fromDir, tarballPath) {
  const path = relative(fromDir, tarballPath);
  return `file:${path.startsWith(".") ? path : `./${path}`}`;
}

async function runPnpm(args, options = {}) {
  const pnpmCli = process.env.npm_execpath;
  const command = pnpmCli ? process.execPath : "pnpm";
  const commandArgs = pnpmCli ? [pnpmCli, ...args] : args;

  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: options.cwd,
      env: {
        ...process.env,
        CI: "true",
        npm_config_update_notifier: "false"
      },
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit"
    });

    let stdout = "";
    let stderr = "";
    if (options.capture) {
      child.stdout?.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr?.on("data", (chunk) => {
        stderr += String(chunk);
      });
    }

    child.on("error", reject);
    child.on("close", (code) => {
      const result = { code: code ?? 1, stdout, stderr };
      if (options.allowFailure) {
        resolvePromise(result);
        return;
      }
      if (code === 0) {
        resolvePromise(stdout);
        return;
      }
      reject(new Error(`pnpm ${args.join(" ")} failed with exit code ${code}${stderr ? `\n${stderr}` : ""}`));
    });
  });
}

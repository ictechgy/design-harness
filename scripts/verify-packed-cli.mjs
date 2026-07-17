import { mkdtemp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
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

  if (!help.includes("Design Harness") || !help.includes("design-harness audit") || !help.includes("--copy <copy-style.yaml>")) {
    throw new Error(`Packed CLI help output did not include expected usage text:\n${help}`);
  }

  await assertFailClosedConfig({
    consumerDir,
    name: "malformed",
    source: "schemaVersion: [\n",
    expectedStage: "parse"
  });
  await assertFailClosedConfig({
    consumerDir,
    name: "schema-invalid",
    source: "schemaVersion: '0.2'\nlocale: NOT_VALID\n",
    expectedStage: "schema"
  });

  console.log("Validated packed CLI install, --copy help, and fail-closed parse/schema config errors.");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

async function assertFailClosedConfig({ consumerDir, name, source, expectedStage }) {
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

import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
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
  const visualAuditTarball = await packPackage("@design-harness/visual-audit", packDir);
  const cliTarball = await packPackage("@design-harness/cli", packDir);

  const coreDependency = fileDependency(consumerDir, coreTarball);
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
    `  "@design-harness/visual-audit": "${visualAuditDependency}"`,
    ""
  ].join("\n"));

  await runPnpm(["install", "--prefer-offline", "--ignore-scripts=false"], { cwd: consumerDir });
  const help = await runPnpm(["exec", "design-harness", "--help"], { cwd: consumerDir, capture: true });

  if (!help.includes("Design Harness") || !help.includes("design-harness audit")) {
    throw new Error(`Packed CLI help output did not include expected usage text:\n${help}`);
  }

  console.log("Validated packed CLI install and design-harness --help.");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
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
      if (code === 0) {
        resolvePromise(stdout);
        return;
      }
      reject(new Error(`pnpm ${args.join(" ")} failed with exit code ${code}${stderr ? `\n${stderr}` : ""}`));
    });
  });
}

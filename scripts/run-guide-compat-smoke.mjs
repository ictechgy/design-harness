import { spawn } from "node:child_process";
import { copyFile, mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import StyleDictionary from "style-dictionary";

const EXPECTED_STYLE_DICTIONARY_VERSION = "5.5.0";
const tempRoot = await mkdtemp(join(tmpdir(), "design-harness-guide-compat-"));

try {
  if (StyleDictionary.VERSION !== EXPECTED_STYLE_DICTIONARY_VERSION) {
    throw new Error(
      `Style Dictionary compatibility smoke requires ${EXPECTED_STYLE_DICTIONARY_VERSION}, found ${StyleDictionary.VERSION}.`
    );
  }

  const target = join(tempRoot, "project");
  const buildDir = join(tempRoot, "style-dictionary-build");
  await mkdir(target, { recursive: true });
  await mkdir(buildDir, { recursive: true });
  await copyFile(resolve("examples/configs/design-guide.example.yaml"), join(target, "design-guide.yaml"));

  const compile = await run(process.execPath, [
    resolve("packages/cli/dist/index.js"),
    "guide",
    "compile",
    "--guide",
    "project/design-guide.yaml",
    "--target",
    "project"
  ], tempRoot);
  if (compile.code !== 0) {
    throw new Error(`Guide compile for compatibility smoke failed:\n${compile.stderr}`);
  }

  const tokenPath = join(target, "design.tokens.json");
  const tokens = JSON.parse(await readFile(tokenPath, "utf8"));
  const expectedPaths = collectTokenPaths(tokens);
  const dictionary = new StyleDictionary({
    source: [tokenPath],
    usesDtcg: true,
    platforms: {
      css: {
        transformGroup: "css",
        buildPath: `${buildDir}/`,
        files: [{
          destination: "variables.css",
          format: "css/variables",
          options: { showFileHeader: false }
        }]
      }
    }
  });
  await dictionary.buildAllPlatforms();

  const css = await readFile(join(buildDir, "variables.css"), "utf8");
  for (const path of expectedPaths) {
    const variable = `--${path.join("-")}`;
    const matches = css.match(new RegExp(`${escapeRegExp(variable)}\\s*:\\s*[^;]+;`, "g")) ?? [];
    if (matches.length !== 1) {
      throw new Error(`Style Dictionary emitted ${matches.length} nonempty declarations for ${variable}.`);
    }
  }
  if (expectedPaths.length < 10) {
    throw new Error(`Compatibility fixture exposed only ${expectedPaths.length} supported token leaves.`);
  }

  console.log(
    `Style Dictionary ${StyleDictionary.VERSION} compatibility smoke passed for ${expectedPaths.length} v0.5a profile leaves.`
  );
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

function collectTokenPaths(root) {
  const result = [];
  visit(root, []);
  return result;

  function visit(value, path) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return;
    }
    if (Object.prototype.hasOwnProperty.call(value, "$value")) {
      result.push(path);
      return;
    }
    for (const key of Object.keys(value).sort()) {
      if (!key.startsWith("$")) {
        visit(value[key], [...path, key]);
      }
    }
  }
}

function run(command, args, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

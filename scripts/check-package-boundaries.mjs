#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultRoot = fileURLToPath(new URL("..", import.meta.url));
const SOURCE_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const IMPORT_PATTERN = /(?:from\s+|import\s+|import\s*\(\s*|require\s*\(\s*)(["'`])([^"'`]+)\1/g;
const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
const STYLE_DICTIONARY_VERSION = "5.5.0";
const BUILD_ONLY_MODULES = ["style-dictionary"];
const CAPTURE_MODULES = [
  "playwright",
  "@playwright/",
  "puppeteer",
  "@puppeteer/",
  "jsdom",
  "linkedom",
  "happy-dom",
  "appium",
  "@appium/",
  "webdriverio",
  "@wdio/",
  "selenium-webdriver",
  "cypress"
];
const CLI_CONFIG_MODULES = ["yaml"];
const CORE_FORBIDDEN_MODULES = [
  ...CAPTURE_MODULES,
  ...CLI_CONFIG_MODULES,
  ...BUILD_ONLY_MODULES,
  "@design-harness/copy-audit",
  "@design-harness/visual-audit",
  "@design-harness/cli"
];
const COPY_AUDIT_FORBIDDEN_MODULES = [
  ...CAPTURE_MODULES,
  ...CLI_CONFIG_MODULES,
  ...BUILD_ONLY_MODULES,
  "@design-harness/visual-audit",
  "@design-harness/cli"
];
const VISUAL_AUDIT_FORBIDDEN_MODULES = [
  ...CLI_CONFIG_MODULES,
  ...BUILD_ONLY_MODULES,
  "@design-harness/cli"
];
const CLI_FORBIDDEN_MODULES = [...BUILD_ONLY_MODULES];
const EXPECTED_RUNTIME_DEPENDENCIES = {
  core: {},
  "copy-audit": {
    "@design-harness/core": "workspace:^"
  },
  "visual-audit": {
    "@design-harness/copy-audit": "workspace:^",
    "@design-harness/core": "workspace:^",
    playwright: "^1.49.1"
  },
  cli: {
    "@design-harness/core": "workspace:^",
    "@design-harness/visual-audit": "workspace:^",
    yaml: "^2.9.0"
  }
};

export function checkPackageBoundaries(rootDir = defaultRoot) {
  const root = resolve(rootDir);
  const failures = [];
  const rootManifestPath = join(root, "package.json");
  const rootManifest = existsSync(rootManifestPath)
    ? readManifest(rootManifestPath, root, failures)
    : undefined;
  if (!rootManifest) {
    failures.push("package.json is missing or invalid");
  } else {
    checkRootBuildDependencies(rootManifest, failures);
  }
  const packages = [
    {
      label: "core",
      directory: resolve(root, "packages/core"),
      forbiddenModules: CORE_FORBIDDEN_MODULES
    },
    {
      label: "copy-audit",
      directory: resolve(root, "packages/copy-audit"),
      forbiddenModules: COPY_AUDIT_FORBIDDEN_MODULES
    },
    {
      label: "visual-audit",
      directory: resolve(root, "packages/visual-audit"),
      forbiddenModules: VISUAL_AUDIT_FORBIDDEN_MODULES
    },
    {
      label: "cli",
      directory: resolve(root, "packages/cli"),
      forbiddenModules: CLI_FORBIDDEN_MODULES
    }
  ];

  for (const packageBoundary of packages) {
    const manifestPath = join(packageBoundary.directory, "package.json");
    if (!existsSync(manifestPath)) {
      failures.push(`${displayPath(root, manifestPath)} is missing`);
      continue;
    }

    const manifest = readManifest(manifestPath, root, failures);
    if (!manifest) {
      continue;
    }

    checkManifestModules(
      manifest,
      manifestPath,
      root,
      packageBoundary.forbiddenModules,
      failures
    );
    scanSourceImports(
      join(packageBoundary.directory, "src"),
      root,
      packageBoundary.forbiddenModules,
      failures
    );

    const expectedDependencies = EXPECTED_RUNTIME_DEPENDENCIES[packageBoundary.label];
    const actualDependencies = manifest.dependencies ?? {};
    if (!sameStringMap(actualDependencies, expectedDependencies)) {
      failures.push(
        `${displayPath(root, manifestPath)} dependencies must equal ${JSON.stringify(expectedDependencies)}, got ${JSON.stringify(actualDependencies)}`
      );
    }
    for (const field of ["peerDependencies", "optionalDependencies"]) {
      const entries = manifest[field] ?? {};
      if (Object.keys(entries).length > 0) {
        failures.push(
          `${displayPath(root, manifestPath)} ${field} must be empty, got ${JSON.stringify(entries)}`
        );
      }
    }
  }

  return failures;
}

function checkRootBuildDependencies(manifest, failures) {
  const actualVersion = manifest.devDependencies?.["style-dictionary"];
  if (actualVersion !== STYLE_DICTIONARY_VERSION) {
    failures.push(
      `package.json devDependencies must pin style-dictionary exactly to ${STYLE_DICTIONARY_VERSION}, got ${JSON.stringify(actualVersion)}`
    );
  }
  for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
    if (Object.hasOwn(manifest[field] ?? {}, "style-dictionary")) {
      failures.push(`package.json ${field} must not declare build-only module "style-dictionary"`);
    }
  }
}

function readManifest(manifestPath, root, failures) {
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      failures.push(`${displayPath(root, manifestPath)} must contain a JSON object`);
      return undefined;
    }
    return parsed;
  } catch (error) {
    failures.push(`${displayPath(root, manifestPath)} could not be parsed: ${error.message}`);
    return undefined;
  }
}

function checkManifestModules(manifest, manifestPath, root, forbiddenModules, failures) {
  for (const field of DEPENDENCY_FIELDS) {
    for (const moduleName of Object.keys(manifest[field] ?? {})) {
      if (matchesForbiddenModule(moduleName, forbiddenModules)) {
        failures.push(
          `${displayPath(root, manifestPath)} ${field} declares forbidden module "${moduleName}"`
        );
      }
    }
  }
}

function scanSourceImports(sourceDir, root, forbiddenModules, failures) {
  if (!existsSync(sourceDir)) {
    failures.push(`${displayPath(root, sourceDir)} is missing`);
    return;
  }

  const files = walkSourceFiles(sourceDir);
  if (files.length === 0) {
    failures.push(`${displayPath(root, sourceDir)} yielded 0 scannable source files`);
    return;
  }

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(IMPORT_PATTERN)) {
      const specifier = match[2];
      if (matchesForbiddenModule(specifier, forbiddenModules)) {
        failures.push(`${displayPath(root, file)} imports forbidden module "${specifier}"`);
      }
    }
  }
}

function walkSourceFiles(directory, seen = new Set()) {
  const real = realpathSync(directory);
  if (seen.has(real)) {
    return [];
  }
  seen.add(real);

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    const isDirectory = entry.isSymbolicLink() ? statSync(path).isDirectory() : entry.isDirectory();
    if (isDirectory) {
      return walkSourceFiles(path, seen);
    }
    return SOURCE_FILE.test(entry.name) ? [path] : [];
  });
}

function matchesForbiddenModule(specifier, forbiddenModules) {
  return forbiddenModules.some((forbidden) =>
    forbidden.endsWith("/")
      ? specifier.startsWith(forbidden)
      : specifier === forbidden || specifier.startsWith(`${forbidden}/`)
  );
}

function sameStringMap(actual, expected) {
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) {
    return false;
  }
  const actualEntries = Object.entries(actual).sort(([left], [right]) => left.localeCompare(right));
  const expectedEntries = Object.entries(expected).sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify(actualEntries) === JSON.stringify(expectedEntries);
}

function displayPath(root, path) {
  return relative(root, path) || ".";
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
  const failures = checkPackageBoundaries();
  if (failures.length > 0) {
    console.error("check-package-boundaries failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }
  console.log("check-package-boundaries passed: dependency direction, CLI-only YAML, and root-only build tooling are preserved.");
}

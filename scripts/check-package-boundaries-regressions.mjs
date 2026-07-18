#!/usr/bin/env node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkPackageBoundaries } from "./check-package-boundaries.mjs";

const root = mkdtempSync(join(tmpdir(), "design-harness-package-boundaries-"));

try {
  seedValidPackages(root);
  assertNoFailures(checkPackageBoundaries(root), "valid package graph");

  writeRootManifest(root, {
    dependencies: { "style-dictionary": "5.5.0" },
    devDependencies: { "style-dictionary": "^5.5.0" }
  });
  assertFailures(
    checkPackageBoundaries(root),
    [
      "devDependencies must pin style-dictionary exactly to 5.5.0",
      'dependencies must not declare build-only module "style-dictionary"'
    ],
    "root-only exact Style Dictionary placement"
  );

  seedValidPackages(root);
  writeManifest(root, "cli", {
    dependencies: {
      "@design-harness/core": "workspace:^",
      "@design-harness/visual-audit": "workspace:^",
      yaml: "^2.9.0",
      "style-dictionary": "5.5.0"
    }
  });
  writeSource(root, "cli", 'import "style-dictionary";\n');
  assertFailures(
    checkPackageBoundaries(root),
    [
      'packages/cli/package.json dependencies declares forbidden module "style-dictionary"',
      'packages/cli/src/index.ts imports forbidden module "style-dictionary"',
      "packages/cli/package.json dependencies must equal"
    ],
    "published Style Dictionary runtime"
  );

  seedValidPackages(root);
  writeManifest(root, "core", { dependencies: { "future-tokenizer": "1.0.0" } });
  assertFailures(
    checkPackageBoundaries(root),
    ["packages/core/package.json dependencies must equal {}", "future-tokenizer"],
    "arbitrary tokenizer runtime dependency"
  );

  seedValidPackages(root);
  writeSource(root, "core", 'import "@design-harness/copy-audit";\n');
  assertFailures(
    checkPackageBoundaries(root),
    ['packages/core/src/index.ts imports forbidden module "@design-harness/copy-audit"'],
    "core -> copy-audit import"
  );

  writeSource(root, "core", "export const core = true;\n");
  writeManifest(root, "core", { dependencies: { yaml: "2.9.0" } });
  writeSource(root, "core", 'import "yaml";\n');
  writeSource(root, "copy-audit", 'import "yaml";\n');
  writeSource(root, "visual-audit", 'import "yaml";\n');
  assertFailures(
    checkPackageBoundaries(root),
    [
      'packages/core/package.json dependencies declares forbidden module "yaml"',
      'packages/core/src/index.ts imports forbidden module "yaml"',
      'packages/copy-audit/src/index.ts imports forbidden module "yaml"',
      'packages/visual-audit/src/index.ts imports forbidden module "yaml"'
    ],
    "CLI-only YAML config boundary"
  );

  seedValidPackages(root);
  writeSource(
    root,
    "copy-audit",
    'import "@design-harness/visual-audit";\nimport "playwright";\n'
  );
  assertFailures(
    checkPackageBoundaries(root),
    [
      'packages/copy-audit/src/index.ts imports forbidden module "@design-harness/visual-audit"',
      'packages/copy-audit/src/index.ts imports forbidden module "playwright"'
    ],
    "copy-audit capture imports"
  );

  writeSource(root, "copy-audit", 'import type { Finding } from "@design-harness/core";\nexport type Result = Finding[];\n');
  writeManifest(root, "copy-audit", {
    dependencies: {
      "@design-harness/core": "workspace:^",
      "left-pad": "1.3.0"
    }
  });
  assertFailures(
    checkPackageBoundaries(root),
    ["dependencies must equal"],
    "copy-audit runtime dependency set"
  );

  writeManifest(root, "copy-audit", {
    dependencies: { "@design-harness/core": "workspace:^" },
    optionalDependencies: { "optional-runtime": "1.0.0" },
    peerDependencies: { "peer-runtime": "1.0.0" }
  });
  assertFailures(
    checkPackageBoundaries(root),
    ["optionalDependencies must be empty", "peerDependencies must be empty"],
    "copy-audit optional and peer runtime dependencies"
  );

  writeManifest(root, "copy-audit", {
    dependencies: { "@design-harness/core": "workspace:^" }
  });
  writeManifest(root, "visual-audit", {
    dependencies: { "@design-harness/cli": "workspace:^" }
  });
  writeSource(root, "visual-audit", 'import "@design-harness/cli";\n');
  assertFailures(
    checkPackageBoundaries(root),
    [
      'packages/visual-audit/package.json dependencies declares forbidden module "@design-harness/cli"',
      'packages/visual-audit/src/index.ts imports forbidden module "@design-harness/cli"'
    ],
    "visual-audit -> cli reverse dependency"
  );

  console.log("check-package-boundaries-regressions passed: imports, explicit runtime dependencies, CLI-only YAML, and root-only build tooling fail closed.");
} finally {
  rmSync(root, { recursive: true, force: true });
}

function seedValidPackages(workspaceRoot) {
  writeRootManifest(workspaceRoot, {
    devDependencies: { "style-dictionary": "5.5.0" }
  });
  writeManifest(workspaceRoot, "core", { dependencies: {} });
  writeSource(workspaceRoot, "core", "export const core = true;\n");
  writeManifest(workspaceRoot, "copy-audit", {
    dependencies: { "@design-harness/core": "workspace:^" }
  });
  writeSource(workspaceRoot, "copy-audit", 'import type { Finding } from "@design-harness/core";\nexport type Result = Finding[];\n');
  writeManifest(workspaceRoot, "visual-audit", {
    dependencies: {
      "@design-harness/copy-audit": "workspace:^",
      "@design-harness/core": "workspace:^",
      playwright: "^1.49.1"
    }
  });
  writeSource(workspaceRoot, "visual-audit", "export const visualAudit = true;\n");
  writeManifest(workspaceRoot, "cli", {
    dependencies: {
      "@design-harness/core": "workspace:^",
      "@design-harness/visual-audit": "workspace:^",
      yaml: "^2.9.0"
    }
  });
  writeSource(workspaceRoot, "cli", "export const cli = true;\n");
}

function writeRootManifest(workspaceRoot, fields) {
  writeFileSync(
    join(workspaceRoot, "package.json"),
    `${JSON.stringify({ name: "design-harness", private: true, ...fields }, null, 2)}\n`
  );
}

function writeManifest(workspaceRoot, packageName, fields) {
  const packageDir = join(workspaceRoot, "packages", packageName);
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(
    join(packageDir, "package.json"),
    `${JSON.stringify({ name: `@design-harness/${packageName}`, version: "0.0.0", ...fields }, null, 2)}\n`
  );
}

function writeSource(workspaceRoot, packageName, source) {
  const sourceDir = join(workspaceRoot, "packages", packageName, "src");
  mkdirSync(sourceDir, { recursive: true });
  writeFileSync(join(sourceDir, "index.ts"), source);
}

function assertNoFailures(failures, label) {
  if (failures.length > 0) {
    throw new Error(`${label} unexpectedly failed:\n${failures.join("\n")}`);
  }
}

function assertFailures(failures, expectedFragments, label) {
  for (const fragment of expectedFragments) {
    if (!failures.some((failure) => failure.includes(fragment))) {
      throw new Error(`${label} did not report ${JSON.stringify(fragment)}:\n${failures.join("\n")}`);
    }
  }
}

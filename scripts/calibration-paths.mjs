import { resolve, sep } from "node:path";

const fixturePathPrefix = "examples/ui-quality-fixtures/";

export function calibrationFixturePaths(outRoot, fixturePath) {
  if (!fixturePath.startsWith(fixturePathPrefix) || !fixturePath.endsWith(".html")) {
    throw new Error(`Invalid calibration fixture path: ${fixturePath}`);
  }

  const relativePath = fixturePath.slice(fixturePathPrefix.length);
  const fixtureOutRoot = resolve(outRoot, "fixtures");
  const outDir = resolve(fixtureOutRoot, relativePath.slice(0, -".html".length));
  if (!outDir.startsWith(`${fixtureOutRoot}${sep}`)) {
    throw new Error(`Calibration fixture path escapes the output root: ${fixturePath}`);
  }

  return { relativePath, outDir };
}

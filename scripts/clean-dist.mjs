import { rm } from "node:fs/promises";

const target = process.argv[2];

if (!target || target === "." || target === "/" || target.includes("..")) {
  throw new Error("Usage: node scripts/clean-dist.mjs <package-dist-directory>");
}

await rm(target, { recursive: true, force: true });

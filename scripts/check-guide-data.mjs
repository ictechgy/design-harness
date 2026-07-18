import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  GENERATED_CATALOG_URL,
  readCatalog,
  renderGeneratedCatalog
} from "./generate-guide-data.mjs";

const catalog = readCatalog();
const expected = renderGeneratedCatalog(catalog);
const actual = readFileSync(GENERATED_CATALOG_URL, "utf8");

if (actual !== expected) {
  throw new Error(
    `Generated guide catalog is stale: run node scripts/generate-guide-data.mjs (${fileURLToPath(GENERATED_CATALOG_URL)}).`
  );
}

console.log(`Validated ${catalog.entries.length} guide fingerprints and generated parity.`);

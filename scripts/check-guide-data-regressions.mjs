import assert from "node:assert/strict";
import { readCatalog, validateCatalog } from "./generate-guide-data.mjs";

const valid = readCatalog();

assertRejects("duplicate id", (catalog) => {
  catalog.entries[1].id = catalog.entries[0].id;
});
assertRejects("identical examples", (catalog) => {
  catalog.entries[0].goodExample = catalog.entries[0].badExample;
});
assertRejects("structural delimiter", (catalog) => {
  catalog.entries[0].description = "unsafe <!-- marker";
});
assertRejects("unpaired surrogate", (catalog) => {
  catalog.entries[0].description = "unsafe\ud800text";
});
assertRejects("missing provenance", (catalog) => {
  delete catalog.entries[0].provenance;
});
assertRejects("unknown conflict", (catalog) => {
  catalog.entries[0].conflictsWith = ["unknown-entry"];
});
assertRejects("self conflict", (catalog) => {
  catalog.entries[0].conflictsWith = [catalog.entries[0].id];
});
assertRejects("asymmetric conflict", (catalog) => {
  catalog.entries[0].conflictsWith = [catalog.entries[1].id];
});

console.log("Guide data regression checks passed.");

function assertRejects(label, mutate) {
  const catalog = structuredClone(valid);
  mutate(catalog);
  assert.throws(() => validateCatalog(catalog), undefined, label);
}

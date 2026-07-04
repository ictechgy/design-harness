import { loadAllSchemas } from "./schema-registry.js";
import { assertValidSchema } from "./validation.js";
import { createExampleAuditResult, createExampleBrief, createExampleFinding } from "./fixtures.js";

const schemas = loadAllSchemas();
for (const [name, schema] of Object.entries(schemas)) {
  if (!schema.$id || !schema.title || schema.type !== "object") {
    throw new Error(`Schema ${name} is missing required schema metadata.`);
  }
}

assertValidSchema("brief", createExampleBrief());
assertValidSchema("finding", createExampleFinding());
assertValidSchema("audit-result", createExampleAuditResult());

console.log(`Validated ${Object.keys(schemas).length} schemas.`);

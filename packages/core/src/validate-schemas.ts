import { loadAllSchemas } from "./schema-registry.js";
import { assertValidSchema } from "./validation.js";
import { createExampleAuditResult, createExampleBrief, createExampleFinding, createExampleMetadata, createExampleReportManifest } from "./fixtures.js";
import { assertAuditResultIntegrity } from "./integrity.js";

const schemas = loadAllSchemas();
for (const [name, schema] of Object.entries(schemas)) {
  if (!schema.$id || !schema.title || schema.type !== "object") {
    throw new Error(`Schema ${name} is missing required schema metadata.`);
  }
}

assertValidSchema("brief", createExampleBrief());
assertValidSchema("finding", createExampleFinding());
assertValidSchema("audit-result", createExampleAuditResult());
assertValidSchema("metadata", createExampleMetadata());
assertValidSchema("report", createExampleReportManifest());
assertAuditResultIntegrity(createExampleAuditResult());

console.log(`Validated ${Object.keys(schemas).length} schemas.`);

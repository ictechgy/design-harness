import { readdirSync, readFileSync } from "node:fs";
import { basename } from "node:path";

export type SchemaName =
  | "brief"
  | "audit-target"
  | "viewport-preset"
  | "finding"
  | "audit-result"
  | "critique"
  | "report";

export type JsonSchema = Record<string, unknown>;

const schemaDirectoryUrl = new URL("../schemas/", import.meta.url);

export function loadSchema(name: SchemaName): JsonSchema {
  const fileUrl = new URL(`${name}.schema.json`, schemaDirectoryUrl);
  return JSON.parse(readFileSync(fileUrl, "utf8")) as JsonSchema;
}

export function loadAllSchemas(): Record<SchemaName, JsonSchema> {
  const entries = readdirSync(schemaDirectoryUrl)
    .filter((fileName) => fileName.endsWith(".schema.json"))
    .map((fileName) => basename(fileName, ".schema.json") as SchemaName)
    .sort();

  return Object.fromEntries(entries.map((name) => [name, loadSchema(name)])) as Record<SchemaName, JsonSchema>;
}

import type { JsonSchema, SchemaName } from "./schema-registry.js";
import { loadSchema } from "./schema-registry.js";

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

export class SchemaValidationError extends Error {
  constructor(
    public readonly schemaName: string,
    public readonly issues: ValidationIssue[]
  ) {
    super(`Validation failed for ${schemaName}: ${formatIssues(issues)}`);
    this.name = "SchemaValidationError";
  }
}

export function validateSchema(name: SchemaName, value: unknown): ValidationResult {
  return validateAgainstSchema(loadSchema(name), value);
}

export function assertValidSchema(name: SchemaName, value: unknown): void {
  const result = validateSchema(name, value);
  if (!result.valid) {
    throw new SchemaValidationError(name, result.issues);
  }
}

export function validateAgainstSchema(schema: JsonSchema, value: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  visit(schema, value, "$", schema, issues);
  return {
    valid: issues.length === 0,
    issues
  };
}

function visit(schema: JsonSchema, value: unknown, path: string, root: JsonSchema, issues: ValidationIssue[]): void {
  const ref = schema.$ref;
  if (typeof ref === "string") {
    visit(resolveRef(root, ref), value, path, root, issues);
    return;
  }

  if (Array.isArray(schema.anyOf)) {
    const matches = schema.anyOf.some((option) => {
      const optionIssues: ValidationIssue[] = [];
      visit(option as JsonSchema, value, path, root, optionIssues);
      return optionIssues.length === 0;
    });
    if (!matches) {
      issues.push({ path, message: "must match at least one allowed shape" });
    }
    return;
  }

  if ("const" in schema && value !== schema.const) {
    issues.push({ path, message: `must equal ${JSON.stringify(schema.const)}` });
    return;
  }

  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    issues.push({ path, message: `must be one of ${schema.enum.map(String).join(", ")}` });
    return;
  }

  const expectedType = schema.type;
  if (expectedType && !matchesType(value, expectedType)) {
    issues.push({ path, message: `must be ${Array.isArray(expectedType) ? expectedType.join(" or ") : expectedType}` });
    return;
  }

  if (typeof value === "string") {
    validateString(schema, value, path, issues);
  }

  if (typeof value === "number") {
    validateNumber(schema, value, path, issues);
  }

  if (Array.isArray(value)) {
    validateArray(schema, value, path, root, issues);
  }

  if (isPlainObject(value)) {
    validateObject(schema, value, path, root, issues);
  }
}

function validateString(schema: JsonSchema, value: string, path: string, issues: ValidationIssue[]): void {
  if (typeof schema.minLength === "number" && value.length < schema.minLength) {
    issues.push({ path, message: `must have length >= ${schema.minLength}` });
  }

  if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(value)) {
    issues.push({ path, message: `must match pattern ${schema.pattern}` });
  }
}

function validateNumber(schema: JsonSchema, value: number, path: string, issues: ValidationIssue[]): void {
  if (typeof schema.minimum === "number" && value < schema.minimum) {
    issues.push({ path, message: `must be >= ${schema.minimum}` });
  }

  if (typeof schema.maximum === "number" && value > schema.maximum) {
    issues.push({ path, message: `must be <= ${schema.maximum}` });
  }
}

function validateArray(schema: JsonSchema, value: unknown[], path: string, root: JsonSchema, issues: ValidationIssue[]): void {
  if (typeof schema.minItems === "number" && value.length < schema.minItems) {
    issues.push({ path, message: `must contain at least ${schema.minItems} item(s)` });
  }

  if (isPlainObject(schema.items)) {
    value.forEach((item, index) => visit(schema.items as JsonSchema, item, `${path}[${index}]`, root, issues));
  }
}

function validateObject(
  schema: JsonSchema,
  value: Record<string, unknown>,
  path: string,
  root: JsonSchema,
  issues: ValidationIssue[]
): void {
  const required = Array.isArray(schema.required) ? schema.required : [];
  for (const key of required) {
    if (typeof key === "string" && !(key in value)) {
      issues.push({ path: `${path}.${key}`, message: "is required" });
    }
  }

  const properties = isPlainObject(schema.properties) ? schema.properties : {};
  for (const [key, propertySchema] of Object.entries(properties)) {
    if (key in value && isPlainObject(propertySchema)) {
      visit(propertySchema as JsonSchema, value[key], `${path}.${key}`, root, issues);
    }
  }

  if (schema.additionalProperties === false) {
    for (const key of Object.keys(value)) {
      if (!(key in properties)) {
        issues.push({ path: `${path}.${key}`, message: "is not allowed" });
      }
    }
  }
}

function matchesType(value: unknown, expected: unknown): boolean {
  const allowed = Array.isArray(expected) ? expected : [expected];
  return allowed.some((typeName) => {
    switch (typeName) {
      case "array":
        return Array.isArray(value);
      case "object":
        return isPlainObject(value);
      case "integer":
        return Number.isInteger(value);
      case "number":
        return typeof value === "number" && Number.isFinite(value);
      case "string":
        return typeof value === "string";
      case "boolean":
        return typeof value === "boolean";
      case "null":
        return value === null;
      default:
        return false;
    }
  });
}

function resolveRef(root: JsonSchema, ref: string): JsonSchema {
  if (!ref.startsWith("#/")) {
    throw new Error(`Only local schema refs are supported: ${ref}`);
  }

  return ref
    .slice(2)
    .split("/")
    .reduce<unknown>((current, segment) => {
      if (!isPlainObject(current) || !(segment in current)) {
        throw new Error(`Cannot resolve schema ref ${ref}`);
      }
      return current[segment];
    }, root) as JsonSchema;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatIssues(issues: ValidationIssue[]): string {
  return issues.map((issue) => `${issue.path} ${issue.message}`).join("; ");
}

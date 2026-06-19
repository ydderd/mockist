import type { Harness } from "./harness";
import type { Call, CallKind, SequenceStubState, Stub } from "./types";

/** Minimal JSON Schema shape for tool output validation. */
export type JsonSchema = {
  type?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  enum?: unknown[];
  [key: string]: unknown;
};

export interface ToolSchemaDef {
  name: string;
  kind?: CallKind;
  /** JSON Schema for tool input (parameters). */
  inputSchema?: JsonSchema;
  /** JSON Schema for tool output when available. */
  outputSchema?: JsonSchema;
}

export class SchemaValidationError extends Error {
  constructor(
    message: string,
    readonly toolName: string,
    readonly path: string,
  ) {
    super(message);
    this.name = "SchemaValidationError";
  }
}

/** Validate `value` against a small JSON Schema subset (type, object, array, enum). */
export function validateAgainstJsonSchema(value: unknown, schema: JsonSchema, path = "$"): void {
  if (schema.enum !== undefined) {
    if (!schema.enum.some((v) => Object.is(v, value))) {
      throw new SchemaValidationError(`expected one of enum values at ${path}`, "", path);
    }
    return;
  }

  const type = schema.type;
  if (!type) return;

  if (type === "null") {
    if (value !== null) throw new SchemaValidationError(`expected null at ${path}`, "", path);
    return;
  }
  if (type === "boolean") {
    if (typeof value !== "boolean") throw new SchemaValidationError(`expected boolean at ${path}`, "", path);
    return;
  }
  if (type === "number" || type === "integer") {
    if (typeof value !== "number" || (type === "integer" && !Number.isInteger(value))) {
      throw new SchemaValidationError(`expected ${type} at ${path}`, "", path);
    }
    return;
  }
  if (type === "string") {
    if (typeof value !== "string") throw new SchemaValidationError(`expected string at ${path}`, "", path);
    return;
  }
  if (type === "array") {
    if (!Array.isArray(value)) throw new SchemaValidationError(`expected array at ${path}`, "", path);
    if (schema.items) value.forEach((item, i) => validateAgainstJsonSchema(item, schema.items!, `${path}[${i}]`));
    return;
  }
  if (type === "object") {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new SchemaValidationError(`expected object at ${path}`, "", path);
    }
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!(key in obj)) throw new SchemaValidationError(`missing required "${key}" at ${path}`, "", `${path}.${key}`);
    }
    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
      if (key in obj) validateAgainstJsonSchema(obj[key], sub, `${path}.${key}`);
    }
  }
}

/**
 * Validate stub `result` values against tool output schemas where defined.
 * Throws {@link SchemaValidationError} on the first mismatch.
 */
export function validateStubsAgainstSchemas(stubs: Stub[], tools: ToolSchemaDef[]): void {
  const byKey = new Map(tools.map((t) => [`${t.kind ?? "tool"}:${t.name}`, t]));
  for (const stub of stubs) {
    const tool = byKey.get(`${stub.kind ?? "tool"}:${stub.name}`);
    if (!tool?.outputSchema || !("result" in stub)) continue;
    const result = typeof stub.result === "function" ? stub.result({}) : stub.result;
    try {
      validateAgainstJsonSchema(result, tool.outputSchema);
    } catch (e) {
      if (e instanceof SchemaValidationError) {
        throw new SchemaValidationError(e.message, tool.name, e.path);
      }
      throw e;
    }
  }
}

/** Generate a placeholder value from a JSON Schema (for starter stubs). */
export function placeholderFromSchema(schema: JsonSchema): unknown {
  if (schema.enum?.length) return schema.enum[0];
  switch (schema.type) {
    case "string":
      return "";
    case "number":
    case "integer":
      return 0;
    case "boolean":
      return false;
    case "null":
      return null;
    case "array":
      return schema.items ? [placeholderFromSchema(schema.items)] : [];
    case "object": {
      const out: Record<string, unknown> = {};
      for (const [key, sub] of Object.entries(schema.properties ?? {})) {
        out[key] = placeholderFromSchema(sub);
      }
      return out;
    }
    default:
      return null;
  }
}

/** Build name-only stubs with placeholder results from tool output schemas. */
export function stubsFromSchemas(tools: ToolSchemaDef[]): Stub[] {
  return tools
    .filter((t) => t.outputSchema)
    .map((t) => ({
      kind: t.kind,
      name: t.name,
      result: placeholderFromSchema(t.outputSchema!),
    }));
}

/** Validate a recorded trajectory's outputs against tool schemas (passthrough outputs only). */
export function validateTrajectoryOutputs(trajectory: readonly Call[], tools: ToolSchemaDef[]): void {
  const byKey = new Map(tools.map((t) => [`${t.kind ?? "tool"}:${t.name}`, t]));
  for (const call of trajectory) {
    if (call.output === undefined) continue;
    const tool = byKey.get(`${call.kind}:${call.name}`);
    if (!tool?.outputSchema) continue;
    try {
      validateAgainstJsonSchema(call.output, tool.outputSchema);
    } catch (e) {
      if (e instanceof SchemaValidationError) {
        throw new SchemaValidationError(e.message, tool.name, e.path);
      }
      throw e;
    }
  }
}
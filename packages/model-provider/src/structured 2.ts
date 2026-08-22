/**
 * Provider-agnostic structured-output support (DF-026A).
 *
 * A compact, deterministic JSON schema subset plus validation helpers so the
 * core can request and validate structured model responses without coupling to
 * any concrete vendor's structured-output API.
 */

import { ModelProviderError } from './errors.js';

/** JSON value that can be carried in a model request or response. */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/** Primitive / structural type names understood by the validator. */
export type JsonSchemaType =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'object'
  | 'array'
  | 'null';

/**
 * Property schema. `type` may be a single name or a union of names.
 * Object properties recurse through `properties` / `required`; arrays recurse
 * through `items`.
 */
export interface JsonPropertySchema {
  readonly type?: JsonSchemaType | readonly JsonSchemaType[];
  readonly description?: string;
  readonly properties?: Readonly<Record<string, JsonPropertySchema>>;
  readonly required?: readonly string[];
  readonly items?: JsonPropertySchema;
}

/** Root schema for structured model responses. */
export interface JsonObjectSchema {
  readonly type: 'object';
  readonly description?: string;
  readonly properties: Readonly<Record<string, JsonPropertySchema>>;
  readonly required?: readonly string[];
  /** Extra (undeclared) properties are allowed unless set to false. */
  readonly additionalProperties?: boolean;
}

export type StructuredOutputSchema = JsonObjectSchema;

export interface StructuredOutputError {
  readonly message: string;
  readonly issues: readonly string[];
}

export type StructuredOutputResult =
  | { readonly ok: true; readonly value: JsonValue }
  | { readonly ok: false; readonly error: StructuredOutputError };

/**
 * Strip a triple-backtick code fence (optionally tagged `json`) from content.
 * Non-fenced content is returned unchanged.
 */
export function stripCodeFence(content: string): string {
  const match = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  return match ? match[1]!.trim() : content;
}

/** Parse model content as JSON, tolerating a surrounding code fence. */
export function parseJsonContent(content: string): JsonValue {
  return JSON.parse(stripCodeFence(content)) as JsonValue;
}

/** True when `value` is a plain (non-array) object. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function typeMatches(value: unknown, type: JsonSchemaType): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    case 'object':
      return isPlainObject(value);
    case 'array':
      return Array.isArray(value);
  }
}

function typeAllows(value: unknown, type: JsonSchemaType | readonly JsonSchemaType[]): boolean {
  const names = Array.isArray(type) ? type : [type];
  return names.some((name) => typeMatches(value, name));
}

function typeLabel(type: JsonSchemaType | readonly JsonSchemaType[]): string {
  return (Array.isArray(type) ? type : [type]).join('|');
}

/** Recursive schema validation. Returns a list of issue messages. */
function validateNode(
  value: unknown,
  schema: JsonPropertySchema,
  path: string,
): string[] {
  const issues: string[] = [];

  if (schema.type !== undefined && !typeAllows(value, schema.type)) {
    issues.push(
      `${path}: expected type ${typeLabel(schema.type)}, got ${typeof value}`,
    );
    return issues;
  }

  if (schema.properties !== undefined && isPlainObject(value)) {
    for (const required of schema.required ?? []) {
      if (!(required in value)) {
        issues.push(`${path}.${required}: missing required property`);
      }
    }
    for (const [key, child] of Object.entries(schema.properties)) {
      if (key in value) {
        issues.push(...validateNode(value[key], child, `${path}.${key}`));
      }
    }
  }

  if (schema.items !== undefined && Array.isArray(value)) {
    value.forEach((item, index) => {
      issues.push(...validateNode(item, schema.items!, `${path}[${index}]`));
    });
  }

  return issues;
}

/**
 * Validate a model response string against a structured-output schema.
 * Deterministic: same input always yields the same result.
 */
export function validateStructuredOutput(
  content: string,
  schema: StructuredOutputSchema,
): StructuredOutputResult {
  let value: unknown;
  try {
    value = parseJsonContent(content);
  } catch {
    return {
      ok: false,
      error: { message: 'Response is not valid JSON', issues: ['invalid JSON'] },
    };
  }

  const issues = validateNode(value, schema, '$');
  if (issues.length > 0) {
    return { ok: false, error: { message: issues[0] ?? 'validation failed', issues } };
  }
  return { ok: true, value: value as JsonValue };
}

/** Validate and return the parsed value, or throw a non-retryable provider error. */
export function assertStructuredOutput(
  content: string,
  schema: StructuredOutputSchema,
  options: { provider?: string; operation?: string } = {},
): JsonValue {
  const result = validateStructuredOutput(content, schema);
  if (!result.ok) {
    const operation = options.operation ?? 'generate';
    throw new ModelProviderError(
      `Structured output validation failed for '${operation}': ${result.error.message}`,
      {
        provider: options.provider ?? 'unknown',
        code: 'PROVIDER_ERROR',
        retryable: false,
      },
    );
  }
  return result.value;
}

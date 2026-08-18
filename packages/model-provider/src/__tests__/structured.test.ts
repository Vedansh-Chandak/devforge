import { describe, it, expect } from 'vitest';
import {
  validateStructuredOutput,
  assertStructuredOutput,
  parseJsonContent,
  stripCodeFence,
} from '../structured.js';
import { ModelProviderError } from '../errors.js';
import type { StructuredOutputSchema } from '../structured.js';

const PLAN_SCHEMA: StructuredOutputSchema = {
  type: 'object',
  properties: {
    goal: { type: 'string' },
    complexity: { type: 'string' },
    risk: { type: 'string' },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          estimatedCost: { type: 'integer' },
        },
        required: ['id', 'title'],
      },
    },
    requiresConfirmation: { type: 'boolean' },
  },
  required: ['goal', 'steps', 'requiresConfirmation'],
};

const VALID_PLAN = JSON.stringify({
  goal: 'Refactor planner',
  complexity: 'MEDIUM',
  risk: 'HIGH',
  steps: [
    { id: 'step-1', title: 'Search', estimatedCost: 1 },
    { id: 'step-2', title: 'Read', estimatedCost: 2 },
  ],
  requiresConfirmation: false,
});

describe('stripCodeFence', () => {
  it('extracts content from a json code fence', () => {
    expect(stripCodeFence('```json\n{"a": 1}\n```')).toBe('{"a": 1}');
  });

  it('extracts content from an untagged code fence', () => {
    expect(stripCodeFence('```\n{"a": 1}\n```')).toBe('{"a": 1}');
  });

  it('returns plain content unchanged', () => {
    expect(stripCodeFence('{"a": 1}')).toBe('{"a": 1}');
  });
});

describe('parseJsonContent', () => {
  it('parses plain JSON', () => {
    expect(parseJsonContent('{"a": 1}')).toEqual({ a: 1 });
  });

  it('parses fenced JSON', () => {
    expect(parseJsonContent('```json\n{"a": 1}\n```')).toEqual({ a: 1 });
  });

  it('throws on malformed JSON', () => {
    expect(() => parseJsonContent('not json')).toThrow();
  });
});

describe('validateStructuredOutput', () => {
  it('accepts a valid response and returns the parsed value', () => {
    const result = validateStructuredOutput(VALID_PLAN, PLAN_SCHEMA);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatchObject({ goal: 'Refactor planner', requiresConfirmation: false });
      expect(Array.isArray(result.value)).toBe(false);
    }
  });

  it('accepts fenced JSON content', () => {
    const result = validateStructuredOutput(`\`\`\`json\n${VALID_PLAN}\n\`\`\``, PLAN_SCHEMA);
    expect(result.ok).toBe(true);
  });

  it('rejects malformed JSON', () => {
    const result = validateStructuredOutput('not json at all', PLAN_SCHEMA);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Response is not valid JSON');
    }
  });

  it('rejects a missing required property with a path', () => {
    const result = validateStructuredOutput(
      JSON.stringify({ goal: 'x', requiresConfirmation: true }),
      PLAN_SCHEMA,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.issues[0]).toContain('$.steps');
    }
  });

  it('rejects a type mismatch', () => {
    const result = validateStructuredOutput(
      JSON.stringify({ goal: 42, steps: [], requiresConfirmation: true }),
      PLAN_SCHEMA,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.issues[0]).toContain('$.goal');
      expect(result.error.issues[0]).toContain('expected type string');
    }
  });

  it('validates nested object properties', () => {
    const schema: StructuredOutputSchema = {
      type: 'object',
      properties: {
        outer: {
          type: 'object',
          properties: { inner: { type: 'string' } },
          required: ['inner'],
        },
      },
      required: ['outer'],
    };
    expect(validateStructuredOutput('{"outer": {"inner": "ok"}}', schema).ok).toBe(true);
    const bad = validateStructuredOutput('{"outer": {}}', schema);
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.error.issues[0]).toContain('$.outer.inner');
    }
  });

  it('validates array items with paths', () => {
    const schema: StructuredOutputSchema = {
      type: 'object',
      properties: { tags: { type: 'array', items: { type: 'string' } } },
      required: ['tags'],
    };
    expect(validateStructuredOutput('{"tags": ["a", "b"]}', schema).ok).toBe(true);
    const bad = validateStructuredOutput('{"tags": ["a", 42]}', schema);
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.error.issues[0]).toContain('$.tags[1]');
    }
  });

  it('distinguishes integer from number', () => {
    const schema: StructuredOutputSchema = {
      type: 'object',
      properties: { count: { type: 'integer' } },
      required: ['count'],
    };
    expect(validateStructuredOutput('{"count": 3}', schema).ok).toBe(true);
    expect(validateStructuredOutput('{"count": 3.5}', schema).ok).toBe(false);
  });

  it('supports union types', () => {
    const schema: StructuredOutputSchema = {
      type: 'object',
      properties: { value: { type: ['string', 'number'] } },
      required: ['value'],
    };
    expect(validateStructuredOutput('{"value": "text"}', schema).ok).toBe(true);
    expect(validateStructuredOutput('{"value": 5}', schema).ok).toBe(true);
    expect(validateStructuredOutput('{"value": true}', schema).ok).toBe(false);
  });

  it('allows undeclared properties by default', () => {
    const result = validateStructuredOutput(
      '{"goal": "x", "steps": [], "requiresConfirmation": true, "extra": "ignored"}',
      PLAN_SCHEMA,
    );
    expect(result.ok).toBe(true);
  });

  it('is deterministic for the same input', () => {
    const a = validateStructuredOutput(VALID_PLAN, PLAN_SCHEMA);
    const b = validateStructuredOutput(VALID_PLAN, PLAN_SCHEMA);
    expect(a).toEqual(b);
  });
});

describe('assertStructuredOutput', () => {
  it('returns the parsed value on success', () => {
    const value = assertStructuredOutput(VALID_PLAN, PLAN_SCHEMA, { provider: 'test' });
    expect(value).toMatchObject({ goal: 'Refactor planner' });
  });

  it('throws a non-retryable PROVIDER_ERROR on failure', () => {
    try {
      assertStructuredOutput('not json', PLAN_SCHEMA, { provider: 'test' });
      expect.fail('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ModelProviderError);
      const pe = error as ModelProviderError;
      expect(pe.code).toBe('PROVIDER_ERROR');
      expect(pe.retryable).toBe(false);
      expect(pe.message).toContain('generate');
    }
  });
});

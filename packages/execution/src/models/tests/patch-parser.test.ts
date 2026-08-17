import { describe, it, expect } from 'vitest';
import { parsePatches } from '../patch-parser.js';
import { OUTPUT_TAGS } from '../prompt-builder.js';
import type { CodePatch } from '../../executor/patch-model.js';

const PATCHES: readonly CodePatch[] = [
  { id: 'p1', file: 'src/foo.ts', operation: 'CREATE', newContent: 'export const foo = 1;' },
  { id: 'p2', file: 'src/bar.ts', operation: 'MODIFY', expectedHash: 'fnv1a-abc', newContent: 'export const bar = 2;' },
  { id: 'p3', file: 'src/baz.ts', operation: 'DELETE', expectedHash: 'fnv1a-def' },
];

function wrapPatches(json: string): string {
  return `${OUTPUT_TAGS.PATCH_START}\n${json}\n${OUTPUT_TAGS.PATCH_END}`;
}

describe('parsePatches', () => {
  it('parses a valid tagged JSON array', () => {
    const output = wrapPatches(JSON.stringify(PATCHES));
    const result = parsePatches(output);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(PATCHES);
    }
  });

  it('parses a markdown code block', () => {
    const output = '```json\n' + JSON.stringify(PATCHES) + '\n```';
    const result = parsePatches(output);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(3);
    }
  });

  it('parses raw JSON without tags', () => {
    const result = parsePatches(JSON.stringify(PATCHES));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(3);
    }
  });

  it('recovers from trailing commas', () => {
    const messy = '[{"id":"p1","file":"a.ts","operation":"CREATE","newContent":"x",},{"id":"p2","file":"b.ts","operation":"DELETE",}]';
    const result = parsePatches(messy);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(2);
    }
  });

  it('wraps a single object into an array', () => {
    const single = '{"id":"p1","file":"a.ts","operation":"CREATE","newContent":"x"}';
    const result = parsePatches(single);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
    }
  });

  it('returns NO_TAGS_FOUND for garbage input', () => {
    const result = parsePatches('this is not JSON at all');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NO_TAGS_FOUND');
      expect(result.error.recoveryAttempted).toBe(true);
    }
  });

  it('rejects a patch missing required fields', () => {
    const bad = JSON.stringify([{ id: 'p1', operation: 'CREATE' }]);
    const result = parsePatches(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_SCHEMA');
      expect(result.error.partialValue).toBeDefined();
    }
  });

  it('rejects an invalid operation', () => {
    const bad = JSON.stringify([{ id: 'p1', file: 'a.ts', operation: 'MOVE' }]);
    const result = parsePatches(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_SCHEMA');
    }
  });

  it('rejects CREATE without newContent', () => {
    const bad = JSON.stringify([{ id: 'p1', file: 'a.ts', operation: 'CREATE' }]);
    const result = parsePatches(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_SCHEMA');
    }
  });

  it('rejects DELETE with newContent', () => {
    const bad = JSON.stringify([{ id: 'p1', file: 'a.ts', operation: 'DELETE', newContent: 'x' }]);
    const result = parsePatches(bad);
    expect(result.ok).toBe(false);
  });

  it('returns an empty array for empty patches', () => {
    const result = parsePatches(wrapPatches('[]'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([]);
    }
  });

  it('ignores extra text around the tags', () => {
    const output = `Here are the patches:\n${wrapPatches(JSON.stringify(PATCHES))}\nDone.`;
    const result = parsePatches(output);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(PATCHES);
    }
  });
});

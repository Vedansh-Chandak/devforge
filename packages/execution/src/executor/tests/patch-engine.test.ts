import { describe, it, expect } from 'vitest';
import {
  createPatchEngine,
  DefaultPatchEngine,
  fixedPatchEngine,
  failingPatchEngine,
  countingPatchEngine,
  type PatchEngine,
  type PatchGenerationRequest,
} from '../patch-engine.js';
import {
  scriptedCodingModel,
  fixedCodingModel,
  cancellingCodingModel,
  type CodingModel,
} from '../coding-model.js';
import type { CodePatch } from '../patch-model.js';
import { PatchGenerationError } from '../coding-errors.js';

const VALID_PATCHES: readonly CodePatch[] = [
  { id: 'p1', file: 'src/foo.ts', operation: 'CREATE', newContent: 'export const foo = 1;' },
  { id: 'p2', file: 'src/bar.ts', operation: 'MODIFY', newContent: 'export const bar = 2;', expectedHash: 'fnv1a-abc123' },
  { id: 'p3', file: 'src/baz.ts', operation: 'DELETE', expectedHash: 'fnv1a-def456' },
];

const REQUEST: PatchGenerationRequest = {
  goal: 'Add foo and bar',
  context: ['ctx1', 'ctx2'],
  generatedCount: 0,
};

describe('PatchEngine interface', () => {
  it('createPatchEngine produces a working engine', async () => {
    const model = fixedCodingModel(VALID_PATCHES);
    const engine = createPatchEngine({ model });
    const patches = await engine.generate(REQUEST);
    expect(patches).toEqual(VALID_PATCHES);
    expect(engine.name).toContain('default-patch-engine');
  });

  it('createPatchEngine tracks generation count', async () => {
    const model = fixedCodingModel(VALID_PATCHES);
    const engine = createPatchEngine({ model }) as DefaultPatchEngine;
    await engine.generate(REQUEST);
    await engine.generate(REQUEST);
    expect(engine.generations).toBe(2);
  });

  it('fixedPatchEngine returns same patches on every call', async () => {
    const engine = fixedPatchEngine(VALID_PATCHES);
    const patches1 = await engine.generate(REQUEST);
    const patches2 = await engine.generate(REQUEST);
    expect(patches1).toEqual(patches2);
    expect(patches1).toEqual(VALID_PATCHES);
  });

  it('failingPatchEngine throws the configured error', async () => {
    const error = new Error('model down');
    const engine = failingPatchEngine(error);
    await expect(engine.generate(REQUEST)).rejects.toThrow('model down');
  });

  it('countingPatchEngine tracks call count', async () => {
    const inner = fixedPatchEngine(VALID_PATCHES);
    const counting = countingPatchEngine(inner);
    await counting.generate(REQUEST);
    await counting.generate(REQUEST);
    expect(counting.calls).toBe(2);
  });

  it('respects abort signal', async () => {
    const controller = new AbortController();
    const model = cancellingCodingModel();
    const engine = createPatchEngine({ model });
    controller.abort();
    await expect(engine.generate({ ...REQUEST, signal: controller.signal })).rejects.toThrow(
      'Patch generation cancelled',
    );
  });
});

describe('PatchEngine structural validation', () => {
  it('rejects duplicate patch IDs', async () => {
    const dupPatches: readonly CodePatch[] = [
      { id: 'p1', file: 'a.ts', operation: 'CREATE', newContent: 'a' },
      { id: 'p1', file: 'b.ts', operation: 'CREATE', newContent: 'b' },
    ];
    const model = fixedCodingModel(dupPatches);
    const engine = createPatchEngine({ model });
    await expect(engine.generate(REQUEST)).rejects.toThrow(PatchGenerationError);
  });

  it('rejects invalid operations', async () => {
    const badPatches: readonly CodePatch[] = [
      { id: 'p1', file: 'a.ts', operation: 'INVALID' as any, newContent: 'a' },
    ];
    const model = fixedCodingModel(badPatches);
    const engine = createPatchEngine({ model });
    await expect(engine.generate(REQUEST)).rejects.toThrow(PatchGenerationError);
  });

  it('rejects empty file paths', async () => {
    const badPatches: readonly CodePatch[] = [
      { id: 'p1', file: '', operation: 'CREATE', newContent: 'a' },
    ];
    const model = fixedCodingModel(badPatches);
    const engine = createPatchEngine({ model });
    await expect(engine.generate(REQUEST)).rejects.toThrow(PatchGenerationError);
  });

  it('rejects absolute file paths', async () => {
    const badPatches: readonly CodePatch[] = [
      { id: 'p1', file: '/absolute/path.ts', operation: 'CREATE', newContent: 'a' },
    ];
    const model = fixedCodingModel(badPatches);
    const engine = createPatchEngine({ model });
    await expect(engine.generate(REQUEST)).rejects.toThrow(PatchGenerationError);
  });

  it('rejects traversal in file paths', async () => {
    const badPatches: readonly CodePatch[] = [
      { id: 'p1', file: 'src/../secret.ts', operation: 'CREATE', newContent: 'a' },
    ];
    const model = fixedCodingModel(badPatches);
    const engine = createPatchEngine({ model });
    await expect(engine.generate(REQUEST)).rejects.toThrow(PatchGenerationError);
  });

  it('rejects duplicate target files', async () => {
    const badPatches: readonly CodePatch[] = [
      { id: 'p1', file: 'src/a.ts', operation: 'CREATE', newContent: 'a' },
      { id: 'p2', file: 'src/a.ts', operation: 'CREATE', newContent: 'b' },
    ];
    const model = fixedCodingModel(badPatches);
    const engine = createPatchEngine({ model });
    await expect(engine.generate(REQUEST)).rejects.toThrow(PatchGenerationError);
  });

  it('rejects CREATE with empty content', async () => {
    const badPatches: readonly CodePatch[] = [
      { id: 'p1', file: 'a.ts', operation: 'CREATE', newContent: '' },
    ];
    const model = fixedCodingModel(badPatches);
    const engine = createPatchEngine({ model });
    await expect(engine.generate(REQUEST)).rejects.toThrow(PatchGenerationError);
  });

  it('rejects MODIFY with empty content', async () => {
    const badPatches: readonly CodePatch[] = [
      { id: 'p1', file: 'a.ts', operation: 'MODIFY', newContent: '' },
    ];
    const model = fixedCodingModel(badPatches);
    const engine = createPatchEngine({ model });
    await expect(engine.generate(REQUEST)).rejects.toThrow(PatchGenerationError);
  });

  it('rejects oversized patch content', async () => {
    const largeContent = 'x'.repeat(300 * 1024); // exceeds default 256KB
    const badPatches: readonly CodePatch[] = [
      { id: 'p1', file: 'a.ts', operation: 'CREATE', newContent: largeContent },
    ];
    const model = fixedCodingModel(badPatches);
    const engine = createPatchEngine({ model, validationConfig: { maxPatchBytes: 256 * 1024 } });
    await expect(engine.generate(REQUEST)).rejects.toThrow(PatchGenerationError);
  });

  it('rejects oversized batch', async () => {
    const patches = Array.from({ length: 5 }, (_, i) => ({
      id: `p${i}`,
      file: `a${i}.ts`,
      operation: 'CREATE' as const,
      newContent: 'x'.repeat(300 * 1024),
    }));
    const model = fixedCodingModel(patches);
    const engine = createPatchEngine({ model, validationConfig: { maxTotalPatchBytes: 500 * 1024 } });
    await expect(engine.generate(REQUEST)).rejects.toThrow(PatchGenerationError);
  });

  it('rejects DELETE with newContent', async () => {
    const badPatches: readonly CodePatch[] = [
      { id: 'p1', file: 'a.ts', operation: 'DELETE', newContent: 'should not be here' },
    ];
    const model = fixedCodingModel(badPatches);
    const engine = createPatchEngine({ model });
    await expect(engine.generate(REQUEST)).rejects.toThrow(PatchGenerationError);
  });

  it('rejects CREATE with expectedHash', async () => {
    const badPatches: readonly CodePatch[] = [
      { id: 'p1', file: 'a.ts', operation: 'CREATE', newContent: 'a', expectedHash: 'hash' },
    ];
    const model = fixedCodingModel(badPatches);
    const engine = createPatchEngine({ model });
    await expect(engine.generate(REQUEST)).rejects.toThrow(PatchGenerationError);
  });
});

describe('PatchEngine determinism', () => {
  it('produces identical results for identical inputs', async () => {
    const model = fixedCodingModel(VALID_PATCHES);
    const engine = createPatchEngine({ model });
    const r1 = await engine.generate(REQUEST);
    const r2 = await engine.generate(REQUEST);
    expect(r1).toEqual(r2);
  });

  it('normalizes file paths (removes empty segments)', async () => {
    const patches: readonly CodePatch[] = [
      { id: 'p1', file: 'src//foo.ts', operation: 'CREATE', newContent: 'a' },
    ];
    const model = fixedCodingModel(patches);
    const engine = createPatchEngine({ model });
    const result = await engine.generate(REQUEST);
    expect(result[0]!.file).toBe('src/foo.ts');
  });
});
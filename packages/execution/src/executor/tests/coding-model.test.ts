import { describe, it, expect } from 'vitest';
import {
  scriptedCodingModel,
  fixedCodingModel,
  failingCodingModel,
  cancellingCodingModel,
  customCodingModel,
  type CodingModel,
  type ScriptedCodingModel,
} from '../coding-model.js';
import { CodingModelError, PatchGenerationError } from '../coding-errors.js';
import type { CodePatch } from '../patch-model.js';

const PATCHES_A: readonly CodePatch[] = [
  { id: 'p1', file: 'a.ts', operation: 'CREATE', newContent: 'a' },
];
const PATCHES_B: readonly CodePatch[] = [
  { id: 'p2', file: 'b.ts', operation: 'MODIFY', newContent: 'b' },
];

const REQUEST = {
  goal: 'test goal',
  context: ['ctx1'],
  generatedCount: 0,
};

describe('CodingModel interface', () => {
  it('scriptedCodingModel returns patches in order', async () => {
    const { model, getCalls } = scriptedCodingModel([PATCHES_A, PATCHES_B]);
    const r1 = await model.generatePatch(REQUEST);
    expect(r1).toEqual(PATCHES_A);
    expect(getCalls()).toBe(1);
    const r2 = await model.generatePatch(REQUEST);
    expect(r2).toEqual(PATCHES_B);
    expect(getCalls()).toBe(2);
  });

  it('scriptedCodingModel throws when exhausted', async () => {
    const { model } = scriptedCodingModel([PATCHES_A]);
    await model.generatePatch(REQUEST);
    await expect(model.generatePatch(REQUEST)).rejects.toThrow(CodingModelError);
  });

  it('scriptedCodingModel respects abort signal', async () => {
    const { model } = scriptedCodingModel([PATCHES_A]);
    const controller = new AbortController();
    controller.abort();
    await expect(model.generatePatch({ ...REQUEST, signal: controller.signal })).rejects.toThrow(
      'Coding model cancelled',
    );
  });

  it('fixedCodingModel returns same patches every call', async () => {
    const model = fixedCodingModel(PATCHES_A);
    const r1 = await model.generatePatch(REQUEST);
    const r2 = await model.generatePatch(REQUEST);
    expect(r1).toEqual(PATCHES_A);
    expect(r2).toEqual(PATCHES_A);
  });

  it('failingCodingModel throws the provided error', async () => {
    const error = new Error('model failed');
    const model = failingCodingModel(error);
    await expect(model.generatePatch(REQUEST)).rejects.toThrow('model failed');
  });

  it('cancellingCodingModel throws on aborted signal', async () => {
    const model = cancellingCodingModel();
    const controller = new AbortController();
    controller.abort();
    await expect(model.generatePatch({ ...REQUEST, signal: controller.signal })).rejects.toThrow(
      'Operation cancelled by signal',
    );
  });

  it('cancellingCodingModel throws if not cancelled', async () => {
    const model = cancellingCodingModel();
    await expect(model.generatePatch(REQUEST)).rejects.toThrow(CodingModelError);
  });

  it('customCodingModel delegates to generator function', async () => {
    const model = customCodingModel(async (req) => [
      { id: 'custom', file: 'c.ts', operation: 'CREATE', newContent: `goal: ${req.goal}` },
    ]);
    const result = await model.generatePatch(REQUEST);
    expect(result[0]!.newContent).toBe('goal: test goal');
  });

  it('customCodingModel propagates errors from generator', async () => {
    const model = customCodingModel(async () => {
      throw new Error('custom error');
    });
    await expect(model.generatePatch(REQUEST)).rejects.toThrow('custom error');
  });
});

describe('ScriptedCodingModel introspection', () => {
  it('exposes call count', async () => {
    const { model, getCalls } = scriptedCodingModel([PATCHES_A, PATCHES_B]);
    expect(getCalls()).toBe(0);
    await model.generatePatch(REQUEST);
    expect(getCalls()).toBe(1);
    await model.generatePatch(REQUEST);
    expect(getCalls()).toBe(2);
  });

  it('returns deep copies to prevent mutation', async () => {
    const { model } = scriptedCodingModel([PATCHES_A, PATCHES_A]);
    const r1 = await model.generatePatch(REQUEST);
    expect(r1[0]!.file).toBe('a.ts');
    const r2 = await model.generatePatch(REQUEST);
    expect(r2[0]!.file).toBe('a.ts');
    // Mutating one result does not affect the other
    expect(r1[0]).not.toBe(r2[0]);
  });
});

describe('CodingModel determinism', () => {
  it('fixedCodingModel produces identical results', async () => {
    const model = fixedCodingModel(PATCHES_A);
    const r1 = await model.generatePatch(REQUEST);
    const r2 = await model.generatePatch(REQUEST);
    expect(r1).toEqual(r2);
  });

  it('scriptedCodingModel produces identical results for same index', async () => {
    const { model } = scriptedCodingModel([PATCHES_A, PATCHES_A]);
    const r1 = await model.generatePatch(REQUEST);
    const r2 = await model.generatePatch(REQUEST);
    expect(r1).toEqual(r2);
  });
});
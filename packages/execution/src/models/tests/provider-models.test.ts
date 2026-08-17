import { describe, it, expect } from 'vitest';
import { FakeModelProvider } from '@devforge/model-provider';
import type { ModelRequest } from '@devforge/model-provider';
import { ProviderCodingModel, ProviderReasoningModel } from '../provider-models.js';
import { OUTPUT_TAGS } from '../prompt-builder.js';
import { CodingModelError, ReasoningError } from '../../executor/coding-errors.js';
import type { Diagnostics } from '../../executor/diagnostics.js';
import type { CodePatch } from '../../executor/patch-model.js';

const PATCHES_JSON = JSON.stringify([
  { id: 'p1', file: 'src/foo.ts', operation: 'CREATE', newContent: 'export const foo = 1;' },
]);

const ANALYSIS_JSON = JSON.stringify({
  diagnosis: 'Type error in src/main.ts',
  category: 'TYPE_ERROR',
  confidence: 0.9,
  suggestedPaths: ['src/main.ts'],
  estimatedComplexity: 3,
});

const DECISION_JSON = JSON.stringify({
  strategy: 'PATCH',
  reason: 'Targeted fix',
  targetFiles: ['src/main.ts'],
  scope: 'MINIMAL',
});

const PATCHES: readonly CodePatch[] = [
  { id: 'p1', file: 'src/foo.ts', operation: 'CREATE', newContent: 'export const foo = 1;' },
];

const DIAGNOSTICS: Diagnostics = {
  source: 'verification',
  diagnostics: [
    { category: 'COMPILER', severity: 'error', message: 'Cannot find name foo', file: 'src/main.ts', code: 'TS2304' },
  ],
  stderr: [],
  verificationDurationMs: 10,
  summary: '1 error',
};

describe('ProviderCodingModel', () => {
  it('generates patches from a provider response', async () => {
    const provider = new FakeModelProvider({
      response: { content: `${OUTPUT_TAGS.PATCH_START}\n${PATCHES_JSON}\n${OUTPUT_TAGS.PATCH_END}` },
    });
    const model = new ProviderCodingModel({ provider });
    const patches = await model.generatePatch({ goal: 'Add foo', context: [], generatedCount: 0 });
    expect(patches).toEqual(PATCHES);
  });

  it('includes the goal in the provider request', async () => {
    const provider = new FakeModelProvider({
      response: { content: `${OUTPUT_TAGS.PATCH_START}\n[]\n${OUTPUT_TAGS.PATCH_END}` },
    });
    const model = new ProviderCodingModel({ provider });
    await model.generatePatch({ goal: 'Do the thing', context: ['ctx'], generatedCount: 1 });
    const history = provider.getRequestHistory();
    expect(history).toHaveLength(1);
    expect(history[0]!.messages[1]!.content).toContain('Do the thing');
    expect(history[0]!.messages[1]!.content).toContain('ctx');
  });

  it('throws CodingModelError when the provider fails', async () => {
    const provider = new FakeModelProvider({
      error: { message: 'rate limited', code: 'RATE_LIMITED', retryable: true },
    });
    const model = new ProviderCodingModel({ provider });
    await expect(model.generatePatch({ goal: 'g', context: [], generatedCount: 0 }))
      .rejects.toBeInstanceOf(CodingModelError);
  });

  it('throws CodingModelError on unparseable output', async () => {
    const provider = new FakeModelProvider({ response: { content: 'no json here' } });
    const model = new ProviderCodingModel({ provider });
    await expect(model.generatePatch({ goal: 'g', context: [], generatedCount: 0 }))
      .rejects.toBeInstanceOf(CodingModelError);
  });

  it('respects an aborted signal', async () => {
    const provider = new FakeModelProvider({ response: { content: '[]' } });
    const model = new ProviderCodingModel({ provider });
    const controller = new AbortController();
    controller.abort();
    await expect(model.generatePatch({ goal: 'g', context: [], generatedCount: 0, signal: controller.signal }))
      .rejects.toThrow('cancelled');
  });

  it('sets a descriptive default name', () => {
    const provider = new FakeModelProvider();
    const model = new ProviderCodingModel({ provider });
    expect(model.name).toBe('fake-provider-coding');
  });

  it('honors custom settings', async () => {
    const provider = new FakeModelProvider({
      response: { content: `${OUTPUT_TAGS.PATCH_START}\n[]\n${OUTPUT_TAGS.PATCH_END}` },
    });
    const model = new ProviderCodingModel({ provider, settings: { temperature: 0.9, maxTokens: 128 } });
    await model.generatePatch({ goal: 'g', context: [], generatedCount: 0 });
    const req: ModelRequest = provider.getRequestHistory()[0]!;
    expect(req.temperature).toBe(0.9);
    expect(req.maxTokens).toBe(128);
  });
});

describe('ProviderReasoningModel', () => {
  it('analyzes failures from a provider response', async () => {
    const provider = new FakeModelProvider({
      response: { content: `${OUTPUT_TAGS.REASONING_START}\n${ANALYSIS_JSON}\n${OUTPUT_TAGS.REASONING_END}` },
    });
    const model = new ProviderReasoningModel({ provider });
    const analysis = await model.analyzeFailure({ goal: 'g', diagnostics: DIAGNOSTICS, attempt: 1 });
    expect(analysis.diagnosis).toBe('Type error in src/main.ts');
    expect(analysis.category).toBe('TYPE_ERROR');
    expect(analysis.confidence).toBe(0.9);
  });

  it('decides repairs from a provider response', async () => {
    const responses = [
      `${OUTPUT_TAGS.REASONING_START}\n${ANALYSIS_JSON}\n${OUTPUT_TAGS.REASONING_END}`,
      `${OUTPUT_TAGS.REASONING_START}\n${DECISION_JSON}\n${OUTPUT_TAGS.REASONING_END}`,
    ];
    let index = 0;
    const provider = {
      id: 'cycling',
      generate: async () => ({ content: responses[index++]! }),
    };
    const model = new ProviderReasoningModel({ provider });
    const analysis = await model.analyzeFailure({ goal: 'g', diagnostics: DIAGNOSTICS, attempt: 1 });
    const decision = await model.decideRepair({ goal: 'g', diagnostics: DIAGNOSTICS, analysis, attempt: 1 });
    expect(decision.strategy).toBe('PATCH');
    expect(decision.targetFiles).toEqual(['src/main.ts']);
  });

  it('throws ReasoningError when the provider fails', async () => {
    const provider = new FakeModelProvider({
      error: { message: 'boom', code: 'PROVIDER_ERROR' },
    });
    const model = new ProviderReasoningModel({ provider });
    await expect(model.analyzeFailure({ goal: 'g', diagnostics: DIAGNOSTICS, attempt: 1 }))
      .rejects.toBeInstanceOf(ReasoningError);
  });

  it('throws ReasoningError on unparseable analysis', async () => {
    const provider = new FakeModelProvider({ response: { content: 'garbage' } });
    const model = new ProviderReasoningModel({ provider });
    await expect(model.analyzeFailure({ goal: 'g', diagnostics: DIAGNOSTICS, attempt: 1 }))
      .rejects.toBeInstanceOf(ReasoningError);
  });

  it('includes diagnostics summary in the request', async () => {
    const provider = new FakeModelProvider({
      response: { content: `${OUTPUT_TAGS.REASONING_START}\n${ANALYSIS_JSON}\n${OUTPUT_TAGS.REASONING_END}` },
    });
    const model = new ProviderReasoningModel({ provider });
    await model.analyzeFailure({ goal: 'g', diagnostics: DIAGNOSTICS, attempt: 2 });
    const req = provider.getRequestHistory()[0]!;
    const userContent = req.messages[1]!.content;
    expect(userContent).toContain('1 error');
    expect(userContent).toContain('Attempt: 2');
  });
});

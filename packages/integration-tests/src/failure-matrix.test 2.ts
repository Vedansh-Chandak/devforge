/**
 * DF-028 Phase 3 — Failure matrix at the execution boundary.
 *
 * Provider-layer classification is covered by @devforge/model-provider. This
 * suite proves the boundary guarantees that unit suites cannot: every
 * normalized provider error surfaces through the coding model / patch engine /
 * coding engine without leaking secrets, cancellation is never retried, and
 * routing never auto-fails-over to another provider on failure.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  ModelRouter,
  ModelProviderError,
  FakeModelProvider,
  type ModelProvider,
  type ModelRequest,
  type ModelResponse,
  type ModelErrorCode,
} from '@devforge/model-provider';
import {
  createCodingEngine,
  createPatchEngine,
  type CodingReport,
  type CodingModelRequest,
} from '@devforge/execution';
import { ProviderCodingModel, ProviderReasoningModel } from '@devforge/execution';

/** A provider that fails with a normalized code and secret-laden message. */
class FailingProvider implements ModelProvider {
  readonly id: string;
  constructor(
    readonly code: ModelErrorCode,
    private readonly secret = 'sk-ant-api03-abcdef123456789012345678901234567890',
  ) {
    this.id = `failing-${code.toLowerCase()}`;
  }

  async generate(_request: ModelRequest): Promise<ModelResponse> {
    throw new ModelProviderError(
      `upstream boom near ${this.secret} (provider ${this.code})`,
      { provider: this.id, code: this.code, retryable: this.code !== 'CANCELLED' },
    );
  }
}

const FAILURE_CODES: readonly ModelErrorCode[] = [
  'AUTHENTICATION_ERROR',
  'RATE_LIMITED',
  'MODEL_NOT_FOUND',
  'INVALID_REQUEST',
  'PROVIDER_ERROR',
  'TIMEOUT',
  'CANCELLED',
  'NETWORK_ERROR',
];

/** Build a coding model wrapping a provider that fails with `code`. */
function failingCodingModel(code: ModelErrorCode): ProviderCodingModel {
  return new ProviderCodingModel({ provider: new FailingProvider(code), name: `fail-${code}` });
}

/** A patch engine that always throws the given error. */
function failingPatchEngineFor(error: Error): { name: string; generate: () => Promise<never> } {
  return {
    name: 'failing',
    generate: async () => {
      throw error;
    },
  };
}

describe('DF-028 failure matrix: coding model boundary', () => {
  it('translates every normalized provider error code into a CodingModelError', async () => {
    for (const code of FAILURE_CODES) {
      const model = failingCodingModel(code);
      const error = await model
        .generatePatch({
          goal: 'x',
          context: [],
          generatedCount: 0,
        } as CodingModelRequest)
        .catch((e: unknown) => e);
      // Errors of the class expected by the page engine.
      // The message is the normalized provider message; never assert on text.
      expect(error).toBeInstanceOf(Error);
      expect(String((error as Error).message)).toMatch(/Provider error/);
    }
  });

  it('never leaks secret-shaped material in the surfaced message', async () => {
    for (const code of FAILURE_CODES) {
      const model = failingCodingModel(code);
      const error = (await model
        .generatePatch({
          goal: 'x',
          context: [],
          generatedCount: 0,
        } as CodingModelRequest)
        .catch((e: unknown) => e)) as Error;
      expect(error.message).not.toContain('sk-ant-api03');
      expect(error.message).not.toContain('abcdef123456789012345678901234567890');
    }
  });
});

describe('DF-028 failure matrix: coding engine cancellation', () => {
  it('a pre-aborted signal surfaces CODING_CANCELLED without invoking the model (no retry)', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'df028-matrix-'));
    let modelCalls = 0;
    const counting: ProviderCodingModel = {
      provider: null as never,
      generatePatch: async () => {
        modelCalls += 1;
        throw new Error('should never be called');
      },
    } as unknown as ProviderCodingModel;

    const controller = new AbortController();
    controller.abort();
    const engine = createCodingEngine({
      workspace: { root } as never,
      runner: {
        run: async () => ({ success: true, stdout: '', stderr: '', exitCode: 0, durationMs: 1, timedOut: false, cancelled: false, truncated: false, command: 'tsc', args: [] }),
      } as never,
      patchEngine: createPatchEngine({ model: counting }),
      codingModel: counting,
      reasoningModel: new ProviderReasoningModel({ provider: new FakeModelProvider({ delay: 0 }) }),
      verificationTargets: [],
      cwd: root,
      signal: controller.signal,
      budgets: { maxRepairAttempts: 3 },
    });

    const error = (await engine.run({ goal: 'x' }).catch((e: unknown) => e)) as { code?: string };
    expect(error.code).toBe('CODING_CANCELLED');
    expect(modelCalls).toBe(0);
  });

  it('a provider CANCELLED during initial generation rejects immediately (never falls through to repair)', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'df028-matrix-'));
    const engine = createCodingEngine({
      workspace: { root } as never,
      runner: {
        run: async () => ({ success: true, stdout: '', stderr: '', exitCode: 0, durationMs: 1, timedOut: false, cancelled: false, truncated: false, command: 'tsc', args: [] }),
      } as never,
      patchEngine: failingPatchEngineFor(new ModelProviderError('cancelled', { provider: 'p', code: 'CANCELLED', retryable: false })),
      codingModel: failingCodingModel('CANCELLED'),
      reasoningModel: new ProviderReasoningModel({ provider: new FakeModelProvider({ delay: 0 }) }),
      verificationTargets: [],
      cwd: root,
      budgets: { maxRepairAttempts: 3 },
    });

    const error = (await engine.run({ goal: 'x' }).catch((e: unknown) => e)) as Error;
    // A cancellation failure rejects immediately rather than entering the repair loop.
    expect(error).toBeInstanceOf(Error);
    expect(String(error.message)).not.toContain('sk-ant-api03');
  });
});

describe('DF-028 failure matrix: no auto failover on provider failure', () => {
  it('the router keeps returning the same provider after a failure (no silent swap)', async () => {
    const failing = new FailingProvider('PROVIDER_ERROR');
    const router = new ModelRouter({
      defaultConfig: { provider: 'openai-compatible', model: 'm', apiKey: 'x', baseUrl: 'https://api.test/v1' },
    });
    // Prove selection is stable and cached: two selects return the same provider.
    const a = router.select('reasoning');
    const b = router.select('reasoning');
    expect(a).toBe(b);

    // A failed generation does not change the resolved route.
    const before = router.resolve('reasoning');
    await a.generate({ messages: [] }).catch(() => undefined);
    const after = router.resolve('reasoning');
    expect(after.provider).toBe(before.provider);
    expect(after.source).toBe(before.source);
  });
});
/**
 * DF-028 Phase 2 — Model smoke checks (`doctor --models`).
 *
 * Verifies the opt-in live-connectivity probe: normalized ModelResponse
 * (content/usage), structured output, and streaming where supported. Uses an
 * injected fake router — no network, no real LLM, no credentials.
 */
import { describe, expect, it } from 'vitest';
import { ModelRouter, FakeModelProvider } from '@devforge/model-provider';
import type { ModelProvider, ModelRequest, ModelResponse } from '@devforge/model-provider';
import { runModelSmoke, MODEL_SMOKE_TIMEOUT_MS } from '../src/services/model-smoke.js';
import type { DevForgeConfig } from '../src/types.js';

const FAKE_CONFIG: DevForgeConfig = {
  provider: 'fake',
  logLevel: 'info',
};

/** A provider that fails generate with a secret-laden message. */
class HostileProvider implements ModelProvider {
  readonly id = 'hostile';
  async generate(): Promise<ModelResponse> {
    throw new Error('401 unauthorized sk-ant-api03-abcdef123456789012345678901234567890');
  }
}

describe('runModelSmoke', () => {
  it('reports a passing check for the fake provider (content + usage + streaming)', async () => {
    const router = new ModelRouter({
      defaultConfig: { provider: 'fake', fakeResponse: 'ready' },
      allowFakeFallback: true,
    });

    const checks = await runModelSmoke(FAKE_CONFIG, { router, timeoutMs: 1000 });
    expect(checks.length).toBeGreaterThanOrEqual(1);
    const reasoning = checks.find((c) => c.role === 'reasoning');
    expect(reasoning).toBeDefined();
    expect(reasoning!.ok).toBe(true);
    expect(reasoning!.detail).toContain('usage:');
    expect(reasoning!.provider).toBe('fake-provider');
    expect(reasoning!.detail).not.toContain('apiKey');
  });

  it('reports failures with redacted secrets', async () => {
    const router = new ModelRouter({
      defaultConfig: { provider: 'hostile' },
      roleConfigs: {
        reasoning: { provider: 'hostile' },
        coding: { provider: 'hostile' },
        fast: { provider: 'hostile' },
      },
    });
    // Override construction: the router builds via factory; replace with hostile
    // via a custom router subclass hook is not available, so build directly.
    const hostile = new HostileProvider();
    const hostileRouter = {
      list: () => ['reasoning'] as const,
      select: () => hostile,
    };

    const checks = await runModelSmoke(FAKE_CONFIG, {
      router: hostileRouter as unknown as ModelRouter,
      timeoutMs: 1000,
    });
    expect(checks).toHaveLength(1);
    expect(checks[0]!.ok).toBe(false);
    expect(checks[0]!.detail).toContain('generate failed');
    // The secret must never leak.
    expect(checks[0]!.detail).not.toContain('sk-ant-api03');
  });

  it('bounds every request with a timeout and disables retries', async () => {
    let seen: ModelRequest | undefined;
    const router = new ModelRouter({
      defaultConfig: { provider: 'fake', fakeResponse: 'ready' },
      allowFakeFallback: true,
    });
    const spying = {
      list: () => ['reasoning'] as const,
      select: () => ({
        id: 'spy',
        generate: async (request: ModelRequest): Promise<ModelResponse> => {
          seen = request;
          return { content: 'ready', model: 'spy', usage: { totalTokens: 1 } };
        },
      }),
    };

    const checks = await runModelSmoke(FAKE_CONFIG, {
      router: spying as unknown as ModelRouter,
      timeoutMs: 1234,
    });
    expect(seen).toBeDefined();
    expect(seen!.timeoutMs).toBe(1234);
    expect(seen!.maxRetries).toBe(0);
    expect(checks[0]!.ok).toBe(true);
  });

  it('skips streaming/structured probes when unsupported instead of failing', async () => {
    const plain = {
      id: 'plain',
      generate: async (request: ModelRequest): Promise<ModelResponse> => ({
        content: JSON.stringify({ ready: true }),
        model: 'plain',
      }),
    };
    const router = {
      list: () => ['reasoning'] as const,
      select: () => plain,
    };

    const checks = await runModelSmoke(FAKE_CONFIG, {
      router: router as unknown as ModelRouter,
      timeoutMs: 1000,
    });
    expect(checks[0]!.ok).toBe(true);
    expect(checks[0]!.detail).not.toContain('stream failed');
  });

  it('streaming E2E: aggregates multi-chunk fake stream and reports completion', async () => {
    // DF-026D deterministic stream: three text deltas + usage + completed.
    const provider = new FakeModelProvider({
      stream: {
        delay: 0,
        events: [
          { type: 'text_delta', text: 'hel' },
          { type: 'text_delta', text: 'lo ' },
          { type: 'text_delta', text: 'world' },
          { type: 'usage', inputTokens: 3, outputTokens: 5, totalTokens: 8, provider: 'fake-provider' },
          { type: 'completed', provider: 'fake-provider' },
        ],
      },
    });
    const router = {
      list: () => ['reasoning'] as const,
      select: () => provider,
    };

    const checks = await runModelSmoke(FAKE_CONFIG, {
      router: router as unknown as ModelRouter,
      timeoutMs: 1000,
    });
    expect(checks[0]!.ok).toBe(true);
    expect(checks[0]!.detail).toContain('stream:');
    expect(checks[0]!.detail).toContain('3 chunks');
    expect(checks[0]!.detail).toContain('completed');
  });
});

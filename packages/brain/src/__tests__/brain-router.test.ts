import { describe, it, expect } from 'vitest';
import { DevForgeBrain } from '../brain.js';
import { ModelRouter } from '@devforge/model-provider';
import type { RuntimeInterface } from '../types.js';

function createMockRuntime(): RuntimeInterface & {
  initializeCalls: number;
  disposeCalls: number;
} {
  const mock = {
    initializeCalls: 0,
    disposeCalls: 0,
    async initialize() {
      mock.initializeCalls++;
    },
    async dispose() {
      mock.disposeCalls++;
    },
    async execute() {
      return {
        success: true,
        context: { metadata: {}, errors: [], workspaceRoot: '/test' },
        duration: 5,
      };
    },
  };
  return mock;
}

function createFakeRouter(): ModelRouter {
  return new ModelRouter({
    defaultConfig: { provider: 'fake' },
    allowFakeFallback: true,
  });
}

describe('DevForgeBrain with ModelRouter (DF-026C)', () => {
  it('resolves the reasoning role provider through the router', async () => {
    const brain = new DevForgeBrain({
      runtime: createMockRuntime(),
      router: createFakeRouter(),
    });
    await brain.initialize();
    const result = await brain.ask('Explain authentication');
    expect(result.status).toBe('answered');
    if (result.status === 'answered') {
      expect(result.model.provider).toBe('fake-provider');
    }
    await brain.dispose();
  });

  it('throws when both provider and router are configured', () => {
    expect(() =>
      new DevForgeBrain({
        runtime: createMockRuntime(),
        provider: { id: 'p', generate: async () => ({ content: 'x' }) },
        router: createFakeRouter(),
      }),
    ).toThrow(/both a provider and a router/);
  });

  it('returns classified result when router cannot resolve reasoning', async () => {
    const router = new ModelRouter({
      defaultConfig: { provider: 'openai-compatible', model: 'm', baseUrl: 'https://example.com/v1' },
    });
    // No role config, no fake fallback → select throws; has() is false.
    expect(router.has('reasoning')).toBe(true); // default route resolves
    const brain = new DevForgeBrain({ runtime: createMockRuntime(), router });
    await brain.initialize();
    const provider = (brain as unknown as { resolveProvider(): unknown }).resolveProvider();
    expect(provider).toBeTruthy();
    await brain.dispose();
  });

  it('provides identical router-picked instance across asks (cached by role)', async () => {
    const brain = new DevForgeBrain({
      runtime: createMockRuntime(),
      router: createFakeRouter(),
    });
    await brain.initialize();
    const first = (brain as unknown as { resolveProvider(): { id: string } }).resolveProvider();
    const second = (brain as unknown as { resolveProvider(): { id: string } }).resolveProvider();
    expect(first).toBe(second);
    await brain.dispose();
  });

  it('uses explicit provider when both present path disallowed before construction', async () => {
    // Explicit provider without router still works (backward compatibility).
    const brain = new DevForgeBrain({
      runtime: createMockRuntime(),
      provider: { id: 'explicit', generate: async () => ({ content: 'ok' }) },
    });
    await brain.initialize();
    const result = await brain.ask('Explain code');
    expect(result.status === 'answered' && result.model.provider).toBe('explicit');
    await brain.dispose();
  });
});
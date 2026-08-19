import { describe, it, expect } from 'vitest';
import { DevForgeBrain } from '../brain.js';
import { createModelRouter, FakeModelProvider } from '@devforge/model-provider';
import type { RuntimeInterface } from '../types.js';

function createMockRuntime(): RuntimeInterface {
  return {
    async initialize() {},
    async dispose() {},
    async execute() {
      return { success: true, context: { metadata: {}, workspaceRoot: '/test' }, duration: 5 };
    },
  };
}

describe('DevForgeBrain role routing (DF-027)', () => {
  it('resolves the reasoning role by default', async () => {
    const router = createModelRouter({
      defaultConfig: { provider: 'fake' },
      allowFakeFallback: true,
    });
    const brain = new DevForgeBrain({ runtime: createMockRuntime(), router });
    await brain.initialize();
    const provider = (brain as unknown as { resolveProvider(): { id: string } }).resolveProvider();
    expect(provider!.id).toBe('fake-provider');
    const result = await brain.ask('Explain authentication');
    expect(result.status).toBe('answered');
    if (result.status === 'answered') {
      expect(result.model.provider).toBe('fake-provider');
    }
    await brain.dispose();
  });

  it('routes to the fast role when configured with role: fast', async () => {
    const router = createModelRouter({
      defaultConfig: { provider: 'fake' },
      roleConfigs: { fast: { provider: 'fake', fakeResponse: { content: 'fast answer' } } },
      allowFakeFallback: true,
    });
    const brain = new DevForgeBrain({ runtime: createMockRuntime(), router, role: 'fast' });
    await brain.initialize();
    const result = await brain.ask('what does the module do');
    expect(result.status).toBe('answered');
    if (result.status === 'answered') {
      expect(result.answer).toBe('fast answer');
    }
    await brain.dispose();
  });

  it('uses the fast role as a selection fallback when reasoning is not configured', async () => {
    // No defaultConfig: only the fast role resolves (fake provider, no fallback).
    const router = createModelRouter({
      roleConfigs: { fast: { provider: 'fake', fakeResponse: { content: 'lightweight' } } },
    });
    // Default askRole is 'reasoning'; unconfigured here → fast role serves it.
    const brain = new DevForgeBrain({ runtime: createMockRuntime(), router });
    await brain.initialize();
    const result = await brain.ask('how does this work');
    expect(result.status).toBe('answered');
    if (result.status === 'answered') {
      expect(result.answer).toBe('lightweight');
    }
    await brain.dispose();
  });

  it('returns classified when the requested role cannot be resolved', async () => {
    // No defaultConfig and no fake fallback: 'fast' is unconfigured, and the
    // reasoning→fast selection fallback does not apply for role 'fast'.
    const router = createModelRouter({
      roleConfigs: {
        reasoning: { provider: 'openai-compatible', model: 'm', baseUrl: 'https://example.com/v1' },
      },
    });
    const brain = new DevForgeBrain({ runtime: createMockRuntime(), router, role: 'fast' });
    await brain.initialize();
    const provider = (brain as unknown as { resolveProvider(): unknown }).resolveProvider();
    expect(provider).toBeUndefined();
    const result = await brain.ask('Explain code');
    expect(result.status).toBe('classified');
    await brain.dispose();
  });

  it('preserves explicit provider injection (backward compatibility)', async () => {
    const brain = new DevForgeBrain({
      runtime: createMockRuntime(),
      provider: new FakeModelProvider({ response: { content: 'explicit answer' } }),
    });
    await brain.initialize();
    const result = await brain.ask('what does the module do');
    expect(result.status).toBe('answered');
    if (result.status === 'answered') {
      expect(result.answer).toBe('explicit answer');
      expect(result.model.provider).toBe('fake-provider');
    }
    await brain.dispose();
  });
});
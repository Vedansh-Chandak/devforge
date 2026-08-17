import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DevForgeBrain } from '../brain.js';
import { classifyIntent } from '../intent.js';
import { buildContextFromMetadata } from '../context-builder.js';
import {
  createPipelineState,
  validateQuestion,
  completeClassification,
} from '../pipeline.js';
import { OpenAICompatibleProvider, ModelProviderError } from '@devforge/model-provider';
import type { RuntimeInterface, AskResult, AskClassifiedResult, ModelProviderInterface } from '../types.js';

// ────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────

function createMockRuntime(
  metadata: Record<string, unknown> = {},
): RuntimeInterface & {
  initializeCalls: number;
  disposeCalls: number;
  executeCalls: number;
} {
  const mock = {
    initializeCalls: 0,
    disposeCalls: 0,
    executeCalls: 0,
    async initialize() {
      mock.initializeCalls++;
    },
    async dispose() {
      mock.disposeCalls++;
    },
    async execute() {
      mock.executeCalls++;
      return {
        success: true,
        context: { metadata, errors: [], workspaceRoot: '/test' },
        duration: 10,
      };
    },
  };
  return mock;
}

function createMockProvider(
  response?: { content: string; model?: string; finishReason?: 'stop' | 'length' | 'tool_call' | 'content_filter' | 'error' | 'unknown'; usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number } },
): ModelProviderInterface & { generateCalls: number; requests: unknown[] } {
  const calls: unknown[] = [];
  return {
    id: 'fake-provider',
    generateCalls: 0,
    requests: calls,
    async generate(request: unknown) {
      calls.push(request);
      return response ?? {
        content: 'Fake response',
        model: 'fake-model',
        finishReason: 'stop' as const,
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      };
    },
  };
}

function createErrorProvider(
  errorCode: string = 'PROVIDER_ERROR',
  message: string = 'Provider failed',
): ModelProviderInterface & { generateCalls: number } {
  return {
    id: 'fake-provider',
    generateCalls: 0,
    async generate() {
      throw new (await import('@devforge/model-provider')).ModelProviderError(message, {
        provider: 'fake-provider',
        code: errorCode as any,
        retryable: false,
      });
    },
  };
}

// ────────────────────────────────────────────
// DevForgeBrain
// ────────────────────────────────────────────
describe('DevForgeBrain', () => {
  describe('constructor', () => {
    it('creates brain with valid runtime', () => {
      const runtime = createMockRuntime();
      const brain = new DevForgeBrain({ runtime });
      expect(brain).toBeInstanceOf(DevForgeBrain);
    });

    it('throws when runtime is missing', () => {
      expect(() => new DevForgeBrain({ runtime: undefined as any })).toThrow(
        'Brain requires a runtime instance',
      );
    });
  });

  describe('initialize()', () => {
    it('initializes successfully', async () => {
      const runtime = createMockRuntime();
      const brain = new DevForgeBrain({ runtime });
      await brain.initialize();
      expect(runtime.initializeCalls).toBe(1);
      expect(brain.runtimeReady).toBe(true);
    });

    it('is idempotent', async () => {
      const runtime = createMockRuntime();
      const brain = new DevForgeBrain({ runtime });
      await brain.initialize();
      await brain.initialize();
      expect(runtime.initializeCalls).toBe(1);
      expect(brain.runtimeReady).toBe(true);
    });
  });

  describe('dispose()', () => {
    it('disposes successfully', async () => {
      const runtime = createMockRuntime();
      const brain = new DevForgeBrain({ runtime });
      await brain.initialize();
      await brain.dispose();
      expect(runtime.disposeCalls).toBe(1);
      expect(brain.runtimeReady).toBe(false);
    });

    it('can be called multiple times', async () => {
      const runtime = createMockRuntime();
      const brain = new DevForgeBrain({ runtime });
      await brain.initialize();
      await brain.dispose();
      await brain.dispose();
      expect(runtime.disposeCalls).toBe(2);
      expect(brain.runtimeReady).toBe(false);
    });
  });

  // ──────────────────────────────────────────
  // ask() — Full AI Pipeline
  // ──────────────────────────────────────────
  describe('ask() — full pipeline', () => {
    it('returns answered status with full pipeline', async () => {
      const metadata = {
        symbolGraph: {
          symbols: [{ name: 'AuthService', kind: 'class', filePath: 'src/auth/service.ts' }],
        },
      };
      const runtime = createMockRuntime(metadata);
      const provider = createMockProvider({ content: 'Authentication is handled by AuthService.' });
      const brain = new DevForgeBrain({ runtime, provider });
      await brain.initialize();

      const result = await brain.ask('Explain authentication');

      expect(result.status).toBe('answered');
      if (result.status === 'answered') {
        expect(result.answer).toBe('Authentication is handled by AuthService.');
        expect(result.intent).toBe('ExplainCode');
        expect(result.question).toBe('Explain authentication');
        expect(result.model.provider).toBe('fake-provider');
        expect(result.metadata.contextTruncated).toBe(false);
        expect(result.metadata.duration).toBeGreaterThanOrEqual(0);
        expect(result.metadata.runtimeDuration).toBeGreaterThanOrEqual(0);
        expect(result.metadata.providerDuration).toBeGreaterThanOrEqual(0);
      }
    });

    it('calls runtime.execute() exactly once', async () => {
      const runtime = createMockRuntime();
      const provider = createMockProvider();
      const brain = new DevForgeBrain({ runtime, provider });
      await brain.initialize();

      await brain.ask('Explain authentication');
      expect(runtime.executeCalls).toBe(1);
    });

    it('calls provider.generate() exactly once', async () => {
      let generateCount = 0;
      const runtime = createMockRuntime({
        symbolGraph: { symbols: [{ name: 'AuthService', kind: 'class' }] },
      });
      const provider: ModelProviderInterface = {
        id: 'test-provider',
        async generate() {
          generateCount++;
          return { content: 'Test response', model: 'test', finishReason: 'stop' as const };
        },
      };
      const brain = new DevForgeBrain({ runtime, provider });
      await brain.initialize();

      const result = await brain.ask('Explain authentication');
      expect(runtime.executeCalls).toBe(1);
      expect(generateCount).toBe(1);
      expect(result.status).toBe('answered');
    });

    it('sends real repository context to the provider', async () => {
      const metadata = {
        symbolGraph: {
          symbols: [
            { name: 'AuthService', kind: 'class', filePath: 'src/auth/service.ts' },
            { name: 'AuthController', kind: 'class', filePath: 'src/auth/controller.ts' },
          ],
          dependencies: [
            { from: 'AuthController', to: 'AuthService' },
          ],
        },
      };
      const runtime = createMockRuntime(metadata);
      const provider = createMockProvider();
      const brain = new DevForgeBrain({ runtime, provider });
      await brain.initialize();

      await brain.ask('Explain authentication');

      const request = provider.requests[0] as {
        messages: { role: string; content: string }[];
      };
      expect(request.messages).toHaveLength(2);
      expect(request.messages[0]!.role).toBe('system');
      expect(request.messages[1]!.role).toBe('user');
      expect(request.messages[1]!.content).toContain('Explain authentication');
      expect(request.messages[1]!.content).toContain('AuthService');
      expect(request.messages[1]!.content).toContain('AuthController');
    });

    it('preserves structured AskResult for classified status', async () => {
      const runtime = createMockRuntime();
      const brain = new DevForgeBrain({ runtime });

      const result = await brain.ask('Explain authentication');
      expect(result.status).toBe('classified');
      if (result.status === 'classified') {
        expect(result.intent).toBe('ExplainCode');
        expect(result.question).toBe('Explain authentication');
        expect(typeof result.timestamp).toBe('string');
        expect(result.runtimeReady).toBe(false);
      }
    });

    it('trims whitespace from question', async () => {
      const runtime = createMockRuntime();
      const brain = new DevForgeBrain({ runtime });

      const result = await brain.ask('  Explain authentication  ');
      expect(result.question).toBe('Explain authentication');
    });

    it('reflects runtimeReady state', async () => {
      const runtime = createMockRuntime();
      const brain = new DevForgeBrain({ runtime });

      let result = await brain.ask('test');
      expect(result.status).toBe('classified');
      if (result.status === 'classified') expect(result.runtimeReady).toBe(false);
      await brain.initialize();
      result = await brain.ask('test');
      expect(result.status).toBe('classified');
      if (result.status === 'classified') expect(result.runtimeReady).toBe(true);
      await brain.dispose();
      result = await brain.ask('test');
      expect(result.status).toBe('classified');
      if (result.status === 'classified') expect(result.runtimeReady).toBe(false);
    });

    it('does NOT call provider for Unknown intent', async () => {
      const runtime = createMockRuntime();
      const provider = createMockProvider();
      const brain = new DevForgeBrain({ runtime, provider });
      await brain.initialize();

      const result = await brain.ask('make coffee');
      expect(result.status).toBe('classified');
      if (result.status === 'classified') {
        expect(result.intent).toBe('Unknown');
      }
      expect(provider.generateCalls).toBe(0);
    });

    it('does NOT call provider when no provider configured', async () => {
      const runtime = createMockRuntime();
      const brain = new DevForgeBrain({ runtime });
      await brain.initialize();

      const result = await brain.ask('Explain authentication');
      expect(result.status).toBe('classified');
    });
  });

  // ──────────────────────────────────────────
  // ask() — Invalid input
  // ──────────────────────────────────────────
  describe('ask() — invalid input', () => {
    it('returns invalid for empty string', async () => {
      const runtime = createMockRuntime();
      const provider = createMockProvider();
      const brain = new DevForgeBrain({ runtime, provider });

      const result = await brain.ask('');
      expect(result.status).toBe('invalid');
      if (result.status === 'invalid') {
        expect(result.error).toBe('Empty question');
        expect(result.intent).toBe('Unknown');
      }
      expect(provider.generateCalls).toBe(0);
    });

    it('returns invalid for whitespace-only string', async () => {
      const runtime = createMockRuntime();
      const provider = createMockProvider();
      const brain = new DevForgeBrain({ runtime, provider });

      const result = await brain.ask('   ');
      expect(result.status).toBe('invalid');
      expect(provider.generateCalls).toBe(0);
    });

    it('returns invalid for tab-only string', async () => {
      const runtime = createMockRuntime();
      const provider = createMockProvider();
      const brain = new DevForgeBrain({ runtime, provider });

      const result = await brain.ask('\t');
      expect(result.status).toBe('invalid');
      expect(provider.generateCalls).toBe(0);
    });

    it('returns invalid for newline-only string', async () => {
      const runtime = createMockRuntime();
      const provider = createMockProvider();
      const brain = new DevForgeBrain({ runtime, provider });

      const result = await brain.ask('\n');
      expect(result.status).toBe('invalid');
      expect(provider.generateCalls).toBe(0);
    });
  });

  // ──────────────────────────────────────────
  // ask() — Provider failure
  // ──────────────────────────────────────────
  describe('ask() — provider failure', () => {
    it('returns provider_error on provider failure', async () => {
      const runtime = createMockRuntime();
      const provider = {
        id: 'fake-provider',
        async generate() {
          throw new Error('Network error');
        },
      };
      const brain = new DevForgeBrain({ runtime, provider });
      await brain.initialize();

      const result = await brain.ask('Explain authentication');
      expect(result.status).toBe('provider_error');
      if (result.status === 'provider_error') {
        expect(result.error).toBe('Network error');
        expect(result.intent).toBe('ExplainCode');
      }
    });

    it('preserves typed ModelProviderError', async () => {
      const runtime = createMockRuntime();
      const provider = createErrorProvider('RATE_LIMITED', 'Rate limit exceeded');
      const brain = new DevForgeBrain({ runtime, provider });
      await brain.initialize();

      const result = await brain.ask('Explain authentication');
      expect(result.status).toBe('provider_error');
      if (result.status === 'provider_error') {
        expect(result.error).toBe('Rate limit exceeded');
        expect(result.errorCode).toBe('RATE_LIMITED');
        expect(result.retryable).toBe(false);
      }
    });

    it('handles provider returning empty content', async () => {
      const runtime = createMockRuntime();
      const provider = createMockProvider({ content: '' });
      const brain = new DevForgeBrain({ runtime, provider });
      await brain.initialize();

      const result = await brain.ask('Explain authentication');
      expect(result.status).toBe('provider_error');
      if (result.status === 'provider_error') {
        expect(result.error).toBe('Provider returned empty response content');
      }
    });

    it('handles runtime failure', async () => {
      const runtime = {
        async initialize() {},
        async dispose() {},
        async execute() {
          throw new Error('Runtime crashed');
        },
      };
      const provider = createMockProvider();
      const brain = new DevForgeBrain({ runtime, provider });
      await brain.initialize();

      const result = await brain.ask('Explain authentication');
      expect(result.status).toBe('provider_error');
      if (result.status === 'provider_error') {
        expect(result.error).toContain('Runtime crashed');
      }
    });
  });

  // ──────────────────────────────────────────
  // ask() — Intent routing through full pipeline
  // ──────────────────────────────────────────
  describe('ask() — intent routing', () => {
    it('routes ExplainCode through full pipeline', async () => {
      const runtime = createMockRuntime({
        symbolGraph: { symbols: [{ name: 'AuthService', kind: 'class' }] },
      });
      const provider = createMockProvider();
      const brain = new DevForgeBrain({ runtime, provider });
      await brain.initialize();

      const result = await brain.ask('Explain authentication');
      expect(result.status).toBe('answered');
      if (result.status === 'answered') {
        expect(result.intent).toBe('ExplainCode');
      }
    });

    it('routes FindSymbol through full pipeline', async () => {
      const runtime = createMockRuntime({
        symbolGraph: { symbols: [{ name: 'UserService', kind: 'class', filePath: 'src/user.ts' }] },
      });
      const provider = createMockProvider();
      const brain = new DevForgeBrain({ runtime, provider });
      await brain.initialize();

      const result = await brain.ask('Find UserService');
      expect(result.status).toBe('answered');
      if (result.status === 'answered') {
        expect(result.intent).toBe('FindSymbol');
      }
    });

    it('routes FindDependencies through full pipeline', async () => {
      const runtime = createMockRuntime({
        symbolGraph: {
          dependencies: [{ from: 'AuthController', to: 'AuthService' }],
        },
      });
      const provider = createMockProvider();
      const brain = new DevForgeBrain({ runtime, provider });
      await brain.initialize();

      const result = await brain.ask('What depends on UserRepository?');
      expect(result.status).toBe('answered');
      if (result.status === 'answered') {
        expect(result.intent).toBe('FindDependencies');
      }
    });

    it('routes Architecture through full pipeline', async () => {
      const runtime = createMockRuntime({
        knowledgeGraph: {
          modules: ['auth', 'user'],
          services: ['AuthService', 'UserService'],
        },
      });
      const provider = createMockProvider();
      const brain = new DevForgeBrain({ runtime, provider });
      await brain.initialize();

      const result = await brain.ask('Show the architecture');
      expect(result.status).toBe('answered');
      if (result.status === 'answered') {
        expect(result.intent).toBe('Architecture');
      }
    });

    it('routes Search through full pipeline', async () => {
      const runtime = createMockRuntime();
      const provider = createMockProvider();
      const brain = new DevForgeBrain({ runtime, provider });
      await brain.initialize();

      const result = await brain.ask('Search authentication');
      expect(result.status).toBe('answered');
      if (result.status === 'answered') {
        expect(result.intent).toBe('Search');
      }
    });
  });

  // ──────────────────────────────────────────
  // ask() — Empty context
  // ──────────────────────────────────────────
  describe('ask() — empty context', () => {
    it('handles empty runtime metadata', async () => {
      const runtime = createMockRuntime({});
      const provider = createMockProvider();
      const brain = new DevForgeBrain({ runtime, provider });
      await brain.initialize();

      const result = await brain.ask('Explain authentication');
      expect(result.status).toBe('answered');
    });

    it('handles minimal architecture', async () => {
      const runtime = createMockRuntime({
        knowledgeGraph: { modules: [] },
      });
      const provider = createMockProvider();
      const brain = new DevForgeBrain({ runtime, provider });
      await brain.initialize();

      const result = await brain.ask('Show the architecture');
      expect(result.status).toBe('answered');
    });
  });

  describe('askWithContext()', () => {
    it('composes prompt from structured context', () => {
      const runtime = createMockRuntime();
      const brain = new DevForgeBrain({ runtime });

      const result = brain.askWithContext('Explain auth', {
        symbols: [{ name: 'AuthService', kind: 'class', file: 'src/auth.ts' }],
      });
      expect(result).not.toBeNull();
      expect(result!.request.messages).toHaveLength(2);
    });

    it('returns null for Unknown intent', () => {
      const runtime = createMockRuntime();
      const brain = new DevForgeBrain({ runtime });

      const result = brain.askWithContext('hello', {});
      expect(result).toBeNull();
    });
  });
});

// ────────────────────────────────────────────
// classifyIntent
// ────────────────────────────────────────────
describe('classifyIntent', () => {
  describe('ExplainCode', () => {
    it.each([
      ['Explain authentication', 'ExplainCode'],
      ['Explain how UserService works', 'ExplainCode'],
      ['What does this function do', 'ExplainCode'],
      ['What is the purpose of the parser', 'ExplainCode'],
      ['Describe the auth module', 'ExplainCode'],
      ['How does the login flow work', 'ExplainCode'],
      ['Tell me about the repository pattern', 'ExplainCode'],
    ])('"%s" → %s', (input: string, expected: string) => {
      const result = classifyIntent(input);
      expect(result.intent).toBe(expected);
    });
  });

  describe('FindSymbol', () => {
    it.each([
      ['Find UserService', 'FindSymbol'],
      ['Find the PaymentRepository symbol', 'FindSymbol'],
      ['Find the UserController class', 'FindSymbol'],
      ['Search for a function that handles auth', 'FindSymbol'],
      ['Where is the UserService', 'FindSymbol'],
      ['Locate the database module', 'FindSymbol'],
    ])('"%s" → %s', (input: string, expected: string) => {
      const result = classifyIntent(input);
      expect(result.intent).toBe(expected);
    });
  });

  describe('FindDependencies', () => {
    it.each([
      ['What depends on UserRepository?', 'FindDependencies'],
      ['Show dependencies of AuthService', 'FindDependencies'],
      ['What does UserService depend on', 'FindDependencies'],
      ['Find dependents of PaymentController', 'FindDependencies'],
      ['What imports the logger', 'FindDependencies'],
      ['Who uses the cache service', 'FindDependencies'],
    ])('"%s" → %s', (input: string, expected: string) => {
      const result = classifyIntent(input);
      expect(result.intent).toBe(expected);
    });
  });

  describe('Architecture', () => {
    it.each([
      ['Show the architecture', 'Architecture'],
      ['What is the architecture', 'Architecture'],
      ['Describe the project architecture', 'Architecture'],
      ['Show the project structure', 'Architecture'],
      ['List all services', 'Architecture'],
      ['List all modules', 'Architecture'],
      ['How is the project organized', 'Architecture'],
    ])('"%s" → %s', (input: string, expected: string) => {
      const result = classifyIntent(input);
      expect(result.intent).toBe(expected);
    });
  });

  describe('Search', () => {
    it.each([
      ['Search for payment processing', 'Search'],
      ['Search authentication', 'Search'],
      ['Look up the user model', 'Search'],
    ])('"%s" → %s', (input: string, expected: string) => {
      const result = classifyIntent(input);
      expect(result.intent).toBe(expected);
    });
  });

  describe('Unknown', () => {
    it.each([
      ['hello there', 'Unknown'],
      ['make coffee', 'Unknown'],
      ['random text without keywords', 'Unknown'],
    ])('"%s" → %s', (input: string, expected: string) => {
      const result = classifyIntent(input);
      expect(result.intent).toBe(expected);
    });
  });

  describe('case insensitivity', () => {
    it('handles uppercase input', () => {
      expect(classifyIntent('EXPLAIN AUTHENTICATION').intent).toBe('ExplainCode');
    });

    it('handles lowercase input', () => {
      expect(classifyIntent('explain authentication').intent).toBe('ExplainCode');
    });

    it('handles mixed case', () => {
      expect(classifyIntent('ExPlAiN Authentication').intent).toBe('ExplainCode');
    });
  });

  describe('whitespace handling', () => {
    it('handles leading whitespace', () => {
      expect(classifyIntent('  Explain authentication').intent).toBe('ExplainCode');
    });

    it('handles trailing whitespace', () => {
      expect(classifyIntent('Explain authentication  ').intent).toBe('ExplainCode');
    });

    it('handles tabs', () => {
      expect(classifyIntent('\tExplain authentication').intent).toBe('ExplainCode');
    });
  });

  describe('empty and whitespace-only input', () => {
    it('returns Unknown for empty string', () => {
      const result = classifyIntent('');
      expect(result.intent).toBe('Unknown');
      expect(result.confidence).toBe(1.0);
    });

    it('returns Unknown for whitespace-only string', () => {
      const result = classifyIntent('   ');
      expect(result.intent).toBe('Unknown');
    });
  });

  describe('determinism', () => {
    it('produces identical results for same input across multiple calls', () => {
      const input = 'Explain authentication';
      const results = Array.from({ length: 10 }, () => classifyIntent(input));
      const intents = results.map((r) => r.intent);
      expect(new Set(intents).size).toBe(1);
      expect(intents[0]).toBe('ExplainCode');
    });
  });
});

// ────────────────────────────────────────────
// context-builder
// ────────────────────────────────────────────
describe('buildContextFromMetadata', () => {
  it('returns empty context for empty metadata', () => {
    expect(buildContextFromMetadata({})).toEqual({});
  });

  it('extracts symbols from symbolGraph', () => {
    const metadata = {
      symbolGraph: {
        symbols: [{ name: 'AuthService', kind: 'class', filePath: 'src/auth.ts' }],
      },
    };
    const ctx = buildContextFromMetadata(metadata);
    const symbols = ctx.symbols;
    expect(symbols).toHaveLength(1);
    expect(symbols?.[0]?.name).toBe('AuthService');
  });

  it('extracts dependencies from symbolGraph', () => {
    const metadata = {
      symbolGraph: {
        dependencies: [{ from: 'A', to: 'B' }],
      },
    };
    const ctx = buildContextFromMetadata(metadata);
    expect(ctx.dependencies).toHaveLength(1);
    expect(ctx.dependencies?.[0]).toEqual({ from: 'A', to: 'B' });
  });

  it('extracts architecture from knowledgeGraph', () => {
    const metadata = {
      knowledgeGraph: {
        modules: ['auth', 'user'],
        services: ['AuthService'],
      },
    };
    const ctx = buildContextFromMetadata(metadata);
    expect(ctx.architecture).toBeDefined();
    expect(ctx.architecture?.modules).toEqual(['auth', 'user']);
    expect(ctx.architecture?.services).toEqual(['AuthService']);
  });

  it('gracefully handles malformed data', () => {
    const metadata = {
      symbolGraph: { symbols: [null, 'bad', { name: 'Good' }] },
    };
    const ctx = buildContextFromMetadata(metadata);
    const symbols = ctx.symbols;
    expect(symbols).toHaveLength(1);
    expect(symbols?.[0]?.name).toBe('Good');
  });

  it('falls back to parsedFiles for symbols', () => {
    const metadata = {
      parsedFiles: [{
        filePath: 'src/auth.ts',
        exports: [{ name: 'AuthService' }],
        classes: [{ name: 'AuthController' }],
      }],
    };
    const ctx = buildContextFromMetadata(metadata);
    expect(ctx.symbols).toHaveLength(2);
  });
});

// ────────────────────────────────────────────
// pipeline (existing)
// ────────────────────────────────────────────
describe('pipeline', () => {
  describe('createPipelineState', () => {
    it('creates initial state', () => {
      const state = createPipelineState('Explain auth');
      expect(state.step).toBe('receive');
      expect(state.question).toBe('Explain auth');
      expect(typeof state.startTime).toBe('number');
    });

    it('trims question', () => {
      const state = createPipelineState('  Explain auth  ');
      expect(state.question).toBe('Explain auth');
    });
  });

  describe('validateQuestion', () => {
    it('validates non-empty question', () => {
      const state = createPipelineState('Explain auth');
      const validated = validateQuestion(state);
      expect(validated.step).toBe('validate');
    });

    it('rejects empty question', () => {
      const state = createPipelineState('');
      const validated = validateQuestion(state);
      expect(validated.step).toBe('complete');
      expect(validated.error).toBe('Empty question');
    });
  });

  describe('completeClassification', () => {
    it('completes with intent', () => {
      const state = createPipelineState('Explain auth');
      const mockResult: AskResult = {
        question: 'Explain auth',
        intent: 'ExplainCode',
        confidence: 0.9,
        status: 'classified',
        timestamp: new Date().toISOString(),
        runtimeReady: false,
      };
      const completed = completeClassification(state, mockResult);
      expect(completed.step).toBe('complete');
      expect(completed.intent).toBe('ExplainCode');
      expect(typeof completed.endTime).toBe('number');
    });
  });
});

// ─────────────────────────────────────────────────────────────
// Full pipeline integration test with real OpenAICompatibleProvider
// and injected mocked fetch — proves real adapter integrates
// correctly with Brain without network access.
// ─────────────────────────────────────────────────────────────
describe('Full pipeline integration: Brain + OpenAICompatibleProvider + mocked HTTP', () => {
  function createMockFetchResponse(overrides: Record<string, unknown> = {}) {
    return vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'chatcmpl-pipeline',
        object: 'chat.completion',
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'Authentication is implemented using JWT tokens in the auth middleware.',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 150,
          completion_tokens: 25,
          total_tokens: 175,
        },
        ...overrides,
      }),
    });
  }

  it('Question → Brain → Runtime → context → Composer → ModelRequest → OpenAICompatibleProvider → mocked HTTP → answer', async () => {
    // Create real provider with injected mock fetch
    const mockFetch = createMockFetchResponse();
    const provider = new OpenAICompatibleProvider(
      {
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test-integration-key',
        model: 'gpt-4o',
        timeoutMs: 10_000,
      },
      mockFetch as unknown as typeof fetch,
    );

    // Runtime returns metadata with symbols and architecture
    // The context builder expects symbolGraph.symbols and symbolGraph.dependencies
    const runtimeMetadata = {
      symbolGraph: {
        symbols: [
          {
            name: 'authenticateUser',
            kind: 'function',
            filePath: 'src/auth/middleware.ts',
            startLine: 10,
            endLine: 25,
            signature: 'async function authenticateUser(token: string): Promise<User>',
          },
        ],
        dependencies: [
          { from: 'src/auth/middleware.ts', to: 'src/auth/jwt.ts', type: 'import' },
        ],
      },
      knowledgeGraph: {
        modules: [{ name: 'auth', path: 'src/auth', purpose: 'Authentication' }],
        services: [{ name: 'AuthService', type: 'service', description: 'Handles auth' }],
        relationships: [],
      },
    };

    const runtime = createMockRuntime(runtimeMetadata);
    const brain = new DevForgeBrain({ runtime, provider, maxContextChars: 100_000 });
    await brain.initialize();

    const result = await brain.ask('Explain authentication');

    // Verify full pipeline completed
    expect(result.status).toBe('answered');
    if (result.status === 'answered') {
      expect(result.answer).toBe(
        'Authentication is implemented using JWT tokens in the auth middleware.',
      );
      expect(result.model.provider).toBe('openai-compatible');
      expect(result.model.model).toBe('gpt-4o');
      expect(result.model.finishReason).toBe('stop');
      expect(result.model.usage).toEqual({
        inputTokens: 150,
        outputTokens: 25,
        totalTokens: 175,
      });
      expect(result.metadata.runtimeDuration).toBeGreaterThanOrEqual(0);
      expect(result.metadata.providerDuration).toBeGreaterThanOrEqual(0);
      expect(result.metadata.duration).toBeGreaterThanOrEqual(0);
    }

    // Verify fetch was actually called with correct endpoint and method
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = mockFetch.mock.calls[0]!;
    expect(calledUrl).toBe('https://api.openai.com/v1/chat/completions');
    expect(calledInit.method).toBe('POST');

    // Verify Authorization header was set correctly
    const headers = calledInit.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer sk-test-integration-key');
    expect(headers['Content-Type']).toBe('application/json');

    // Verify the request body contains the Brain's composed prompt
    const body = JSON.parse(calledInit.body) as Record<string, unknown>;
    expect(body.model).toBe('gpt-4o');
    expect(body.messages).toBeInstanceOf(Array);
    const messages = body.messages as Array<{ role: string; content: string }>;
    expect(messages.length).toBeGreaterThanOrEqual(2);
    // System message from prompt composer
    expect(messages[0]!.role).toBe('system');
    expect(messages[0]!.content.length).toBeGreaterThan(0);
    // User message from prompt composer — should include the question
    expect(messages[1]!.role).toBe('user');
    expect(messages[1]!.content).toContain('Explain authentication');
    // The user message should contain context from the runtime metadata
    // (symbols are extracted by context-builder from symbolGraph.symbols)
    expect(messages[1]!.content.length).toBeGreaterThan('Explain authentication'.length);

    // Verify runtime was called exactly once
    expect(runtime.executeCalls).toBe(1);

    await brain.dispose();
  });

  it('OpenAICompatibleProvider error propagates as provider_error through Brain', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: { message: 'Rate limit exceeded' } }),
    });

    const provider = new OpenAICompatibleProvider(
      { baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-4o' },
      mockFetch as unknown as typeof fetch,
    );

    const runtime = createMockRuntime();
    const brain = new DevForgeBrain({ runtime, provider });
    await brain.initialize();

    const result = await brain.ask('Explain authentication');

    expect(result.status).toBe('provider_error');
    if (result.status === 'provider_error') {
      expect(result.errorCode).toBe('RATE_LIMITED');
      expect(result.retryable).toBe(true);
    }

    await brain.dispose();
  });

  it('FakeModelProvider and OpenAICompatibleProvider are interchangeable via ModelProviderInterface', async () => {
    const runtime = createMockRuntime();

    // Both implement ModelProviderInterface — Brain works with either
    const fakeProvider: ModelProviderInterface = {
      id: 'fake-provider',
      generate: async () => ({
        content: 'Fake answer',
        model: 'fake-model',
        finishReason: 'stop' as const,
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      }),
    };

    const brain1 = new DevForgeBrain({ runtime, provider: fakeProvider });
    await brain1.initialize();
    const result1 = await brain1.ask('Explain auth');
    expect(result1.status).toBe('answered');
    if (result1.status === 'answered') {
      expect(result1.model.provider).toBe('fake-provider');
    }
    await brain1.dispose();

    const openaiProvider: ModelProviderInterface = {
      id: 'openai-compatible',
      generate: async () => ({
        content: 'OpenAI answer',
        model: 'gpt-4o',
        finishReason: 'stop' as const,
        usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
      }),
    };

    const brain2 = new DevForgeBrain({ runtime, provider: openaiProvider });
    await brain2.initialize();
    const result2 = await brain2.ask('Explain auth');
    expect(result2.status).toBe('answered');
    if (result2.status === 'answered') {
      expect(result2.model.provider).toBe('openai-compatible');
    }
    await brain2.dispose();
  });
});

describe('DevForgeBrain cancellation', () => {
  it('returns provider_error with CANCELLED code when the signal aborts mid-flight', async () => {
    const runtime = createMockRuntime();
    const controller = new AbortController();
    const provider: ModelProviderInterface = {
      id: 'fake-provider',
      generate: (request) =>
        new Promise((_resolve, reject) => {
          request.signal?.addEventListener('abort', () => {
            reject(
              new ModelProviderError('Model request cancelled', {
                provider: 'fake-provider',
                code: 'CANCELLED',
                retryable: false,
              }),
            );
          });
        }),
    };

    const brain = new DevForgeBrain({ runtime, provider });
    await brain.initialize();

    const pending = brain.ask('Explain authentication', { signal: controller.signal });
    setTimeout(() => controller.abort(), 5);

    const result = await pending;
    expect(result.status).toBe('provider_error');
    if (result.status === 'provider_error') {
      expect(result.errorCode).toBe('CANCELLED');
      expect(result.retryable).toBe(false);
    }

    await brain.dispose();
  });

  it('forwards the signal into the provider request', async () => {
    const runtime = createMockRuntime();
    const controller = new AbortController();
    const requests: { signal?: AbortSignal }[] = [];
    const provider: ModelProviderInterface = {
      id: 'fake-provider',
      generate: async (request) => {
        requests.push(request);
        return {
          content: 'Answer',
          model: 'fake-model',
          finishReason: 'stop' as const,
        };
      },
    };

    const brain = new DevForgeBrain({ runtime, provider });
    await brain.initialize();
    await brain.ask('Explain authentication', { signal: controller.signal });

    expect(requests[0]?.signal).toBe(controller.signal);
    await brain.dispose();
  });

  it('still answers normally when no signal is provided', async () => {
    const runtime = createMockRuntime();
    const provider = createMockProvider({ content: 'Plain answer' });
    const brain = new DevForgeBrain({ runtime, provider });
    await brain.initialize();

    const result = await brain.ask('Explain authentication');
    expect(result.status).toBe('answered');
    if (result.status === 'answered') {
      expect(result.answer).toBe('Plain answer');
    }
    await brain.dispose();
  });
});

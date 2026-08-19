import { BaseModelProvider } from '../provider.js';
import type { ModelRequest, ModelResponse } from '../types.js';
import { ModelProviderError } from '../errors.js';
import type { ModelErrorCode } from '../errors.js';
import type { ModelStream, ModelStreamEvent } from '../streaming.js';

export interface FakeProviderStreamConfig {
  /** Scripted events emitted in order. No network is ever involved. */
  readonly events?: readonly ModelStreamEvent[];
  /** Simulated in-stream failure thrown after the configured delay. */
  readonly error?: {
    readonly message: string;
    readonly code: ModelErrorCode;
    readonly retryable?: boolean;
  };
  /** Delay (ms) between scripted events after the initial one. Default 0. */
  readonly delay?: number;
}

export interface FakeProviderConfig {
  response?: ModelResponse;
  error?: {
    message: string;
    code: 'AUTHENTICATION_ERROR' | 'RATE_LIMITED' | 'TIMEOUT' | 'NETWORK_ERROR' | 'INVALID_REQUEST' | 'MODEL_NOT_FOUND' | 'PROVIDER_ERROR' | 'UNKNOWN';
    retryable?: boolean;
  };
  delay?: number;
  /** Deterministic streaming configuration (DF-026D). */
  stream?: FakeProviderStreamConfig;
}

export class FakeModelProvider extends BaseModelProvider {
  readonly id = 'fake-provider';

  private config: FakeProviderConfig;
  private requestHistory: ModelRequest[] = [];

  constructor(config: FakeProviderConfig = {}) {
    super();
    this.config = config;
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    this.validateRequest(request);
    this.requestHistory.push(request);

    if (this.config.delay) {
      const delay = this.config.delay;
      if (request.signal) {
        if (request.signal.aborted) {
          throw new ModelProviderError('Model request cancelled', {
            provider: this.id,
            code: 'CANCELLED',
            retryable: false,
          });
        }
        await new Promise<void>((resolve, reject) => {
          const onAbort = (): void => {
            clearTimeout(timer);
            reject(
              new ModelProviderError('Model request cancelled', {
                provider: this.id,
                code: 'CANCELLED',
                retryable: false,
              }),
            );
          };
          const timer = setTimeout(resolve, delay);
          request.signal!.addEventListener('abort', onAbort, { once: true });
        });
      } else {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    if (this.config.error) {
      throw new ModelProviderError(this.config.error.message, {
        provider: this.id,
        code: this.config.error.code,
        retryable: this.config.error.retryable,
      });
    }

    // Deterministic responses based on prompt content for specific models
    if (request.model === 'fake-planner-model') {
      if (request.messages.some(msg => msg.content.includes('Refactor planner')))
      {
        return {
          content: JSON.stringify({
            goal: 'Refactor the planner module',
            summary: 'Refactoring plan — 4 steps for: Refactor planner',
            complexity: 'MEDIUM',
            risk: 'HIGH',
            requiresConfirmation: true,
            steps: [
              {
                id: 'step-1',
                title: 'Search the repository',
                description: 'Search the repository for: Refactor planner',
                type: 'SEARCH',
                dependsOn: [],
                estimatedCost: 1,
                requiresConfirmation: false,
              },
              {
                id: 'step-2',
                title: 'Read relevant files',
                description: 'Read relevant files for: Refactor planner',
                type: 'READ',
                dependsOn: ['step-1'],
                estimatedCost: 1,
                requiresConfirmation: false,
              },
              {
                id: 'step-3',
                title: 'Analyze the findings',
                description: 'Analyze the findings for: Refactor planner',
                type: 'ANALYZE',
                dependsOn: ['step-2'],
                estimatedCost: 2,
                requiresConfirmation: false,
              },
              {
                id: 'step-4',
                title: 'Edit target files',
                description: 'Edit the target files for: Refactor planner',
                type: 'EDIT',
                dependsOn: ['step-3'],
                estimatedCost: 3,
                requiresConfirmation: true,
              },
            ],
            assumptions: [
              'Request interpreted as: Refactor planner',
              'Planning makes no changes to the workspace.',
            ],
            expectedOutputs: [
              'A validated execution plan with 4 ordered steps.',
              'Completion outcome: edit the target files.',
            ],
          }),
          model: 'fake-planner-model',
          finishReason: 'stop',
          usage: {
            inputTokens: 100,
            outputTokens: 200,
            totalTokens: 300,
          },
        };
      }
    }

    if (request.model === 'fake-intent-model') {
      if (request.messages.some(msg => msg.content.includes('Fix TypeScript errors'))) {
        return {
          content: JSON.stringify({
            intent: 'fix',
            confidence: 0.98,
          }),
          model: 'fake-intent-model',
          finishReason: 'stop',
          usage: {
            inputTokens: 10,
            outputTokens: 20,
            totalTokens: 30,
          },
        };
      }
    }

    if (request.model === 'fake-coding-model') {
      // Deterministic response for coding model (e.g., for 'explain')
      if (request.messages.some(msg => msg.content.includes('explain src/brain.ts'))) {
        return {
          content: 'This is a fake explanation for src/brain.ts',
          model: 'fake-coding-model',
          finishReason: 'stop',
          usage: {
            inputTokens: 50,
            outputTokens: 100,
            totalTokens: 150,
          },
        };
      }
    }

    return this.config.response ?? {
      content: 'Fake response',
      model: 'fake-model',
      finishReason: 'stop',
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
      },
    };
  }

  getRequestHistory(): ModelRequest[] {
    return [...this.requestHistory];
  }

  clearHistory(): void {
    this.requestHistory = [];
  }

  /**
   * Deterministic streaming support (DF-026D). Emits the scripted events from
   * `config.stream.events` (or a canonical text → usage → completed sequence
   * when no script is supplied), optionally applies failure simulation, and
   * honours `request.signal` cancellation at every step. No network.
   */
  async *stream(request: ModelRequest): ModelStream {
    this.validateRequest(request);
    this.requestHistory.push(request);

    const streamConfig = this.config.stream;
    const delay = streamConfig?.delay ?? this.config.delay ?? 0;

    if (request.signal?.aborted) {
      throw this.cancelled();
    }

    if (streamConfig?.error) {
      await this.waitFor(delay, request.signal);
      if (request.signal?.aborted) throw this.cancelled();
      throw new ModelProviderError(streamConfig.error.message, {
        provider: this.id,
        code: streamConfig.error.code,
        retryable: streamConfig.error.retryable,
      });
    }

    const script = streamConfig?.events ?? this.defaultStreamEvents();
    let index = 0;
    for (const event of script) {
      if (index > 0) {
        await this.waitFor(delay, request.signal);
      }
      if (request.signal?.aborted) throw this.cancelled();
      yield event;
      index += 1;
    }
  }

  private defaultStreamEvents(): readonly ModelStreamEvent[] {
    const response = this.config.response ?? {
      content: 'Fake response',
      model: 'fake-model',
      finishReason: 'stop',
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    };
    const events: ModelStreamEvent[] = [];
    if (response.content.length > 0) {
      events.push({ type: 'text_delta', text: response.content });
    }
    if (response.usage) {
      events.push({ type: 'usage', ...response.usage, provider: this.id });
    }
    events.push({ type: 'completed', provider: this.id });
    return events;
  }

  private waitFor(ms: number, signal?: AbortSignal): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    if (signal?.aborted) return Promise.reject(this.cancelled());
    return new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        clearTimeout(timer);
        reject(this.cancelled());
      };
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  private cancelled(): ModelProviderError {
    return new ModelProviderError('Model request cancelled', {
      provider: this.id,
      code: 'CANCELLED',
      retryable: false,
    });
  }
}

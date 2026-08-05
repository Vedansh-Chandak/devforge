mimport { BaseModelProvider } from '../provider.js';
import type { ModelRequest, ModelResponse } from '../types.js';
import { ModelProviderError } from '../errors.js';

export interface FakeProviderConfig {
  response?: ModelResponse;
  error?: {
    message: string;
    code: 'AUTHENTICATION_ERROR' | 'RATE_LIMITED' | 'TIMEOUT' | 'NETWORK_ERROR' | 'INVALID_REQUEST' | 'MODEL_NOT_FOUND' | 'PROVIDER_ERROR' | 'UNKNOWN';
    retryable?: boolean;
  };
  delay?: number;
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
      await new Promise((resolve) => setTimeout(resolve, this.config.delay));
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
}

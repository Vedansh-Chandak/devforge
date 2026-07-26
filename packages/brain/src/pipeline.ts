import type { IntentKind, AskResult } from './types.js';

export type PipelineStep = 'receive' | 'validate' | 'classify' | 'complete';

export interface PipelineState {
  step: PipelineStep;
  question: string;
  intent?: IntentKind;
  error?: string;
  startTime: number;
  endTime?: number;
}

export function createPipelineState(question: string): PipelineState {
  return {
    step: 'receive',
    question: question.trim(),
    startTime: Date.now(),
  };
}

export function validateQuestion(state: PipelineState): PipelineState {
  if (!state.question) {
    return {
      ...state,
      step: 'complete',
      error: 'Empty question',
    };
  }

  return {
    ...state,
    step: 'validate',
  };
}

export function completeClassification(
  state: PipelineState,
  result: AskResult,
): PipelineState {
  return {
    ...state,
    step: 'complete',
    intent: result.intent,
    endTime: Date.now(),
  };
}
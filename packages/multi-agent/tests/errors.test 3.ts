import { describe, expect, it } from 'vitest';
import {
  MULTI_AGENT_ERROR_CODES,
  MultiAgentCancellationError,
  MultiAgentConfirmationError,
  MultiAgentCycleError,
  MultiAgentDecompositionError,
  MultiAgentDuplicateError,
  MultiAgentError,
  MultiAgentExecutionError,
  MultiAgentInternalError,
  MultiAgentMergeConflictError,
  MultiAgentMergeViolationError,
  MultiAgentMissingDependencyError,
  MultiAgentRoleUnavailableError,
  MultiAgentSchedulingError,
  MultiAgentTimeoutError,
  MultiAgentValidationError,
  MultiAgentVerificationError,
  isMultiAgentError,
} from '../src/errors.js';

const errors = [
  new MultiAgentDecompositionError('x'),
  new MultiAgentValidationError('x'),
  new MultiAgentCycleError('x'),
  new MultiAgentDuplicateError('x'),
  new MultiAgentMissingDependencyError('x'),
  new MultiAgentSchedulingError('x'),
  new MultiAgentExecutionError('x'),
  new MultiAgentRoleUnavailableError('x'),
  new MultiAgentMergeConflictError('x'),
  new MultiAgentMergeViolationError('x'),
  new MultiAgentVerificationError('x'),
  new MultiAgentCancellationError('x'),
  new MultiAgentTimeoutError('x'),
  new MultiAgentConfirmationError('x'),
  new MultiAgentInternalError('x'),
];

describe('error hierarchy', () => {
  it('every error is an instanceof MultiAgentError and Error', () => {
    for (const err of errors) {
      expect(err).toBeInstanceOf(MultiAgentError);
      expect(err).toBeInstanceOf(Error);
    }
  });

  it('each error carries its stable code', () => {
    expect(new MultiAgentDecompositionError('x').code).toBe('MA_DECOMPOSITION');
    expect(new MultiAgentValidationError('x').code).toBe('MA_VALIDATION');
    expect(new MultiAgentCycleError('x').code).toBe('MA_GRAPH_CYCLE');
    expect(new MultiAgentDuplicateError('x').code).toBe('MA_GRAPH_DUPLICATE');
    expect(new MultiAgentMissingDependencyError('x').code).toBe('MA_GRAPH_MISSING_DEPENDENCY');
    expect(new MultiAgentSchedulingError('x').code).toBe('MA_SCHEDULING');
    expect(new MultiAgentExecutionError('x').code).toBe('MA_AGENT_EXECUTION');
    expect(new MultiAgentRoleUnavailableError('x').code).toBe('MA_ROLE_UNAVAILABLE');
    expect(new MultiAgentMergeConflictError('x').code).toBe('MA_MERGE_CONFLICT');
    expect(new MultiAgentMergeViolationError('x').code).toBe('MA_MERGE_VIOLATION');
    expect(new MultiAgentVerificationError('x').code).toBe('MA_VERIFICATION');
    expect(new MultiAgentCancellationError('x').code).toBe('MA_CANCELLED');
    expect(new MultiAgentTimeoutError('x').code).toBe('MA_TIMEOUT');
    expect(new MultiAgentConfirmationError('x').code).toBe('MA_CONFIRMATION_REJECTED');
    expect(new MultiAgentInternalError('x').code).toBe('MA_INTERNAL');
  });

  it('preserves the message', () => {
    const err = new MultiAgentCycleError('a cycle was found');
    expect(err.message).toBe('a cycle was found');
  });

  it('sets a descriptive name on each subclass', () => {
    expect(new MultiAgentCycleError('x').name).toBe('MultiAgentCycleError');
    expect(new MultiAgentInternalError('x').name).toBe('MultiAgentInternalError');
  });

  it('supports instanceof narrowing per subclass', () => {
    const err = new MultiAgentDuplicateError('dup');
    expect(err instanceof MultiAgentDuplicateError).toBe(true);
    expect(err instanceof MultiAgentCycleError).toBe(false);
  });

  it('isMultiAgentError narrows multi-agent errors', () => {
    expect(isMultiAgentError(new MultiAgentError('MA_INTERNAL', 'x'))).toBe(true);
    expect(isMultiAgentError(new MultiAgentTimeoutError('x'))).toBe(true);
    expect(isMultiAgentError(new Error('plain'))).toBe(false);
    expect(isMultiAgentError('string')).toBe(false);
    expect(isMultiAgentError(null)).toBe(false);
    expect(isMultiAgentError(undefined)).toBe(false);
  });

  it('throws errors carry their code and can be caught via base', () => {
    const boom = () => {
      throw new MultiAgentRoleUnavailableError('no agent');
    };
    try {
      boom();
      expect.unreachable();
    } catch (err) {
      expect(isMultiAgentError(err)).toBe(true);
      if (err instanceof MultiAgentError) {
        expect(err.code).toBe('MA_ROLE_UNAVAILABLE');
      }
    }
  });

  it('a base MultiAgentError can be constructed directly', () => {
    const err = new MultiAgentError('MA_INTERNAL', 'custom');
    expect(err.name).toBe('MultiAgentError');
    expect(err.code).toBe('MA_INTERNAL');
  });
});

describe('MULTI_AGENT_ERROR_CODES', () => {
  it('contains all supported codes', () => {
    expect(MULTI_AGENT_ERROR_CODES).toContain('MA_VALIDATION');
    expect(MULTI_AGENT_ERROR_CODES).toContain('MA_GRAPH_CYCLE');
    expect(MULTI_AGENT_ERROR_CODES).toContain('MA_TIMEOUT');
    expect(MULTI_AGENT_ERROR_CODES).toContain('MA_INTERNAL');
    expect(MULTI_AGENT_ERROR_CODES.length).toBeGreaterThanOrEqual(15);
  });

  it('has no duplicate codes', () => {
    expect(new Set(MULTI_AGENT_ERROR_CODES).size).toBe(MULTI_AGENT_ERROR_CODES.length);
  });
});
import { describe, expect, it } from 'vitest';
import {
  AUTONOMOUS_ERROR_CODES,
  AutonomousCancellationError,
  AutonomousConfidenceError,
  AutonomousDuplicateError,
  AutonomousError,
  AutonomousMaxAttemptsError,
  AutonomousPatchError,
  AutonomousPlanningError,
  AutonomousRollbackError,
  AutonomousTimeoutError,
  AutonomousValidationError,
} from '../errors.js';

describe('autonomous error codes', () => {
  it('exposes the canonical code set', () => {
    expect(AUTONOMOUS_ERROR_CODES.INVALID_CONFIG).toBe('INVALID_CONFIG');
    expect(AUTONOMOUS_ERROR_CODES.CANCELLED).toBe('CANCELLED');
    expect(AUTONOMOUS_ERROR_CODES.TIMEOUT).toBe('TIMEOUT');
    expect(AUTONOMOUS_ERROR_CODES.ROLLBACK_FAILED).toBe('ROLLBACK_FAILED');
    expect(AUTONOMOUS_ERROR_CODES.PATCH_GENERATION_FAILED).toBe('PATCH_GENERATION_FAILED');
    expect(AUTONOMOUS_ERROR_CODES.VERIFICATION_FAILED).toBe('VERIFICATION_FAILED');
    expect(AUTONOMOUS_ERROR_CODES.TERMINATED).toBe('TERMINATED');
    expect(AUTONOMOUS_ERROR_CODES.PLANNING_FAILED).toBe('PLANNING_FAILED');
  });
});

describe('AutonomousError', () => {
  it('carries the subclass name', () => {
    const error = new AutonomousValidationError('bad');
    expect(error.name).toBe('AutonomousValidationError');
  });

  it('defaults to the TERMINATED code', () => {
    const error = new AutonomousError('x');
    expect(error.code).toBe('TERMINATED');
  });

  it('preserves the prototype chain', () => {
    const error = new AutonomousDuplicateError('fp');
    expect(error).toBeInstanceOf(AutonomousError);
    expect(error).toBeInstanceOf(Error);
  });

  it('carries an explicit cause', () => {
    const cause = new Error('root');
    const error = new AutonomousError('x', { cause });
    expect(error.cause).toBe(cause);
  });

  it('carries an explicit attempt number', () => {
    const error = new AutonomousError('x', { attempt: 3 });
    expect(error.attempt).toBe(3);
  });
});

describe('AutonomousValidationError', () => {
  it('assigns the INVALID_CONFIG code', () => {
    expect(new AutonomousValidationError('x').code).toBe('INVALID_CONFIG');
  });
  it('is an AutonomousError', () => {
    expect(new AutonomousValidationError('x')).toBeInstanceOf(AutonomousError);
  });
});

describe('AutonomousCancellationError', () => {
  it('assigns the CANCELLED code', () => {
    expect(new AutonomousCancellationError('stop').code).toBe('CANCELLED');
  });
});

describe('AutonomousTimeoutError', () => {
  it('assigns the TIMEOUT code', () => {
    expect(new AutonomousTimeoutError('late').code).toBe('TIMEOUT');
  });
});

describe('AutonomousConfidenceError', () => {
  it('assigns the CONFIDENCE_BELOW_THRESHOLD code', () => {
    expect(new AutonomousConfidenceError(0.7, 0.2).code).toBe('CONFIDENCE_BELOW_THRESHOLD');
  });
  it('stores the threshold and score', () => {
    const error = new AutonomousConfidenceError(0.7, 0.2);
    expect(error.threshold).toBe(0.7);
    expect(error.score).toBe(0.2);
  });
  it('builds a descriptive message', () => {
    expect(new AutonomousConfidenceError(0.7, 0.2).message).toContain('0.2');
    expect(new AutonomousConfidenceError(0.7, 0.2).message).toContain('0.7');
  });
});

describe('AutonomousDuplicateError', () => {
  it('assigns the DUPLICATE_PATCH code', () => {
    expect(new AutonomousDuplicateError('fp').code).toBe('DUPLICATE_PATCH');
  });
  it('stores the fingerprint', () => {
    expect(new AutonomousDuplicateError('fp-123').fingerprint).toBe('fp-123');
  });
  it('mentions the fingerprint in the message', () => {
    expect(new AutonomousDuplicateError('fp-123').message).toContain('fp-123');
  });
});

describe('AutonomousMaxAttemptsError', () => {
  it('assigns the MAX_ATTEMPTS code', () => {
    expect(new AutonomousMaxAttemptsError(5).code).toBe('MAX_ATTEMPTS');
  });
  it('stores the limit', () => {
    expect(new AutonomousMaxAttemptsError(5).limit).toBe(5);
  });
});

describe('AutonomousRollbackError', () => {
  it('assigns the ROLLBACK_FAILED code', () => {
    expect(new AutonomousRollbackError('failed').code).toBe('ROLLBACK_FAILED');
  });
});

describe('AutonomousPatchError', () => {
  it('assigns the PATCH_GENERATION_FAILED code', () => {
    expect(new AutonomousPatchError('failed').code).toBe('PATCH_GENERATION_FAILED');
  });
});

describe('AutonomousPlanningError', () => {
  it('assigns the PLANNING_FAILED code', () => {
    expect(new AutonomousPlanningError('failed').code).toBe('PLANNING_FAILED');
  });
});
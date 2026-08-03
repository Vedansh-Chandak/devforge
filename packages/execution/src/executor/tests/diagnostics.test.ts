import { describe, it, expect } from 'vitest';
import {
  captureDiagnostics,
  captureCommandDiagnostics,
} from '../diagnostics.js';
import type { VerificationResult, VerificationOutcome } from '../types.js';

const MOCK_VERIFICATION_RESULT: VerificationResult = {
  ok: false,
  targets: [
    {
      targetId: 'typecheck',
      success: false,
      exitCode: 2,
      durationMs: 100,
      output: `src/foo.ts:10:5 - error TS2304: Cannot find name 'foo'\nsrc/bar.ts:20:1 - error TS2322: Type 'number' is not assignable to type 'string'\n`,
      timedOut: false,
      cancelled: false,
    },
    {
      targetId: 'test',
      success: false,
      exitCode: 1,
      durationMs: 50,
      output: `FAIL src/foo.test.ts > should work\n  × Expected 1 but got 2\n`,
      timedOut: false,
      cancelled: false,
    },
    {
      targetId: 'lint',
      success: true,
      exitCode: 0,
      durationMs: 30,
      output: '',
      timedOut: false,
      cancelled: false,
    },
  ],
  failedTargetId: 'typecheck',
  durationMs: 180,
  cancelled: false,
};

describe('captureDiagnostics', () => {
  it('extracts TypeScript compiler errors', () => {
    const result = captureDiagnostics(MOCK_VERIFICATION_RESULT);
    const compilerErrors = result.diagnostics.filter((d) => d.category === 'COMPILER');
    expect(compilerErrors).toHaveLength(2);
    expect(compilerErrors[0]).toMatchObject({
      category: 'COMPILER',
      targetId: 'typecheck',
      severity: 'error',
      file: 'src/foo.ts',
      line: 10,
      column: 5,
      code: 'TS2304',
    });
  });

  it('extracts test failures', () => {
    const result = captureDiagnostics(MOCK_VERIFICATION_RESULT);
    const testFailures = result.diagnostics.filter((d) => d.category === 'TEST');
    expect(testFailures).toHaveLength(1);
    expect(testFailures[0]).toMatchObject({
      category: 'TEST',
      targetId: 'test',
      severity: 'error',
      message: 'Expected 1 but got 2',
    });
  });

  it('includes successful targets in summary but no diagnostics', () => {
    const result = captureDiagnostics(MOCK_VERIFICATION_RESULT);
    const lintDiags = result.diagnostics.filter((d) => d.category === 'LINT');
    expect(lintDiags).toHaveLength(0);
  });

  it('captures stderr lines', () => {
    const result = captureDiagnostics(MOCK_VERIFICATION_RESULT);
    expect(result.stderr.length).toBeGreaterThan(0);
    expect(result.stderr.some((l) => l.includes('Cannot find name'))).toBe(true);
  });

  it('builds summary with error/warning counts', () => {
    const result = captureDiagnostics(MOCK_VERIFICATION_RESULT);
    expect(result.summary).toContain('2 errors');
    expect(result.summary).toContain('180ms');
  });

  it('respects maxDiagnostics limit', () => {
    const manyErrors = Array.from({ length: 150 }, (_, i) => ({
      targetId: 'typecheck',
      success: false,
      exitCode: 2,
      durationMs: 10,
      output: `file${i}.ts:1:1 - error TS2304: Error ${i}`,
      timedOut: false,
      cancelled: false,
    }));
    const result = captureDiagnostics({
      ...MOCK_VERIFICATION_RESULT,
      targets: manyErrors,
    });
    expect(result.diagnostics.length).toBeLessThanOrEqual(100);
  });

  it('respects maxStderrLines limit', () => {
    const manyLines = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
    const result = captureDiagnostics({
      ...MOCK_VERIFICATION_RESULT,
      targets: [
        {
          targetId: 'typecheck',
          success: false,
          exitCode: 2,
          durationMs: 10,
          output: manyLines,
          timedOut: false,
          cancelled: false,
        },
      ],
    });
    expect(result.stderr.length).toBeLessThanOrEqual(50);
  });

  it('returns empty diagnostics for successful verification', () => {
    const successResult: VerificationResult = {
      ok: true,
      targets: [
        { targetId: 'typecheck', success: true, exitCode: 0, durationMs: 10, output: '', timedOut: false, cancelled: false },
      ],
      durationMs: 10,
      cancelled: false,
    };
    const result = captureDiagnostics(successResult);
    expect(result.diagnostics).toHaveLength(0);
    expect(result.summary).toContain('passed');
  });

  it('includes verification duration in output', () => {
    const result = captureDiagnostics(MOCK_VERIFICATION_RESULT);
    expect(result.verificationDurationMs).toBe(180);
  });

  it('extracts lint errors', () => {
    const lintResult: VerificationResult = {
      ok: false,
      targets: [
        {
          targetId: 'lint',
          success: false,
          exitCode: 1,
          durationMs: 10,
          output: "src/foo.ts:1:1 error 'no-unused-vars' 'foo' is defined but never used",
          timedOut: false,
          cancelled: false,
        },
      ],
      failedTargetId: 'lint',
      durationMs: 10,
      cancelled: false,
    };
    const result = captureDiagnostics(lintResult);
    const lintDiags = result.diagnostics.filter((d) => d.category === 'LINT');
    expect(lintDiags).toHaveLength(1);
    expect(lintDiags[0]).toMatchObject({
      category: 'LINT',
      code: 'no-unused-vars',
      file: 'src/foo.ts',
    });
  });

  it('extracts generic file:line:col errors', () => {
    const genericResult: VerificationResult = {
      ok: false,
      targets: [
        {
          targetId: 'custom',
          success: false,
          exitCode: 1,
          durationMs: 10,
          output: 'src/main.ts:42:10: Something went wrong',
          timedOut: false,
          cancelled: false,
        },
      ],
      failedTargetId: 'custom',
      durationMs: 10,
      cancelled: false,
    };
    const result = captureDiagnostics(genericResult);
    expect(result.diagnostics[0]).toMatchObject({
      file: 'src/main.ts',
      line: 42,
      column: 10,
    });
  });
});

describe('captureCommandDiagnostics', () => {
  it('captures errors from command output', () => {
    const result = captureCommandDiagnostics(
      'node',
      ['script.js'],
      'stdout stuff',
      'Error: connection refused\nwarning: deprecated API',
      1,
      100,
    );
    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics[0]!.severity).toBe('error');
    expect(result.diagnostics[1]!.severity).toBe('warning');
  });

  it('handles missing stderr', () => {
    const result = captureCommandDiagnostics('node', ['script.js'], '', '', 0, 50);
    expect(result.diagnostics).toHaveLength(0);
    expect(result.stderr).toHaveLength(0);
  });

  it('includes command in summary', () => {
    const result = captureCommandDiagnostics('tsc', ['--noEmit'], '', '', 0, 123);
    expect(result.summary).toContain('tsc --noEmit');
    expect(result.summary).toContain('123ms');
  });
});

describe('Diagnostics determinism', () => {
  it('produces identical output for identical input', () => {
    const r1 = captureDiagnostics(MOCK_VERIFICATION_RESULT);
    const r2 = captureDiagnostics(MOCK_VERIFICATION_RESULT);
    expect(r1).toEqual(r2);
  });

  it('truncates long lines in stderr', () => {
    const longLine = 'x'.repeat(600);
    const result = captureDiagnostics({
      ...MOCK_VERIFICATION_RESULT,
      targets: [
        {
          targetId: 'typecheck',
          success: false,
          exitCode: 2,
          durationMs: 10,
          output: longLine,
          timedOut: false,
          cancelled: false,
        },
      ],
    });
    expect(result.stderr[0]!.length).toBeLessThanOrEqual(500);
    expect(result.stderr[0]!.endsWith('...')).toBe(true);
  });
});
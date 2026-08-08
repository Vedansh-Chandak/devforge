import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, DEFAULT_TEMPERATURE } from '../types.js';
import { validateConfig, loadConfig } from '../services/config-loader.js';
import { renderPlan, renderStatus, renderPlanResult, renderCodingReport } from '../services/output.js';
import type { ExecutionPlan } from '@devforge/planner';

describe('validateConfig', () => {
  it('returns a resolved config when input is valid', () => {
    const result = validateConfig({ provider: 'openai-compatible', model: 'gpt-4', baseUrl: 'https://api.example.com/v1' });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.config) return;
    expect(result.config.provider).toBe('openai-compatible');
    expect(result.config.temperature).toBe(DEFAULT_TEMPERATURE);
    expect(result.config.logLevel).toBe(DEFAULT_CONFIG.logLevel);
    expect(result.errors).toEqual([]);
  });

  it('returns errors for an invalid provider', () => {
    const result = validateConfig({ provider: 'nope' as never });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('returns valid with default fake provider when input is undefined', () => {
    const result = validateConfig(undefined);
    expect(result.ok).toBe(true);
    if (!result.ok || !result.config) return;
    expect(result.config.provider).toBe('fake');
  });
});

describe('loadConfig', () => {
  it('returns a config for a missing directory using defaults', async () => {
    const { config } = await loadConfig('/nonexistent/devforge-missing-dir');
    expect(config.provider).toBe('fake');
    expect(config.logLevel).toBe('info');
  });
});

describe('output', () => {
  const plan: ExecutionPlan = {
    goal: 'Fix the failing test',
    summary: 'Fix the failing test',
    complexity: 'MEDIUM' as ExecutionPlan['complexity'],
    risk: 'MODERATE' as ExecutionPlan['risk'],
    requiresConfirmation: false,
    assumptions: [],
    expectedOutputs: [],
    steps: [
      {
        id: '1',
        type: 'SEARCH' as ExecutionPlan['steps'][number]['type'],
        dependsOn: [],
        requiresConfirmation: false,
        estimatedCost: 3,
        title: 'Find failing test',
        description: 'Locate the test',
      },
    ],
  };

  it('renders a plan', () => {
    const out = renderPlan(plan, { useColor: false });
    expect(out).toContain('Plan: Fix the failing test');
    expect(out).toContain('SEARCH');
  });

  it('renders a failed plan result', () => {
    const out = renderPlanResult({ ok: false, error: { code: 'PARSE_FAILED', message: 'bad', retryable: false } });
    expect(out).toContain('Planning failed');
    expect(out).toContain('bad');
  });

  it('renders status key/value pairs', () => {
    const out = renderStatus([['git', 'clean'], ['branch', 'main']]);
    expect(out).toContain('git');
    expect(out).toContain('main');
  });

  it('renders a successful coding report', () => {
    const report = {
      outcome: 'SUCCESS' as const,
      transactions: [],
      patchesGenerated: 2,
      patchCalls: 1,
      repairAttempts: 0,
      modelCalls: 1,
      verificationRuns: 1,
      diagnostics: [],
      rollbackCount: 0,
      events: [],
      executionTimeMs: 150,
    };
    const out = renderCodingReport(report as never);
    expect(out).toContain('SUCCESS');
    expect(out).toContain('Patches generated: 2');
  });
});
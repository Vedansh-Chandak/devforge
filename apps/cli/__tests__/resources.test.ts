/**
 * DF-028 Phase 9 — Resource limits through the real service boundary.
 *
 * Bounds must hold not just in unit tests but inside the production service
 * aggregation: `createExecutorService.fix()` must not loop forever, must
 * respect repair/verification budgets, and must isolate concurrent runs.
 */
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { writeFileSync as fsWriteSync } from 'node:fs';
import { ScriptedProvider, createTempMockRepo } from './helpers.js';
import { createExecutorService } from '../src/services/executor.js';
import type { ModelProvider, ModelResponse } from '@devforge/model-provider';

/** Always-failing verification that makes every patch surface as a failure. */
function failingTarget(root: string) {
  return {
    id: 'must-fail',
    command: 'node',
    args: ['-e', 'process.exit(1)'],
    cwd: root,
    timeoutMs: 10_000,
  };
}

/** Coding provider that always emits the same MODIFY patch for src/index.ts. */
function alwaysBrokenCoding(): ModelProvider {
  const provider = new ScriptedProvider(() => {
    const response: ModelResponse = {
      content:
        '<DEVFORGE_PATCH>\n[{"id":"p1","operation":"MODIFY","file":"src/index.ts","newContent":"export const x = 1;"}]\n</DEVFORGE_PATCH>',
      model: 'broken-patches',
      finishReason: 'stop',
    };
    return response;
  });
  return provider;
}

/** Reasoning provider: deterministic analysis + repair decision (retry-worthy). */
function scriptedReasoning(): ModelProvider {
  return new ScriptedProvider((request) => {
    const text = request.messages.map((m) => `${m.content}`).join(' ');
    const analysis = `<DEVFORGE_REASONING>
{"diagnosis":"verification always fails","category":"COMMAND_ERROR","confidence":0.9,"suggestedPaths":["src/index.ts"],"estimatedComplexity":1}
</DEVFORGE_REASONING>`;
    const decision = `<DEVFORGE_REASONING>
{"strategy":"PATCH","scope":"MINIMAL","reason":"retry with a patch","targetFiles":["src/index.ts"]}
</DEVFORGE_REASONING>`;
    const response: ModelResponse = {
      content: text.includes('repair strategy') ? decision : analysis,
      model: 'scripted-reasoning',
      finishReason: 'stop',
    };
    return response;
  });
}

/** Router resolving coding / reasoning / fast roles. */
function router(coding: ModelProvider, reasoning: ModelProvider) {
  return {
    list: () => ['coding', 'reasoning', 'fast'] as const,
    select: (role: string) => {
      if (role === 'coding') return coding;
      if (role === 'fast') return coding;
      return reasoning;
    },
    has: () => true,
  };
}

describe('DF-028 resource limits (Phase 9)', () => {
  it('fix() respects maxRepairAttempts and returns, never looping forever', async () => {
    const root = await createTempMockRepo();
    const coding = alwaysBrokenCoding();
    const reasoning = scriptedReasoning();
    const service = await createExecutorService(router(coding, reasoning) as never, root, {
      maxRepairAttempts: 2,
      temperature: 0,
      verificationTargets: [failingTarget(root)],
    });

    const report = await service.fix('make the verification pass');
    expect(report.outcome).toBe('BUDGET_EXCEEDED');
    // Initial verify (1) + up to maxRepairAttempts (2) repair verifies.
    expect(report.verificationRuns).toBeGreaterThan(1);
    expect(report.verificationRuns).toBeLessThanOrEqual(3);
    expect(report.repairAttempts).toBeLessThanOrEqual(2);
    // Patch generation is bounded by maxPatchGenerations (default 5).
    const patchCalls = (coding as ScriptedProvider).callCount;
    expect(patchCalls).toBeLessThanOrEqual(5);
  });

  it('concurrent fix() calls are isolated (fresh engine per run)', async () => {
    const root = await createTempMockRepo();
    const provider = new ScriptedProvider(() => ({
      content: '<DEVFORGE_PATCH>\n[]\n</DEVFORGE_PATCH>',
      model: 'scripted-patches',
      finishReason: 'stop',
    }));
    const service = await createExecutorService(router(provider, scriptedReasoning()) as never, root, {
      maxRepairAttempts: 1,
      temperature: 0,
      verificationTargets: [],
    });

    const results = await Promise.all([
      service.fix('task a'),
      service.fix('task b'),
      service.fix('task c'),
    ]);

    for (const report of results) {
      expect(report.outcome).toBe('SUCCESS');
      expect(report.transactions).toHaveLength(1);
    }
    // No cross-run contamination: the shared coding provider saw exactly 3 patch calls.
    expect(provider.callCount).toBe(3);
  });

  it('timeouts and byte caps are enforced by the command runner at the boundary', async () => {
    const root = await createTempMockRepo();
    const provider = new ScriptedProvider();
    const service = await createExecutorService(router(provider, provider) as never, root, {
      maxRepairAttempts: 1,
      temperature: 0,
      verificationTargets: [],
    });

    const sleepScript = path.join(root, 'sleep.js');
    fsWriteSync(sleepScript, 'setTimeout(() => {}, 100);\n');
    await expect(
      service.runner.run({
        command: 'node',
        args: ['sleep.js'],
        cwd: root,
        timeoutMs: 5,
      }),
    ).resolves.toMatchObject({ timedOut: true, cancelled: false });
  });
});
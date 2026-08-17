import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Workspace } from '../../workspace/workspace.js';
import type { CommandRequest, CommandResult, CommandRunner } from '../../command/types.js';
import type { VerificationTarget } from '../../executor/types.js';
import {
  scriptedReasoningModel,
  type FailureAnalysis,
  type RepairDecision,
} from '../reasoning-model.js';
import { fixedPatchEngine, createPatchEngine, type PatchEngine } from '../patch-engine.js';
import { createCodingEngine, type CodingEngineConfig, type CodingReport } from '../repair.js';
import { hashText } from '../patch-model.js';
import { okResult, failResult, fixedClock } from './helpers.js';

let tempDir: string;
let workspace: Workspace;

beforeAll(async () => {
  tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'repair-'));
  workspace = new Workspace({ root: tempDir });
});

afterAll(async () => {
  await fs.promises.rm(tempDir, { recursive: true, force: true });
});

// ── Helpers ───────────────────────────────────────────────────────────────

function makeTargets(): VerificationTarget[] {
  return [{ id: 'typecheck', command: 'tsc', args: ['--noEmit'], cwd: tempDir }];
}

function makeRunner(results: readonly (CommandResult | ((req: CommandRequest) => CommandResult))[]) {
  const calls: CommandRequest[] = [];
  const queue = [...results];
  const runner = {
    async run(request: CommandRequest): Promise<CommandResult> {
      calls.push(request);
      const scripted = queue.shift();
      if (!scripted) {
        throw new Error(`Unexpected command call: ${request.command} ${request.args.join(' ')}`);
      }
      return typeof scripted === 'function' ? scripted(request) : scripted;
    },
  };
  return { runner, calls };
}

function patchFile(file: string, content: string, operation: 'CREATE' | 'MODIFY' | 'DELETE' = 'CREATE') {
  return { id: `patch-${file}`, file, operation, newContent: content };
}

function makeEngine(
  overrides: Partial<CodingEngineConfig> & {
    patchEngine: PatchEngine;
    results: readonly (CommandResult | ((req: CommandRequest) => CommandResult))[];
  },
): { engine: ReturnType<typeof createCodingEngine>; runner: CommandRunner; calls: CommandRequest[]; now: () => number } {
  const now = fixedClock(1000);
  const { runner, calls } = makeRunner(overrides.results);
  const { patchEngine: _patchEngine, results: _results, ...rest } = overrides;
  const engine = createCodingEngine({
    workspace,
    runner: runner as CommandRunner,
    patchEngine: overrides.patchEngine,
    verificationTargets: makeTargets(),
    cwd: tempDir,
    now,
    ...rest,
  });
  return { engine, runner, calls, now };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('AutonomousCodingEngine', () => {
  it('creates a fresh file when initial verification passes', async () => {
    const file = 'src/created.ts';
    const patches = [patchFile(file, 'export const x = 1;')];
    const engine = createCodingEngine({
      workspace,
      runner: (makeRunner([okResult()]) as any).runner,
      patchEngine: fixedPatchEngine(patches),
      verificationTargets: makeTargets(),
      cwd: tempDir,
      now: fixedClock(1000),
    });

    const report = await engine.run({ goal: 'create file' });
    expect(report.outcome).toBe('SUCCESS');
    expect(report.patchesGenerated).toBe(1);
    expect(report.verificationRuns).toBe(1);
    const content = await workspace.readFile(file);
    expect(content).toBe('export const x = 1;');
  });

  it('commits the transaction on success', async () => {
    const file = 'src/committed.ts';
    const engine = createCodingEngine({
      workspace,
      runner: (makeRunner([okResult()]) as any).runner,
      patchEngine: fixedPatchEngine([patchFile(file, 'hello')]),
      verificationTargets: makeTargets(),
      cwd: tempDir,
      now: fixedClock(1000),
    });

    const report = await engine.run({ goal: 'create file' });
    expect(report.outcome).toBe('SUCCESS');
    expect(report.transactions).toHaveLength(1);
    expect(report.transactions[0]!.status).toBe('COMMITTED');
    expect(await workspace.exists(file)).toBe(true);
  });

  it('rolls back the transaction when verification fails', async () => {
    const file = 'src/rollback.ts';
    const engine = createCodingEngine({
      workspace,
      runner: (makeRunner([failResult()]) as any).runner,
      patchEngine: fixedPatchEngine([patchFile(file, 'bad content')]),
      verificationTargets: makeTargets(),
      cwd: tempDir,
      now: fixedClock(1000),
    });

    const report = await engine.run({ goal: 'create file that fails' });
    expect(report.outcome).toBe('BUDGET_EXCEEDED');
    expect(report.rollbackCount).toBe(1);
    expect(await workspace.exists(file)).toBe(false);
  });

  it('stops when repair attempts budget is exceeded', async () => {
    const file = 'src/budget.ts';
    // Verification always fails
    const engine = createCodingEngine({
      workspace,
      runner: (makeRunner([failResult(), failResult(), failResult(), failResult()]) as any).runner,
      patchEngine: fixedPatchEngine([patchFile(file, 'content')]),
      verificationTargets: makeTargets(),
      cwd: tempDir,
      now: fixedClock(1000),
      reasoningModel: scriptedReasoningModel(
        [
          { diagnosis: 'd1', category: 'TYPE_ERROR', confidence: 0.9, suggestedPaths: [file], estimatedComplexity: 1 },
        ],
        [
          { strategy: 'PATCH', reason: 'fix it', targetFiles: [file], scope: 'MINIMAL' },
        ],
      ).model,
      budgets: { maxRepairAttempts: 1 },
    });

    const report = await engine.run({ goal: 'task' });
    expect(report.outcome).toBe('BUDGET_EXCEEDED');
    expect(report.repairAttempts).toBeLessThanOrEqual(1);
    expect(report.error).toBeInstanceOf(Error);
  });

  it('exceeds patch generation budget', async () => {
    const file = 'src/patchbudget.ts';
    // Verification always fails
    const engine = createCodingEngine({
      workspace,
      runner: (makeRunner([failResult(), failResult(), failResult(), failResult()]) as any).runner,
      patchEngine: fixedPatchEngine([patchFile(file, 'content')]),
      verificationTargets: makeTargets(),
      cwd: tempDir,
      now: fixedClock(1000),
      reasoningModel: scriptedReasoningModel(
        [
          { diagnosis: 'd1', category: 'TYPE_ERROR', confidence: 0.9, suggestedPaths: [file], estimatedComplexity: 1 },
        ],
        [
          { strategy: 'PATCH', reason: 'fix it', targetFiles: [file], scope: 'MINIMAL' },
        ],
      ).model,
      budgets: { maxPatchGenerations: 1 },
    });

    const report = await engine.run({ goal: 'task' });
    expect(report.outcome).toBe('BUDGET_EXCEEDED');
  });

  it('exceeds verification run budget', async () => {
    const file = 'src/verifybudget.ts';
    const engine = createCodingEngine({
      workspace,
      runner: (makeRunner([failResult(), failResult(), failResult()]) as any).runner,
      patchEngine: fixedPatchEngine([patchFile(file, 'content')]),
      verificationTargets: makeTargets(),
      cwd: tempDir,
      now: fixedClock(1000),
      reasoningModel: scriptedReasoningModel(
        [
          { diagnosis: 'd1', category: 'TYPE_ERROR', confidence: 0.9, suggestedPaths: [file], estimatedComplexity: 1 },
        ],
        [
          { strategy: 'PATCH', reason: 'fix it', targetFiles: [file], scope: 'MINIMAL' },
        ],
      ).model,
      budgets: { maxVerificationRuns: 2 },
    });

    const report = await engine.run({ goal: 'task' });
    expect(report.outcome).toBe('BUDGET_EXCEEDED');
  });

  it('recovers via repair loop when repair patches pass verification', async () => {
    const file = 'src/recovered.ts';
    // Initial fails, repair passes
    const engine = createCodingEngine({
      workspace,
      runner: (makeRunner([failResult(), okResult()]) as any).runner,
      patchEngine: fixedPatchEngine([patchFile(file, 'content')]),
      verificationTargets: makeTargets(),
      cwd: tempDir,
      now: fixedClock(1000),
      reasoningModel: scriptedReasoningModel(
        [
          { diagnosis: 'd1', category: 'TYPE_ERROR', confidence: 0.9, suggestedPaths: [file], estimatedComplexity: 1 },
        ],
        [
          { strategy: 'PATCH', reason: 'fix it', targetFiles: [file], scope: 'MINIMAL' },
        ],
      ).model,
    });

    const report = await engine.run({ goal: 'task' });
    expect(report.outcome).toBe('SUCCESS');
    expect(report.repairAttempts).toBe(1);
    expect(await workspace.exists(file)).toBe(true);
  });

  it('cancels the run when abort signal fires', async () => {
    const file = 'src/cancel.ts';
    const controller = new AbortController();
    const engine = createCodingEngine({
      workspace,
      runner: (makeRunner([failResult()]) as any).runner,
      patchEngine: fixedPatchEngine([patchFile(file, 'content')]),
      verificationTargets: makeTargets(),
      cwd: tempDir,
      now: fixedClock(1000),
      signal: controller.signal,
      reasoningModel: scriptedReasoningModel(
        [
          { diagnosis: 'd1', category: 'TYPE_ERROR', confidence: 0.9, suggestedPaths: [file], estimatedComplexity: 1 },
        ],
        [
          { strategy: 'PATCH', reason: 'fix it', targetFiles: [file], scope: 'MINIMAL' },
        ],
      ).model,
    });

    // Abort during repair loop
    controller.abort();
    await expect(engine.run({ goal: 'task' })).rejects.toThrow();
  });

  it('emits a deterministic event stream', async () => {
    const file = 'src/events.ts';
    const now = fixedClock(1000);
    const { runner } = makeRunner([okResult()]);
    const engine = createCodingEngine({
      workspace,
      runner: runner as never,
      patchEngine: fixedPatchEngine([patchFile(file, 'hello')]),
      verificationTargets: makeTargets(),
      cwd: tempDir,
      now,
    });

    await engine.run({ goal: 'create file' });

    const types = engine.events.map((e) => e.type);
    expect(types[0]).toBe('PatchGenerationStarted');
    expect(types[1]).toBe('PatchGenerated');
    expect(types).toContain('WorkspaceTransactionStarted');
    expect(types).toContain('WorkspaceTransactionCommitted');
    expect(types).toContain('CodingVerificationStarted');
    expect(types).toContain('CodingVerificationPassed');
  });

  it('produces deterministic reports for same input', async () => {
    const fileA = 'src/det-a.ts';
    const fileB = 'src/det-b.ts';
    const nowA = fixedClock(1000);
    const nowB = fixedClock(1000);
    const { runner: runnerA } = makeRunner([okResult()]);
    const { runner: runnerB } = makeRunner([okResult()]);
    const engineA = createCodingEngine({
      workspace,
      runner: runnerA as never,
      patchEngine: fixedPatchEngine([patchFile(fileA, 'hello')]),
      verificationTargets: makeTargets(),
      cwd: tempDir,
      now: nowA,
    });
    const engineB = createCodingEngine({
      workspace,
      runner: runnerB as never,
      patchEngine: fixedPatchEngine([patchFile(fileB, 'hello')]),
      verificationTargets: makeTargets(),
      cwd: tempDir,
      now: nowB,
    });

    const reportA = await engineA.run({ goal: 'create file' });
    const reportB = await engineB.run({ goal: 'create file' });

    // Both should have identical metrics
    expect(reportA.outcome).toBe(reportB.outcome);
    expect(reportA.patchesGenerated).toBe(reportB.patchesGenerated);
    expect(reportA.verificationRuns).toBe(reportB.verificationRuns);
    expect(reportA.rollbackCount).toBe(reportB.rollbackCount);
  });

  it('supports concurrent engines without interference', async () => {
    const fileA = 'src/concurrent-a.ts';
    const fileB = 'src/concurrent-b.ts';
    const nowA = fixedClock(1000);
    const nowB = fixedClock(1000);
    const { runner: runnerA } = makeRunner([okResult()]);
    const { runner: runnerB } = makeRunner([okResult()]);
    const engineA = createCodingEngine({
      workspace,
      runner: runnerA as never,
      patchEngine: fixedPatchEngine([patchFile(fileA, 'aaa')]),
      verificationTargets: makeTargets(),
      cwd: tempDir,
      now: nowA,
    });
    const engineB = createCodingEngine({
      workspace,
      runner: runnerB as never,
      patchEngine: fixedPatchEngine([patchFile(fileB, 'bbb')]),
      verificationTargets: makeTargets(),
      cwd: tempDir,
      now: nowB,
    });

    const [reportA, reportB] = await Promise.all([
      engineA.run({ goal: 'a' }),
      engineB.run({ goal: 'b' }),
    ]);

    expect(reportA.outcome).toBe('SUCCESS');
    expect(reportB.outcome).toBe('SUCCESS');
    expect(await workspace.exists(fileA)).toBe(true);
    expect(await workspace.exists(fileB)).toBe(true);
  });

  it('handles DELETE patches', async () => {
    const file = 'src/to-delete.ts';
    await workspace.writeFile(file, 'export const x = 1;');
    const engine = createCodingEngine({
      workspace,
      runner: (makeRunner([okResult()]) as any).runner,
      patchEngine: fixedPatchEngine([{ id: 'del', file, operation: 'DELETE' }]),
      verificationTargets: makeTargets(),
      cwd: tempDir,
      now: fixedClock(1000),
    });

    const report = await engine.run({ goal: 'delete file' });
    expect(report.outcome).toBe('SUCCESS');
    expect(await workspace.exists(file)).toBe(false);
  });

  it('handles MODIFY patches with hash validation', async () => {
    const file = 'src/to-modify.ts';
    await workspace.writeFile(file, 'old content');
    const expectedHash = hashText('old content');
    const engine = createCodingEngine({
      workspace,
      runner: (makeRunner([okResult()]) as any).runner,
      patchEngine: fixedPatchEngine([
        { id: 'mod', file, operation: 'MODIFY', newContent: 'new content', expectedHash },
      ]),
      verificationTargets: makeTargets(),
      cwd: tempDir,
      now: fixedClock(1000),
    });

    const report = await engine.run({ goal: 'modify file' });
    expect(report.outcome).toBe('SUCCESS');
    expect(await workspace.readFile(file)).toBe('new content');
  });

  it('fails validation when hash mismatches', async () => {
    const file = 'src/hash-mismatch.ts';
    await workspace.writeFile(file, 'actual content');
    const engine = createCodingEngine({
      workspace,
      runner: (makeRunner([okResult()]) as any).runner,
      patchEngine: fixedPatchEngine([
        { id: 'mod', file, operation: 'MODIFY', newContent: 'new', expectedHash: 'wrong-hash' },
      ]),
      verificationTargets: makeTargets(),
      cwd: tempDir,
      now: fixedClock(1000),
    });

    await expect(engine.run({ goal: 'modify' })).rejects.toThrow();
  });

  it('rejects CREATE on existing file', async () => {
    const file = 'src/exists.ts';
    await workspace.writeFile(file, 'existing');
    const engine = createCodingEngine({
      workspace,
      runner: (makeRunner([okResult()]) as any).runner,
      patchEngine: fixedPatchEngine([{ id: 'create', file, operation: 'CREATE', newContent: 'new' }]),
      verificationTargets: makeTargets(),
      cwd: tempDir,
      now: fixedClock(1000),
    });

    await expect(engine.run({ goal: 'create existing' })).rejects.toThrow();
  });
});
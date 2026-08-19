/**
 * DF-028 Autonomous E2E — Phase 4.
 *
 * Proves the complete autonomous execution path deterministically: a really
 * executing verification command (node) over a real temp repo drives the
 * coding engine's patch → apply → verify → repair loop. No net, no LLM.
 *
 *   · Success path — initial patch generated correctly, one committed
 *     transaction, no rollback, SUCCESS report.
 *   · Repair path — initial patch wrong, verification fails, transaction is
 *     rolled back, scripted reasoning drives analysis + repair decision, the
 *     repair patch passes verification, report SUCCESS with repairAttempts=1.
 *   · Budget path — consecutive broken patches exhaust maxPatchGenerations,
 *     no file survives, BUDGET_EXCEEDED report, rollback recorded.
 *   · Single-use enforcement — a second run() on the same engine rejects.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  Workspace,
  createCommandRunner,
  createCodingEngine,
  type CodePatch,
  type CommandResult,
  type CommandRunner,
  type PatchEngine,
  type PatchGenerationRequest,
  type VerificationTarget,
} from '@devforge/execution';
import {
  fixedReasoningModel,
  type FailureAnalysis,
  type RepairDecision,
} from '@devforge/execution';

// ---------------------------------------------------------------------------
// Deterministic helpers
// ---------------------------------------------------------------------------

const FEATURE_FILE = 'src/feature.js';
const CORRECT = 'export const f = 42;\n';
const VERIFY_SCRIPT = 'verify.js';
// Verification helper shipped inside the temp repo. Exits 0 iff the feature
// module exists and exports f === 42.
const VERIFY_SCRIPT_BODY = `const path = require('path');
try {
  const m = require(path.join(__dirname, 'src', 'feature.js'));
  process.exit(typeof m.f === 'number' && m.f === 42 ? 0 : 2);
} catch (e) {
  console.error(String(e && e.message ? e.message : e));
  process.exit(1);
}
`;

function createPatch(file: string, content: string): CodePatch {
  return { id: `p-${file}`, file, operation: 'CREATE' as const, newContent: content };
}

function okResult(command: string): CommandResult {
  return {
    success: true,
    stdout: '',
    stderr: '',
    exitCode: 0,
    durationMs: 1,
    timedOut: false,
    cancelled: false,
    truncated: false,
    command: command as CommandResult['command'],
    args: [],
  };
}

function constantRunner(result: CommandResult): CommandRunner {
  return { run: async () => result };
}

function sequencePatchEngine(sets: readonly (readonly CodePatch[])[]): PatchEngine {
  let calls = 0;
  return {
    name: 'sequence',
    async generate(_request: PatchGenerationRequest): Promise<readonly CodePatch[]> {
      const index = Math.min(calls, sets.length - 1);
      const set = (sets[index] ?? (sets[sets.length - 1] ?? [])) as readonly CodePatch[];
      calls += 1;
      return set.map((patch) => ({ ...patch }));
    },
  };
}

function tempWorkspace(files: Readonly<Record<string, string>> = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'df028-auto-'));
  for (const [file, content] of Object.entries(files)) {
    const absolute = path.join(root, file);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content, 'utf-8');
  }
  fs.writeFileSync(path.join(root, VERIFY_SCRIPT), VERIFY_SCRIPT_BODY, 'utf-8');
  return root;
}

function readFeature(root: string): string | null {
  const p = path.join(root, FEATURE_FILE);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : null;
}

const FIXED_ANALYSIS: FailureAnalysis = {
  diagnosis: 'feature.js missing or wrong value',
  category: 'COMMAND_ERROR',
  confidence: 0.9,
  suggestedPaths: [FEATURE_FILE],
  estimatedComplexity: 1,
};

const MODIFY_DECISION: RepairDecision = {
  strategy: 'REWRITE' as const,
  scope: 'BROAD' as const,
  reason: 'rewrite feature.js to export f = 42',
  targetFiles: [FEATURE_FILE],
};

// ---------------------------------------------------------------------------
// E2E scenarios
// ---------------------------------------------------------------------------

describe('DF-028 autonomous E2E (Phase 4)', () => {
  it('success path: a correct initial patch is committed with no rollback', async () => {
    const root = tempWorkspace({});
    const runner = createCommandRunner({ workspaceRoot: root } as never);
    const workspace = new Workspace({ root } as never);
    const verifyTarget: VerificationTarget = {
      id: 'feature-check',
      command: 'node',
      args: [VERIFY_SCRIPT],
      cwd: root,
      timeoutMs: 10_000,
    };
    const engine = createCodingEngine({
      workspace,
      runner,
      patchEngine: sequencePatchEngine([[createPatch(FEATURE_FILE, CORRECT)]]),
      codingModel: undefined,
      reasoningModel: fixedReasoningModel(FIXED_ANALYSIS, MODIFY_DECISION),
      verificationTargets: [verifyTarget],
      cwd: root,
      budgets: { maxPatchGenerations: 3, maxVerificationRuns: 3 },
    });

    const report = await engine.run({ goal: 'Add a feature that returns 42' });

    expect(report.outcome).toBe('SUCCESS');
    expect(readFeature(root)).toBe(CORRECT);
    expect(report.repairAttempts).toBe(0);
    expect(report.verificationRuns).toBe(1);
    expect(report.rollbackCount).toBe(0);
    expect(report.transactions).toHaveLength(1);
    expect(report.transactions[0]!.status).toBe('COMMITTED');
    expect(report.transactions[0]!.kind).toBe('initial');
  });

  it('repair path: a wrong patch is rolled back, analysis + repair patch land SUCCESS', async () => {
    const root = tempWorkspace({});
    const runner = createCommandRunner({ workspaceRoot: root } as never);
    const workspace = new Workspace({ root } as never);
    const verifyTarget: VerificationTarget = {
      id: 'feature-check',
      command: 'node',
      args: [VERIFY_SCRIPT],
      cwd: root,
      timeoutMs: 10_000,
    };
    const engine = createCodingEngine({
      workspace,
      runner,
      patchEngine: sequencePatchEngine([
        [createPatch(FEATURE_FILE, 'export const f = 0;\n')],
        [createPatch(FEATURE_FILE, CORRECT)],
      ]),
      codingModel: undefined,
      reasoningModel: fixedReasoningModel(FIXED_ANALYSIS, MODIFY_DECISION),
      verificationTargets: [verifyTarget],
      cwd: root,
      budgets: { maxRepairAttempts: 2, maxPatchGenerations: 3, maxVerificationRuns: 3 },
    });

    const report = await engine.run({ goal: 'Add a feature that returns 42' });

    expect(report.outcome).toBe('SUCCESS');
    expect(readFeature(root)).toBe(CORRECT);
    expect(report.repairAttempts).toBe(1);
    expect(report.verificationRuns).toBe(2);
    expect(report.rollbackCount).toBe(1);
    expect(report.transactions).toHaveLength(2);
    expect(report.transactions[0]!.status).toBe('ROLLED_BACK');
    expect(report.transactions[0]!.kind).toBe('initial');
    expect(report.transactions[1]!.status).toBe('COMMITTED');
    expect(report.transactions[1]!.kind).toBe('repair');
    // Rollback must be real: the wrong content never survives on disk.
    expect(readFeature(root)).toBe(CORRECT);
  });

  it('budget path: repeated broken patches roll back and report BUDGET_EXCEEDED', async () => {
    const root = tempWorkspace({});
    const runner = createCommandRunner({ workspaceRoot: root } as never);
    const workspace = new Workspace({ root } as never);
    const verifyTarget: VerificationTarget = {
      id: 'feature-check',
      command: 'node',
      args: [VERIFY_SCRIPT],
      cwd: root,
      timeoutMs: 10_000,
    };
    const engine = createCodingEngine({
      workspace,
      runner,
      patchEngine: sequencePatchEngine([
        [createPatch(FEATURE_FILE, 'export const f = 0;\n')],
        [createPatch(FEATURE_FILE, 'export const f = 1;\n')],
      ]),
      codingModel: undefined,
      reasoningModel: fixedReasoningModel(FIXED_ANALYSIS, MODIFY_DECISION),
      verificationTargets: [verifyTarget],
      cwd: root,
      budgets: { maxRepairAttempts: 1, maxPatchGenerations: 2, maxVerificationRuns: 3 },
    });

    const report = await engine.run({ goal: 'Add a feature that returns 42' });

    expect(report.outcome).toBe('BUDGET_EXCEEDED');
    expect(report.error?.message).toMatch(/budget|exhausted/i);
    expect(readFeature(root)).toBeNull();
    expect(report.rollbackCount).toBeGreaterThan(0);
    expect(report.transactions.every((t) => t.status === 'ROLLED_BACK')).toBe(true);
  });

  it('single-use: a second run() on the same engine is rejected', async () => {
    const root = tempWorkspace({});
    const engine = createCodingEngine({
      workspace: new Workspace({ root } as never),
      runner: constantRunner(okResult('sign')),
      patchEngine: sequencePatchEngine([[createPatch(FEATURE_FILE, CORRECT)]]),
      codingModel: undefined,
      verificationTargets: [],
      cwd: root,
    });

    const first = await engine.run({ goal: 'one' });
    expect(first.outcome).toBe('SUCCESS');

    await expect(engine.run({ goal: 'two' })).rejects.toThrow(
      /already finished|create a new instance/,
    );
  });
});
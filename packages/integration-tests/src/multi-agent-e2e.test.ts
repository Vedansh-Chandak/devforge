/**
 * DF-028 Multi-agent E2E — Phase 5.
 *
 * Drives the real multi-agent pipeline end-to-end and deterministically:
 * a Coordinator with scripted role backends runs against a real temp repo and
 * the real executor verification pipeline (`ExecutorVerifier` + real node
 * command). Proves the swarm boundary: verification failure triggers a REPAIR
 * round whose backend edits real files and passes.
 *
 *   · Success path — CODER writes a correct file, real verification passes
 *     on round one, no repair request.
 *   · Repair path — CODER writes a broken file, verification fails, a REPAIR
 *     task rewrites it correctly, final outcome SUCCESS.
 *   · Failure path — CODER and REPAIR both write broken files; the repair
 *     round resolves nothing and the run reports FAILED.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  Coordinator,
  AgentPool,
  ExecutorVerifier,
  type AgentBackend,
  type AgentContext,
  type AgentOutput,
  okOutput,
  outputToResult,
} from '@devforge/multi-agent';
import {
  createCommandRunner,
  type VerificationTarget,
} from '@devforge/execution';
import type { AgentRole, RoleAgent, Task } from '@devforge/multi-agent';

// ---------------------------------------------------------------------------
// Deterministic helpers
// ---------------------------------------------------------------------------

const FEATURE_FILE = 'src/feature.js';
const WRONG = 'export const f = 0;\n';
const CORRECT = 'export const f = 42;\n';
const VERIFY_SCRIPT = 'verify.js';
const VERIFY_SCRIPT_BODY = `const path = require('path');
try {
  const m = require(path.join(__dirname, 'src', 'feature.js'));
  process.exit(typeof m.f === 'number' && m.f === 42 ? 0 : 2);
} catch (e) {
  console.error(String(e && e.message ? e.message : e));
  process.exit(1);
}
`;

function tempRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'df028-ma-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, VERIFY_SCRIPT), VERIFY_SCRIPT_BODY, 'utf-8');
  return root;
}

function verifyTarget(root: string): VerificationTarget {
  return {
    id: 'feature-check',
    command: 'node',
    args: [VERIFY_SCRIPT],
    cwd: root,
    timeoutMs: 10_000,
  };
}

function task(): Task {
  return {
    id: 't1',
    title: 'Add feature',
    description: 'Make feature.js export f = 42',
    kind: 'IMPLEMENT',
    role: 'CODER',
    dependsOn: [],
    requiresConfirmation: false,
    timeoutMs: 60_000,
    maxRetries: 1,
  };
}

/** Backend that writes a real file relative to a temp root. */
function fileWriter(root: string, relPath: string, content: string): AgentBackend {
  return async (): Promise<AgentOutput> => {
    const target = path.join(root, relPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf-8');
    return okOutput([{ id: 'a1', path: relPath, kind: 'FILE', content }]);
  };
}

/** Backend that succeeds without side effects. */
function noop(): AgentBackend {
  return async (): Promise<AgentOutput> => okOutput();
}

/** Wrap a backend into a RoleAgent using the canonical output->result mapping. */
function roleAgent(role: AgentRole, backend: AgentBackend): RoleAgent {
  return {
    role,
    run: async (task: Task, ctx: AgentContext) =>
      outputToResult(task, await backend(task, ctx), ctx, 1),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// E2E scenarios
// ═══════════════════════════════════════════════════════════════════════════

describe('DF-028 multi-agent E2E (Phase 5)', () => {
  it('success path: CODER writes the file, real verification passes round one', async () => {
    const root = tempRepo();
    const pool = new AgentPool();
    pool.register(roleAgent('CODER', fileWriter(root, FEATURE_FILE, CORRECT)));
    for (const agent of ['PLANNER', 'REVIEWER', 'TESTER', 'REPAIR', 'DOCUMENTATION'] as const) {
      pool.register(roleAgent(agent, noop()));
    }
    const coordinator = new Coordinator({ maxRepairRounds: 1 }, { pool });
    const runner = createCommandRunner({ workspaceRoot: root } as never);
    const verifier = new ExecutorVerifier(runner, [verifyTarget(root)]);

    const result = await coordinator.run('Add a feature that returns 42', {
      goal: 'Add a feature that returns 42',
      tasks: [task()],
      verifier,
    });

    expect(result.ok).toBe(true);
    expect(result.report.outcome).toBe('SUCCESS');
    expect(result.report.repair.repairRequests).toBe(0);
    expect(fs.readFileSync(path.join(root, FEATURE_FILE), 'utf-8')).toBe(CORRECT);
    // Verification actually executed node in the real repo.
    const verification = result.report.verification;
    expect(verification).not.toBeNull();
    expect(verification?.targets).toContain('feature-check');
    expect(verification?.ok).toBe(true);
  });

  it('repair path: failing verification triggers a REPAIR task that fixes the file', async () => {
    const root = tempRepo();
    const pool = new AgentPool();
    pool.register(roleAgent('CODER', fileWriter(root, FEATURE_FILE, WRONG)));
    pool.register(roleAgent('REPAIR', fileWriter(root, FEATURE_FILE, CORRECT)));
    for (const agent of ['PLANNER', 'REVIEWER', 'TESTER', 'DOCUMENTATION'] as const) {
      pool.register(roleAgent(agent, noop()));
    }
    const coordinator = new Coordinator({ maxRepairRounds: 2 }, { pool });
    const runner = createCommandRunner({ workspaceRoot: root } as never);
    const verifier = new ExecutorVerifier(runner, [verifyTarget(root)]);

    const result = await coordinator.run('Add a feature that returns 42', {
      goal: 'Add a feature that returns 42',
      tasks: [task()],
      verifier,
    });

    expect(result.ok).toBe(true);
    expect(result.report.repair.repairRequests).toBe(1);
    expect(result.report.repair.repairTaskIds).toEqual(['repair-1']);
    expect(fs.readFileSync(path.join(root, FEATURE_FILE), 'utf-8')).toBe(CORRECT);
  });

  it('failure path: verification keeps failing so maxRepairRounds is exhausted', async () => {
    const root = tempRepo();
    const pool = new AgentPool();
    pool.register(roleAgent('CODER', fileWriter(root, FEATURE_FILE, WRONG)));
    pool.register(roleAgent('REPAIR', fileWriter(root, FEATURE_FILE, WRONG)));
    for (const agent of ['PLANNER', 'REVIEWER', 'TESTER', 'DOCUMENTATION'] as const) {
      pool.register(roleAgent(agent, noop()));
    }
    const coordinator = new Coordinator({ maxRepairRounds: 1 }, { pool });
    const runner = createCommandRunner({ workspaceRoot: root } as never);
    const verifier = new ExecutorVerifier(runner, [verifyTarget(root)]);

    const result = await coordinator.run('Add a feature that returns 42', {
      goal: 'Add a feature that returns 42',
      tasks: [task()],
      verifier,
    });

    expect(result.ok).toBe(false);
    expect(result.report.outcome).toBe('FAILED');
    expect(result.report.repair.repairRequests).toBe(1);
    expect(result.report.verification).not.toBeNull();
    // Repair ran but the broken file still fails real verification.
    expect(result.report.verification?.ok).toBe(false);
  });
});
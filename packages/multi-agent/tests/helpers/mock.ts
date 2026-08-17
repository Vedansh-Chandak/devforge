/**
 * Deterministic test helpers for @devforge/multi-agent.
 *
 * Provides a manual clock (time source + controllable sleep), task factory,
 * context factory and scripted role agents so every test runs without the
 * network or wall-clock timing.
 */

import type { CommandRunner, CommandResult } from '@devforge/execution';
import type { AgentContext } from '../../src/context.js';
import { createContext } from '../../src/context.js';
import { Conversation } from '../../src/conversation.js';
import type { AgentBackend, AgentOutput, RoleAgent } from '../../src/roles/agent.js';
import { okOutput, failOutput } from '../../src/roles/agent.js';
import type { AgentRole, Artifact, Task } from '../../src/types.js';

/** A deterministic clock: `now()` reads a counter, `sleep` advances it. */
export class ManualClock {
  private value = 0;

  now = (): number => this.value;

  advance(ms: number): number {
    this.value += ms;
    return this.value;
  }

  /** Instant sleep that still advances the clock. */
  sleep = async (ms: number): Promise<void> => {
    this.advance(ms);
  };
}

export interface TaskOverrides {
  id?: string;
  title?: string;
  kind?: Task['kind'];
  role?: AgentRole;
  dependsOn?: readonly string[];
  target?: string;
  requiresConfirmation?: boolean;
  timeoutMs?: number;
  maxRetries?: number;
  description?: string;
}

/** Build a task with deterministic defaults. */
export function makeTask(overrides: TaskOverrides = {}): Task {
  const kind = overrides.kind ?? 'IMPLEMENT';
  return {
    id: overrides.id ?? 'task-1',
    title: overrides.title ?? 'Do the thing',
    description: overrides.description ?? 'A deterministic task',
    kind,
    role: overrides.role ?? roleFor(kind),
    dependsOn: overrides.dependsOn ?? [],
    target: overrides.target,
    requiresConfirmation: overrides.requiresConfirmation ?? false,
    timeoutMs: overrides.timeoutMs ?? 1000,
    maxRetries: overrides.maxRetries ?? 1,
  };
}

/** Map a kind to its canonical role. */
export function roleFor(kind: Task['kind']): AgentRole {
  switch (kind) {
    case 'PLAN':
      return 'PLANNER';
    case 'IMPLEMENT':
      return 'CODER';
    case 'TEST':
      return 'TESTER';
    case 'REVIEW':
      return 'REVIEWER';
    case 'REPAIR':
      return 'REPAIR';
    case 'DOCUMENT':
      return 'DOCUMENTATION';
  }
}

/** Build a run context wired to a conversation + clock. */
export function makeContext(runId = 'run-test', clock: ManualClock = new ManualClock()): AgentContext {
  const conversation = new Conversation(runId);
  return createContext({
    runId,
    workspaceRoot: '/ws',
    conversation,
    now: clock.now,
    signal: new AbortController().signal,
  });
}

/** Never-resolving promise — used to force scheduler timeouts. */
export function neverResolves<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

const okArtifact = (taskId: string, kind: Artifact['kind'], path: string, content: string): Artifact => ({
  path,
  kind,
  content,
  id: `${taskId}:${kind.toLowerCase()}`,
});

/** Build a role agent with a fixed role and an arbitrary backend. */
export function roleAgent(role: AgentRole, backend: AgentBackend): RoleAgent {
  return {
    role,
    async run(task: Task, ctx: AgentContext) {
      const output: AgentOutput = await backend(task, ctx);
      return {
        taskId: task.id,
        role: task.role,
        kind: task.kind,
        ok: output.ok,
        status: output.ok ? 'SUCCEEDED' : 'FAILED',
        artifacts: output.artifacts,
        messages: output.messages,
        attempts: 1,
        durationMs: 0,
        error: output.error ?? null,
      };
    },
  };
}

/** Scripted roles producing fixed outcomes. */
export const scripted = {
  succeed(role: AgentRole = 'CODER', paths: string[] = []): RoleAgent {
    return roleAgent(role, (task) =>
      okOutput(
        paths.map((path, i) => okArtifact(task.id, 'FILE', path, '// ok')),
        ['completed'],
      ),
    );
  },
  fail(
    role: AgentRole = 'CODER',
    code = 'MA_SCRIPTED',
    message = 'scripted failure',
    retryable = false,
  ): RoleAgent {
    return roleAgent(role, () => failOutput(code, message, retryable));
  },
  flaky(role: AgentRole = 'CODER', times = 1): RoleAgent {
    let calls = 0;
    return roleAgent(role, () => {
      calls += 1;
      if (calls <= times) {
        return failOutput('MA_FLAKY', `flaky failure ${calls}`, true);
      }
      return okOutput();
    });
  },
  custom(role: AgentRole, backend: AgentBackend): RoleAgent {
    return roleAgent(role, backend);
  },
};

/** A fake command runner for verification tests. */
export function fakeCommandRunner(results: readonly CommandResult[]): CommandRunner {
  let calls = 0;
  return {
    async run() {
      const result = results[Math.min(calls, results.length - 1)];
      calls += 1;
      return result;
    },
  };
}

/** Build a failing CommandResult. */
export function failedCommand(exitCode = 1, output = 'boom'): CommandResult {
  return {
    success: false,
    exitCode,
    stdout: '',
    stderr: output,
    timedOut: false,
    cancelled: false,
    durationMs: 0,
  };
}

/** Build a passing CommandResult. */
export function passedCommand(): CommandResult {
  return {
    success: true,
    exitCode: 0,
    stdout: 'ok',
    stderr: '',
    timedOut: false,
    cancelled: false,
    durationMs: 0,
  };
}
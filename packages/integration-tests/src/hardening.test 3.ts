/**
 * DF-025 Hardening Integration Suite (Phases 9-11).
 *
 * Cross-package guarantees that individual unit suites cannot assert alone:
 *
 *   P10 — Failure Matrix: every public error class from every package flows
 *         through the @devforge/errors envelope with the expected code,
 *         category, component and retryable flags. Guards against new error
 *         subclasses being added without correct envelope classification.
 *
 *   P9  — Cancellation propagation: an AbortSignal aborts the model-provider,
 *         planner, brain and the full autonomous agent without hanging, and
 *         surfaces deterministic CANCELLED outcomes across package boundaries.
 *
 *   P11 — Deterministic agentic smoke: the default (model-free) planner feeds
 *         a patch engine, verification loop and an autonomous agent end-to-end
 *         in a throwaway temp directory — no network, no real LLM.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { toEnvelope } from '@devforge/errors';
import {
  FakeModelProvider,
  ModelProviderError,
  type ModelMessage,
} from '@devforge/model-provider';
import { Planner } from '@devforge/planner';
import { DevForgeBrain } from '@devforge/brain';
import type { RuntimeInterface } from '@devforge/brain';
import {
  AutonomousAgent,
  AutonomousCancellationError,
  AutonomousTimeoutError,
} from '@devforge/autonomous';
import { MultiAgentCancellationError } from '@devforge/multi-agent';
import {
  ExecutorCancellationError,
  type CommandResult,
  type CommandRunner,
  type CodePatch,
  type PatchEngine,
  type PatchGenerationRequest,
} from '@devforge/execution';

// ---------------------------------------------------------------------------
// Deterministic helpers (mirror the autonomous package test helpers so the
// agentic smoke test needs no net, no LLM, and no fixtures).
// ---------------------------------------------------------------------------

function createPatch(file: string, content: string): CodePatch {
  return { id: `p-${file}`, file, operation: 'CREATE', newContent: content };
}

function okResult(): CommandResult {
  return {
    success: true,
    stdout: '',
    stderr: '',
    exitCode: 0,
    durationMs: 1,
    timedOut: false,
    cancelled: false,
    truncated: false,
    command: 'tsc',
    args: ['--noEmit'],
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
      const set = sets[Math.max(0, index)] as readonly CodePatch[];
      calls += 1;
      return set.map((patch) => ({ ...patch }));
    },
  };
}

function tempWorkspace(files: Readonly<Record<string, string>> = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'df-hardening-'));
  for (const [file, content] of Object.entries(files)) {
    const absolute = path.join(root, file);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content, 'utf-8');
  }
  return root;
}

function createMockRuntime(): RuntimeInterface {
  return {
    async initialize() {},
    async dispose() {},
    async execute() {
      return { success: true, context: { metadata: {}, workspaceRoot: '/test' }, duration: 10 };
    },
  };
}

function user(content: string): ModelMessage {
  return { role: 'user', content };
}

// ---------------------------------------------------------------------------
// P10 — Failure Matrix
// ---------------------------------------------------------------------------

describe('DF-025 hardening: failure matrix (P10)', () => {
  it('maps a retryable RATE_LIMITED provider error to SYSTEM/retryable', async () => {
    const provider = new FakeModelProvider({
      error: { message: '429 rate limited', code: 'RATE_LIMITED', retryable: true },
    });
    const error = await provider
      .generate({ model: 'm', messages: [user('x')] })
      .catch((e: unknown) => e);
    const envelope = toEnvelope(error);
    expect(envelope).toMatchObject({
      code: 'RATE_LIMITED',
      category: 'SYSTEM',
      component: 'model-provider',
      retryable: true,
    });
  });

  it('classifies a provider TIMEOUT as TIMEOUT while honoring the explicit retryable flag', async () => {
    const provider = new FakeModelProvider({
      error: { message: 'request timed out', code: 'TIMEOUT', retryable: true },
    });
    const error = await provider
      .generate({ model: 'm', messages: [user('x')] })
      .catch((e: unknown) => e);
    const envelope = toEnvelope(error);
    expect(envelope.category).toBe('TIMEOUT');
    // The provider marks timeouts as retryable upstream, so the envelope keeps
    // the explicit flag rather than overwriting it with the heuristic.
    expect(envelope.retryable).toBe(true);
    expect(envelope.component).toBe('model-provider');
  });

  it('classifies a provider CANCELLED as CANCELLATION and non-retryable', () => {
    const error = new ModelProviderError('cancelled', {
      provider: 'fake-provider',
      code: 'CANCELLED',
      retryable: false,
    });
    const envelope = toEnvelope(error);
    expect(envelope.category).toBe('CANCELLATION');
    expect(envelope.retryable).toBe(false);
  });

  it('classifies a provider INVALID_REQUEST as a USER error', async () => {
    const provider = new FakeModelProvider({
      error: { message: 'malformed request body', code: 'INVALID_REQUEST' },
    });
    const error = await provider
      .generate({ model: 'm', messages: [user('x')] })
      .catch((e: unknown) => e);
    expect(toEnvelope(error).category).toBe('USER');
  });

  it('classifies ExecutorCancellationError as CANCELLATION', () => {
    const envelope = toEnvelope(new ExecutorCancellationError('user stopped the run'));
    expect(envelope.category).toBe('CANCELLATION');
    expect(envelope.code).toBe('CANCELLED');
    expect(envelope.retryable).toBe(false);
    expect(envelope.component).toBe('execution');
  });

  it('classifies AutonomousCancellationError by class name even without a code', () => {
    const error = new AutonomousCancellationError('cancelled by caller');
    // Simulate legacy errors that predate structured `.code` properties.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (error as { code?: unknown }).code;
    const envelope = toEnvelope(error);
    expect(envelope.category).toBe('CANCELLATION');
    expect(envelope.retryable).toBe(false);
    expect(envelope.component).toBe('autonomous');
  });

  it('classifies AutonomousTimeoutError as TIMEOUT by class name', () => {
    const error = new AutonomousTimeoutError('exceeded wall-clock budget');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (error as { code?: unknown }).code;
    const envelope = toEnvelope(error);
    expect(envelope.category).toBe('TIMEOUT');
    expect(envelope.retryable).toBe(false);
    expect(envelope.component).toBe('autonomous');
  });

  it('maps a MultiAgentCancellationError to MA_CANCELLED/CANCELLATION', () => {
    const envelope = toEnvelope(new MultiAgentCancellationError('swarm aborted'));
    expect(envelope.code).toBe('MA_CANCELLED');
    expect(envelope.category).toBe('CANCELLATION');
    expect(envelope.component).toBe('multi-agent');
  });

  it('never leaks secret-shaped material into the envelope message', () => {
    const secret =
      'API_KEY=sk-0123456789abcdef and token Bearer eyJhbGciOiJIUzI1NiJ9.secret';
    const envelope = toEnvelope(new Error(`upstream failed with ${secret}`));
    expect(envelope.message).not.toContain('sk-0123456789abcdef');
    expect(envelope.message).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(envelope.message).toContain('[REDACTED]');
  });
});

// ---------------------------------------------------------------------------
// P9 — Cancellation propagation across package boundaries
// ---------------------------------------------------------------------------

describe('DF-025 hardening: cancellation propagation (P9)', () => {
  it('a FakeModelProvider honors a pre-aborted signal with CANCELLED', async () => {
    const provider = new FakeModelProvider({ delay: 50 });
    const controller = new AbortController();
    controller.abort();
    const error = await provider
      .generate({ model: 'm', messages: [user('x')], signal: controller.signal })
      .catch((e: unknown) => e);
    const envelope = toEnvelope(error);
    expect(envelope.category).toBe('CANCELLATION');
    expect(envelope.code).toBe('CANCELLED');
  });

  it('a FakeModelProvider aborts mid-flight when the signal fires', async () => {
    const provider = new FakeModelProvider({ delay: 2_000 });
    const controller = new AbortController();
    const pending = provider.generate({
      model: 'm',
      messages: [user('x')],
      signal: controller.signal,
    });
    controller.abort();
    const error = await pending.catch((e: unknown) => e);
    expect(toEnvelope(error).category).toBe('CANCELLATION');
  });

  it('Planner.plan returns a CANCELLED result when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const planner = new Planner({ generate: async () => dangling() });
    const result = await planner.plan('Refactor the module', { signal: controller.signal });
    if (result.ok) {
      throw new Error('expected a CANCELLED plan result');
    }
    expect(result.error.code).toBe('CANCELLED');
    expect(result.error.retryable).toBe(false);
  });

  it('Planner.plan aborts a hung model call via the signal', async () => {
    const controller = new AbortController();
    const planner = new Planner({
      generate: async () =>
        new Promise((_resolve, reject) => {
          controller.signal.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        }),
    });
    const promise = planner.plan('Refactor the module', { signal: controller.signal });
    controller.abort();
    const result = await promise;
    if (result.ok) {
      throw new Error('expected a CANCELLED plan result');
    }
    expect(result.error.code).toBe('CANCELLED');
  });

  it('Brain.ask surfaces a CANCELLED provider error as provider_error', async () => {
    const controller = new AbortController();
    const brain = new DevForgeBrain({
      runtime: createMockRuntime(),
      provider: new FakeModelProvider({ delay: 2_000 }),
    });
    // "what does the module do" classifies as ExplainCode so the provider is
    // actually called (an Unknown intent short-circuits before the provider).
    const pending = brain.ask('what does the module do', { signal: controller.signal });
    controller.abort();
    const result = await pending;
    expect(result.status).toBe('provider_error');
    if (result.status !== 'provider_error') return;
    expect(result.errorCode).toBe('CANCELLED');
    expect(result.retryable).toBe(false);
  });

  it('AutonomousAgent cancels with outcome CANCELLED when its signal aborts', async () => {
    const root = tempWorkspace({ 'src/index.ts': 'export const x = 1;' });
    const controller = new AbortController();
    const agent = new AutonomousAgent({
      goal: 'add a feature',
      environment: {
        workspaceRoot: root,
        runner: constantRunner(okResult()),
        targets: [{ id: 'typecheck', command: 'tsc', args: ['--noEmit'], cwd: root }],
      },
      patchEngine: sequencePatchEngine([[createPatch('src/feature.ts', 'export const f = 1;')]]),
      signal: controller.signal,
      maxAttempts: 3,
    });
    controller.abort();
    const result = await agent.run();
    expect(result.outcome).toBe('CANCELLED');
    expect(result.terminationReason).toBe('USER_CANCELLED');
    expect(result.error).toBeNull();
  });
});

function dangling(): Promise<never> {
  return new Promise<never>(() => undefined);
}

// ---------------------------------------------------------------------------
// P11 — Deterministic agentic smoke (no network, no LLM)
// ---------------------------------------------------------------------------

describe('DF-025 hardening: deterministic agentic smoke (P11)', () => {
  it('the full plan->patch->apply->verify loop succeeds in a temp repo', async () => {
    const root = tempWorkspace({ 'src/index.ts': 'export const x = 1;' });
    const planner = new Planner(); // deterministic, model-free
    const planResult = await planner.plan('Add a feature that returns 42');

    expect(planResult.ok).toBe(true);
    if (!planResult.ok || !planResult.plan) {
      throw new Error('expected a deterministic plan');
    }
    expect(planResult.plan.steps.length).toBeGreaterThan(0);

    const agent = new AutonomousAgent({
      goal: 'Add a feature that returns 42',
      environment: {
        workspaceRoot: root,
        runner: constantRunner(okResult()),
        targets: [{ id: 'typecheck', command: 'tsc', args: ['--noEmit'], cwd: root }],
      },
      patchEngine: sequencePatchEngine([[createPatch('src/feature.ts', 'export const f = 42;')]]),
    });

    const result = await agent.run();
    expect(result.outcome).toBe('SUCCESS');
    expect(result.terminationReason).toBe('VERIFICATION_PASSED');
    expect(fs.existsSync(path.join(root, 'src/feature.ts'))).toBe(true);
    expect(fs.readFileSync(path.join(root, 'src/feature.ts'), 'utf-8')).toBe(
      'export const f = 42;',
    );
  });

  it('produces identical plans for identical input (determinism)', async () => {
    const planner = new Planner();
    const a = await planner.plan('Refactor the module');
    const b = await planner.plan('Refactor the module');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
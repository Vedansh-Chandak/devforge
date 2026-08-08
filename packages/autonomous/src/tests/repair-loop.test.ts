import { describe, expect, it } from 'vitest';
import type { CodePatch, CommandResult, CommandRunner } from '@devforge/execution';
import { Workspace } from '@devforge/execution';
import {
  AttemptHistory,
  DeterministicPatchSelector,
  RollbackManager,
  RepairLoop,
  TerminationController,
  VerificationLoop,
  DeterministicConfidenceEvaluator,
} from '../index.js';
import {
  failResult,
  fixedClock,
  okResult,
  scriptedRunner,
  sequencePatchEngine,
  tempWorkspace,
} from './helpers.js';

function createPatch(file: string, content = 'export const x = 1;'): CodePatch {
  return { id: `p-${file}`, file, operation: 'CREATE', newContent: content };
}

function makeHarness(
  options: {
    sets?: readonly (readonly CodePatch[])[];
    results?: readonly CommandResult[];
    runner?: CommandRunner;
    maxAttempts?: number;
    threshold?: number;
    signal?: AbortSignal;
    verificationTimeoutMs?: number;
    seedHistory?: (history: AttemptHistory) => void;
    onEvent?: (message: string, attempt: number) => void;
  } = {},
) {
  const root = tempWorkspace({ 'src/a.ts': 'original' });
  const workspace = new Workspace({ root });
  const runner = options.runner ?? scriptedRunner(options.results ?? [okResult()]).runner;
  const patchEngine =
    options.sets !== undefined
      ? sequencePatchEngine(options.sets)
      : sequencePatchEngine([[createPatch('src/new.ts', 'export const fresh = 1;')]]);
  const maxAttempts = options.maxAttempts ?? 5;
  const verification = new VerificationLoop({
    runner,
    cwd: root,
    targets: [{ id: 'typecheck', command: 'tsc', args: ['--noEmit'], cwd: root }],
    totalTimeoutMs: options.verificationTimeoutMs,
    now: fixedClock(1000, 10),
  });
  const history = new AttemptHistory();
  options.seedHistory?.(history);
  const rollback = new RollbackManager(workspace, true, { now: fixedClock() });
  const now = fixedClock(1000, 10);
  const loop = new RepairLoop({
    goal: 'write a patch',
    context: ['context'],
    initialDiagnostics: {
      source: 'verification',
      diagnostics: [],
      summary: 'initial failure',
      stderr: [],
      verificationDurationMs: 0,
    },
    reasoningModel: null,
    patchEngine,
    patchSelector: new DeterministicPatchSelector(new DeterministicConfidenceEvaluator()),
    confidence: new DeterministicConfidenceEvaluator(),
    confidenceThreshold: options.threshold ?? 0.5,
    termination: new TerminationController({ maxAttempts: 20, timeoutMs: 0 }),
    attemptHistory: history,
    verification,
    rollback,
    maxAttempts,
    applyPatches: async (patches: readonly CodePatch[]) => {
      for (const patch of patches) {
        if (patch.operation === 'CREATE') {
          await workspace.createFile(patch.file, patch.newContent ?? '');
        }
      }
    },
    now,
    startedAt: 0,
    signal: options.signal,
    onEvent: options.onEvent,
  });
  return { loop, history, runner, workspace, root };
}

describe('RepairLoop success path', () => {
  it('repairs successfully when a later attempt passes verification', async () => {
    const { loop } = makeHarness({
      sets: [[createPatch('src/x.ts')], [createPatch('src/y.ts')]],
      results: [failResult(), okResult()],
    });
    const outcome = await loop.run();
    expect(outcome.success).toBe(true);
    expect(outcome.reason).toBe('VERIFICATION_PASSED');
    expect(outcome.attempts).toBe(2);
  });

  it('passes on the very first repair attempt', async () => {
    const { loop } = makeHarness({ results: [okResult()] });
    const outcome = await loop.run();
    expect(outcome.success).toBe(true);
    expect(outcome.attempts).toBe(1);
  });

  it('records the verification runs in the outcome', async () => {
    const { loop } = makeHarness();
    const outcome = await loop.run();
    expect(outcome.verifications.length).toBe(1);
    expect(outcome.verifications[0]?.ok).toBe(true);
  });

  it('tallies patches generated across repairs', async () => {
    const { loop } = makeHarness({
      sets: [[createPatch('src/x.ts')], [createPatch('src/y.ts')]],
      results: [failResult(), okResult()],
    });
    const outcome = await loop.run();
    expect(outcome.patchesGenerated).toBeGreaterThanOrEqual(1);
  });

  it('reports a token estimate greater than zero', async () => {
    const { loop } = makeHarness();
    const outcome = await loop.run();
    expect(outcome.tokens).toBeGreaterThan(0);
  });

  it('succeeds within a one-attempt budget when verification passes immediately', async () => {
    const { loop } = makeHarness({
      results: [okResult()],
      maxAttempts: 1,
    });
    const outcome = await loop.run();
    expect(outcome.success).toBe(true);
    expect(outcome.attempts).toBe(1);
  });
});

describe('RepairLoop failure paths', () => {
  it('returns MAX_ATTEMPTS_REACHED when every repair fails', async () => {
    const { loop } = makeHarness({
      sets: [[createPatch('src/x.ts')], [createPatch('src/y.ts')], [createPatch('src/z.ts')]],
      results: [failResult(), failResult(), failResult()],
      maxAttempts: 2,
    });
    const outcome = await loop.run();
    expect(outcome.success).toBe(false);
    expect(outcome.reason).toBe('MAX_ATTEMPTS_REACHED');
    expect(outcome.attempts).toBe(2);
  });

  it('stops with DUPLICATE_PATCH when a patch set repeats an earlier attempt', async () => {
    const patch = createPatch('src/x.ts');
    const { loop } = makeHarness({
      sets: [[patch], [patch]],
      results: [failResult(), failResult()],
      seedHistory: (history) => {
        history.record({
          attempt: 0,
          patchIds: [patch.id],
          files: ['src/x.ts'],
          summary: 'CREATE src/x.ts',
          fingerprint: history.fingerprint([patch]),
          verificationOk: false,
          durationMs: 0,
          confidence: 0.8,
          startedAt: 0,
        });
      },
    });
    const outcome = await loop.run();
    expect(outcome.success).toBe(false);
    expect(outcome.reason).toBe('DUPLICATE_PATCH');
  });

  it('stops with CONFIDENCE_BELOW_THRESHOLD when the gate rejects', async () => {
    const { loop } = makeHarness({ threshold: 0.99 });
    const outcome = await loop.run();
    expect(outcome.success).toBe(false);
    expect(outcome.reason).toBe('CONFIDENCE_BELOW_THRESHOLD');
  });

  it('stops with TIMEOUT when a verification run times out', async () => {
    const runner: CommandRunner = {
      run: async (request) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return request.abortSignal?.aborted
          ? okResult({ success: false, cancelled: true, timedOut: true, exitCode: null })
          : failResult();
      },
    };
    const { loop } = makeHarness({ runner, verificationTimeoutMs: 5 });
    const outcome = await loop.run();
    expect(outcome.success).toBe(false);
    expect(outcome.reason).toBe('TIMEOUT');
  });

  it('stops with PATCH_GENERATION_FAILED when the engine returns nothing', async () => {
    const { loop } = makeHarness({ sets: [[]] });
    const outcome = await loop.run();
    expect(outcome.success).toBe(false);
    expect(outcome.reason).toBe('PATCH_GENERATION_FAILED');
  });

  it('stops with USER_CANCELLED on a pre-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort('stop');
    const { loop } = makeHarness({ signal: controller.signal });
    const outcome = await loop.run();
    expect(outcome.reason).toBe('USER_CANCELLED');
    expect(outcome.success).toBe(false);
  });
});

describe('RepairLoop default reasoning', () => {
  it('runs with the default analysis when no reasoning model is injected', async () => {
    const { loop } = makeHarness();
    const outcome = await loop.run();
    expect(outcome.success).toBe(true);
    expect(outcome.message).toContain('verified');
  });

  it('emits an event message per repair attempt', async () => {
    const messages: string[] = [];
    const { loop } = makeHarness({
      results: [okResult()],
      onEvent: (message: string) => {
        messages.push(message);
      },
    });
    await loop.run();
    expect(messages.length).toBeGreaterThan(0);
  });
});
/**
 * Shared test helpers for the DevForge CLI integration / e2e test suites.
 *
 * Provides:
 *  - temp repository orchestration (copy fixture, git init, commit),
 *  - a scripted (fake) ModelProvider for dependency injection,
 *  - minimal, valid plan / report fixtures used across handlers.
 *
 * No network access and nothing is ever written outside the OS temp dir.
 */
import { cp, mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import type { ModelProvider, ModelRequest, ModelResponse } from '@devforge/model-provider';
import type { ExecutionPlan, PlanStep } from '@devforge/planner';

/** Absolute path to this repo's mock-repository fixture. */
export function mockRepositoryFixture(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), 'mock-repository');
}

/** Create a fresh temp dir guaranteed to be inside the OS temp directory. */
export async function makeTempDir(prefix = 'devforge-cli-test-'): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}

export interface TempRepoOptions {
  /** Whether to git init and create an initial commit (enables review/diff). */
  readonly git?: boolean;
}

/**
 * Copy mock-repository fixture into a brand-new temp dir and optionally turn
 * it into a git repository with a baseline commit. Returns the temp root.
 */
export async function createTempMockRepo(options: TempRepoOptions = {}): Promise<string> {
  const dest = await makeTempDir();
  await cp(mockRepositoryFixture(), dest, { recursive: true });
  if (options.git) {
    execFileSync('git', ['init', '-q'], { cwd: dest, stdio: 'ignore' });
    execFileSync('git', ['add', '-A'], { cwd: dest, stdio: 'ignore' });
    execFileSync('git', ['commit', '-q', '-m', 'init'], {
      cwd: dest,
      stdio: 'ignore',
      env: { ...process.env, GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.com' },
    });
  }
  return dest;
}

/** Number of entries (non-recursive) at the repo root, for sanity checks. */
export async function countRootEntries(root: string): Promise<number> {
  return (await readdir(root)).length;
}

/**
 * A scripted ModelProvider for dependency injection.
 *
 * Dispatches on the request content:
 *   - planner prompts ("Planning Engine")  → a valid plan JSON.
 *   - any other request                     → free-form assistant text.
 * Records every request so tests can assert the provider was actually invoked.
 */
export class ScriptedProvider implements ModelProvider {
  readonly id = 'scripted-provider';
  readonly requests: ModelRequest[] = [];

  constructor(
    private readonly respond: (request: ModelRequest) => ModelResponse = defaultRespond,
  ) {}

  async generate(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    return this.respond(request);
  }

  get callCount(): number {
    return this.requests.length;
  }
}

/** Deterministic default: valid plan for planner prompts, text otherwise. */
function defaultRespond(request: ModelRequest): ModelResponse {
  const all = request.messages.map((m) => `${m.role}: ${m.content}`).join('\n');
  if (all.includes('Planning Engine')) {
    return {
      content: JSON.stringify(buildPlan()) as string,
      model: 'scripted-planner',
      finishReason: 'stop',
      usage: { inputTokens: 5, outputTokens: 10, totalTokens: 15 },
    };
  }
  return {
    content: 'This is a deterministic answer from the scripted model provider.',
    model: 'scripted-model',
    finishReason: 'stop',
    usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
  };
}

/** Build a minimal but fully-valid execution plan (read-only SEARCH step). */
export function buildPlan(overrides: Partial<ExecutionPlan> = {}): ExecutionPlan {
  const step: PlanStep = {
    id: 'step-1',
    title: 'Search the repository',
    description: `Search the repository for: ${overrides.goal ?? 'example'}`,
    type: 'SEARCH',
    dependsOn: [],
    estimatedCost: 1,
    requiresConfirmation: false,
  };

  return {
    goal: 'example',
    summary: 'Test plan — 1 step',
    complexity: 'LOW',
    risk: 'LOW',
    requiresConfirmation: false,
    assumptions: ['Example assumption'],
    expectedOutputs: ['A validated plan'],
    steps: [step],
    ...overrides,
  };
}
/**
 * @devforge/multi-agent — Shared agent context (DF-022).
 *
 * Everything an agent needs to act in a run: identity, the shared
 * conversation, an artifact store for passing outputs, an optional command
 * runner for real work, a clock, and an abort signal wired to cancellation.
 * The context carries no orchestration state — that lives in the coordinator
 * and scheduler.
 */

import type { CommandRunner, GitService, VerificationTarget } from '@devforge/execution';
import type { Artifact } from './types.js';
import type { Conversation } from './conversation.js';

/** Deterministic store agents use to share artifacts within a run. */
export class ArtifactStore {
  private readonly byKey = new Map<string, Artifact>();

  put(artifact: Artifact): Artifact {
    const key = artifact.id ?? artifact.path;
    this.byKey.set(key, artifact);
    return artifact;
  }

  get(key: string): Artifact | undefined {
    return this.byKey.get(key);
  }

  all(): readonly Artifact[] {
    return [...this.byKey.values()];
  }

  byPath(path: string): readonly Artifact[] {
    return this.all().filter((artifact) => artifact.path === path);
  }

  get size(): number {
    return this.byKey.size;
  }

  clear(): void {
    this.byKey.clear();
  }
}

/** Environment passed to role agents and supporting services for a run. */
export interface AgentContext {
  readonly runId: string;
  readonly workspaceRoot: string;
  readonly conversation: Conversation;
  readonly artifacts: ArtifactStore;
  /** Reused execution CommandRunner for real work (optional in tests). */
  readonly commands?: CommandRunner;
  /** Reused execution GitService (optional in tests). */
  readonly git?: GitService;
  /** Verification targets reused from the executor subsystem. */
  readonly targets?: readonly VerificationTarget[];
  /** Deterministic clock. */
  readonly now: () => number;
  /** Abort signal that reflects run cancellation. */
  readonly signal?: AbortSignal;
  /** Free-form scratch space keyed by string. */
  readonly data: Map<string, unknown>;
}

/** Options used to build an {@link AgentContext}. */
export interface AgentContextOptions {
  readonly runId: string;
  readonly workspaceRoot: string;
  readonly conversation: Conversation;
  readonly artifacts?: ArtifactStore;
  readonly commands?: CommandRunner;
  readonly git?: GitService;
  readonly targets?: readonly VerificationTarget[];
  readonly now?: () => number;
  readonly signal?: AbortSignal;
}

const DEFAULT_NOW: () => number = () => Date.now();

/** Build a context, filling defaults deterministically where possible. */
export function createContext(options: AgentContextOptions): AgentContext {
  return {
    runId: options.runId,
    workspaceRoot: options.workspaceRoot,
    conversation: options.conversation,
    artifacts: options.artifacts ?? new ArtifactStore(),
    commands: options.commands,
    git: options.git,
    targets: options.targets,
    now: options.now ?? DEFAULT_NOW,
    signal: options.signal,
    data: new Map(),
  };
}

/** Whether the run should stop because the abort signal fired. */
export function isAborted(context: AgentContext): boolean {
  return context.signal ? context.signal.aborted : false;
}

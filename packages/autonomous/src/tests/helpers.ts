import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type {
  CodePatch,
  CommandRequest,
  CommandResult,
  CommandRunner,
  PatchEngine,
  PatchGenerationRequest,
} from '@devforge/execution';

let counter = 0;

/** A well-formed create patch. */
export function createPatch(
  file: string,
  content = 'export const value = 1;\n',
  id = `p-${file}${counter++}`,
): CodePatch {
  return { id, file, operation: 'CREATE', newContent: content };
}

/** A well-formed modify patch. */
export function modifyPatch(
  file: string,
  content: string,
  expectedHash?: string,
  id = `m-${file}${counter++}`,
): CodePatch {
  return {
    id,
    file,
    operation: 'MODIFY',
    newContent: content,
    ...(expectedHash ? { expectedHash } : {}),
  };
}

export function deletePatch(file: string, id = `d-${file}${counter++}`): CodePatch {
  return { id, file, operation: 'DELETE' };
}

/** A successful command result. */
export function okResult(overrides: Partial<CommandResult> = {}): CommandResult {
  return {
    success: true,
    stdout: '',
    stderr: '',
    exitCode: 0,
    durationMs: 0,
    timedOut: false,
    cancelled: false,
    truncated: false,
    command: 'tsc',
    args: ['--noEmit'],
    ...overrides,
  };
}

/** A failing command result. */
export function failResult(overrides: Partial<CommandResult> = {}): CommandResult {
  return {
    ...okResult({ success: false, exitCode: 1, stderr: 'error TS2322: type mismatch' }),
    ...overrides,
  };
}

export type ScriptedEntry =
  | CommandResult
  | ((request: CommandRequest) => CommandResult);

/**
 * Deterministic fake CommandRunner. Replays the scripted results in order;
 * when the queue is exhausted it fails with an explanatory error.
 */
export interface ScriptedRunner {
  readonly runner: CommandRunner;
  readonly calls: CommandRequest[];
  readonly results: ScriptedEntry[];
}

export function scriptedRunner(results: readonly ScriptedEntry[] = []): ScriptedRunner {
  const calls: CommandRequest[] = [];
  const queue = [...results];
  const runner: CommandRunner = {
    async run(request: CommandRequest): Promise<CommandResult> {
      calls.push(request);
      const next = queue.shift();
      if (next === undefined) {
        throw new Error(
          `Unexpected verification command: ${request.command} ${request.args.join(' ')}`,
        );
      }
      return typeof next === 'function' ? next(request) : next;
    },
  };
  return { runner, calls, results: queue };
}

/** A runner that always returns `result`. */
export function constantRunner(result: CommandResult): CommandRunner {
  return { run: async () => result };
}

/**
 * Patch engine that hands back a distinct patch set per `generate()` call.
 * The last scripted set is repeated on further calls.
 */
export function sequencePatchEngine(
  sets: readonly (readonly CodePatch[])[],
): PatchEngine {
  let calls = 0;
  return {
    name: 'sequence',
    async generate(request: PatchGenerationRequest): Promise<readonly CodePatch[]> {
      const index = Math.min(calls, sets.length - 1);
      const set = sets[Math.max(0, index)] as readonly CodePatch[];
      calls += 1;
      return set.map((patch) => ({ ...patch }));
    },
  };
}

/** A patch engine that fails with a given error. */
export function failingPatchEngine(error: Error): PatchEngine {
  return {
    name: 'failing',
    async generate(): Promise<readonly CodePatch[]> {
      throw error;
    },
  };
}

/** Create a throwaway workspace directory, optionally pre-seeded with files. */
export function tempWorkspace(files: Readonly<Record<string, string>> = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `df-agent-${Date.now()}-`));
  for (const [file, content] of Object.entries(files)) {
    const absolute = path.join(root, file);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content, 'utf-8');
  }
  return root;
}

export function readFile(root: string, file: string): string {
  return fs.readFileSync(path.join(root, file), 'utf-8');
}

export function fileExists(root: string, file: string): boolean {
  return fs.existsSync(path.join(root, file));
}

/** A constant clock. */
export function fixedClock(base = 1000, tick = 1): () => number {
  let value = base;
  return () => {
    const current = value;
    value += tick;
    return current;
  };
}
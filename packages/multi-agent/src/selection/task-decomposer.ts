/**
 * @devforge/multi-agent — Task decomposer (DF-022).
 *
 * Splits a developer request into deterministic subtasks. It reuses the
 * planner's request parser (`parseRequest`) to detect intent, then applies a
 * fixed keyword rule table to derive ordered subtasks. The decomposition is
 * pure and deterministic — identical input yields identical output, no model
 * calls.
 */

import { buildDeterministicPlan, parseRequest, type ParsedRequest } from '@devforge/planner';
import type { Task, TaskKind } from '../types.js';
import { MultiAgentDecompositionError } from '../errors.js';

/** A subtask produced before routing assigns a role. */
export interface DecomposedTask {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly kind: TaskKind;
  readonly dependsOn: readonly string[];
  readonly target?: string;
}

/** Options controlling decomposition. */
export interface DecomposeOptions {
  readonly idPrefix?: string;
  readonly includeTests?: boolean;
  readonly includeDocs?: boolean;
  readonly includePlan?: boolean;
  readonly includeReview?: boolean;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
}

const DEFAULTS: Required<DecomposeOptions> = {
  idPrefix: 'task',
  includeTests: true,
  includeDocs: true,
  includePlan: true,
  includeReview: true,
  timeoutMs: 60000,
  maxRetries: 1,
};

interface Rule {
  readonly keyword: string;
  readonly kind: Exclude<TaskKind, 'PLAN' | 'REVIEW'>;
  readonly title: string;
}

/** Keyword rule table — scanned in order; first matches win. */
const RULES: readonly Rule[] = [
  { keyword: 'middleware', kind: 'IMPLEMENT', title: 'Add middleware' },
  { keyword: 'route', kind: 'IMPLEMENT', title: 'Update routes' },
  { keyword: 'endpoint', kind: 'IMPLEMENT', title: 'Implement endpoint' },
  { keyword: 'api', kind: 'IMPLEMENT', title: 'Implement API layer' },
  { keyword: 'auth', kind: 'IMPLEMENT', title: 'Implement authentication' },
  { keyword: 'jwt', kind: 'IMPLEMENT', title: 'Implement JWT signing and verification' },
  { keyword: 'schema', kind: 'IMPLEMENT', title: 'Define schema' },
  { keyword: 'database', kind: 'IMPLEMENT', title: 'Update database access' },
  { keyword: 'db', kind: 'IMPLEMENT', title: 'Update database access' },
  { keyword: 'model', kind: 'IMPLEMENT', title: 'Add model' },
  { keyword: 'validation', kind: 'IMPLEMENT', title: 'Add input validation' },
  { keyword: 'config', kind: 'IMPLEMENT', title: 'Update configuration' },
  { keyword: 'refactor', kind: 'IMPLEMENT', title: 'Refactor implementation' },
  { keyword: 'test', kind: 'TEST', title: 'Add tests' },
  { keyword: 'doc', kind: 'DOCUMENT', title: 'Update documentation' },
  { keyword: 'docs', kind: 'DOCUMENT', title: 'Update documentation' },
  { keyword: 'readme', kind: 'DOCUMENT', title: 'Update README' },
];

/**
 * Deterministically decompose a request into ordered subtasks.
 *
 * The canonical "Implement JWT auth" example yields: Add middleware → Update
 * routes → Add tests → Update docs.
 */
export function decomposeRequest(request: string, options: DecomposeOptions = {}): readonly DecomposedTask[] {
  if (typeof request !== 'string' || request.trim().length === 0) {
    throw new MultiAgentDecompositionError('cannot decompose an empty request');
  }
  const opts: Required<DecomposeOptions> = { ...DEFAULTS, ...options };
  const parsed: ParsedRequest = parseRequest(request);
  const lower = parsed.lower;

  const subtasks: DecomposedTask[] = [];
  let order = 0;
  const add = (
    kind: TaskKind,
    title: string,
    dependsOn: readonly string[],
    target?: string,
  ): DecomposedTask => {
    order += 1;
    const subtask: DecomposedTask = {
      id: `${opts.idPrefix}-${order}`,
      title,
      description: `Subtask ${order}: ${title} (derived from: ${request})`,
      kind,
      dependsOn,
      target,
    };
    subtasks.push(subtask);
    return subtask;
  };

  let last: DecomposedTask | null = null;
  if (opts.includePlan) {
    last = add('PLAN', `Plan ${titleCase(request)}`, []);
  }

  let hasImplement = false;
  for (const rule of RULES) {
    if (!lower.includes(rule.keyword)) {
      continue;
    }
    if (rule.kind === 'TEST' && !opts.includeTests) continue;
    if (rule.kind === 'DOCUMENT' && !opts.includeDocs) continue;
    last = add(rule.kind, rule.title, last ? [last.id] : [], titleToPath(rule.title));
    if (rule.kind === 'IMPLEMENT') hasImplement = true;
  }

  if (!hasImplement) {
    last = add('IMPLEMENT', `Implement ${titleCase(request)}`, last ? [last.id] : [], titleToPath(request));
  }

  const impl = subtasks.find((t) => t.kind === 'IMPLEMENT') as DecomposedTask;
  if (opts.includeTests && !subtasks.some((t) => t.kind === 'TEST')) {
    add('TEST', `Add tests for ${impl.id}`, [impl.id]);
  }
  if (opts.includeDocs && !subtasks.some((t) => t.kind === 'DOCUMENT')) {
    add('DOCUMENT', `Document ${impl.id}`, [impl.id], `docs/${impl.id}.md`);
  }
  if (opts.includeReview) {
    add('REVIEW', 'Review implementation', [impl.id]);
  }

  return subtasks;
}

/** Convert a title into a path stub. */
export function titleToPath(title: string): string {
  const slug = title.replace(/[^a-zA-Z0-9 ]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase();
  return `src/${slug}.ts`;
}

/** Title-case a short phrase for display. */
export function titleCase(phrase: string): string {
  const cleaned = phrase.replace(/\s+/g, ' ').trim();
  if (cleaned.length === 0) return 'feature';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/** Build a full routed {@link Task} from a decomposed subtask. */
export function toTask(part: DecomposedTask, role: Task['role'], options: DecomposeOptions = {}): Task {
  const opts: Required<DecomposeOptions> = { ...DEFAULTS, ...options };
  return {
    id: part.id,
    title: part.title,
    description: part.description,
    kind: part.kind,
    role,
    dependsOn: part.dependsOn,
    target: part.target,
    requiresConfirmation: false,
    timeoutMs: opts.timeoutMs,
    maxRetries: opts.maxRetries,
  };
}

/** Build a deterministic planner plan for a request (reusing the planner). */
export function buildPlanFor(request: string) {
  const parsed = parseRequest(request);
  return buildDeterministicPlan(parsed);
}

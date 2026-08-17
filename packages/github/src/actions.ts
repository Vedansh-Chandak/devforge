/**
 * @devforge/github — GitHub Actions integration (DF-021).
 *
 * Monitors workflow runs, reads job/step logs, analyzes failures, repairs the
 * underlying repository with the Autonomous Agent, and re-runs workflows up
 * to a configured number of retries. Reuses `@devforge/autonomous`'s
 * {@link AutonomousAgent} for the repair step.
 */

import type { GitHubClient } from './client.js';
import type { AutonomousAgentConfig } from '@devforge/autonomous';
import { AutonomousAgent } from '@devforge/autonomous';
import type {
  FailedJob,
  FixCiResult,
  GitHubWorkflow,
  GitHubWorkflowRun,
  RetryOutcome,
  WorkflowFailureAnalysis,
  WorkflowJob,
  WorkflowRunConclusion,
  WorkflowRunStatus,
} from './types.js';
import { GitHubValidationError } from './errors.js';

/** A repair agent surface used by the fix-ci loop. */
export interface RepairAgent {
  run(): Promise<{
    outcome: string;
    terminationMessage: string;
    patchesGenerated: number;
  }>;
}

/** Options for the fix-ci repair loop. */
export interface FixCiOptions {
  /** Number of repair + rerun cycles allowed after the first failure. Default 3. */
  readonly maxRetries?: number;
  /** Poll interval for workflow completion in ms. Default 5000. */
  readonly pollIntervalMs?: number;
  /** Overall timeout for a single run's completion in ms. Default 30 min. */
  readonly runTimeoutMs?: number;
  /** Injectable clock. */
  readonly now?: () => number;
  /** Injectable sleep (deterministic tests). */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Extra autonomous agent config passed to the repair agent. */
  readonly agent?: Omit<AutonomousAgentConfig, 'goal' | 'environment'>;
  /** Injectable repair agent factory (deterministic tests). */
  readonly agentFactory?: (goal: string, workspaceRoot: string) => RepairAgent;
  /** Where the cloned repository lives (workspace root for the agent). */
  readonly workspaceRoot: string;
}

/** A single workflow run observed during monitoring. */
export interface MonitoredRun {
  readonly run: GitHubWorkflowRun;
  readonly completed: boolean;
}

/** The actions service. */
export class ActionsService {
  private readonly client: GitHubClient;

  constructor(client: GitHubClient) {
    this.client = client;
  }

  // ── Workflow metadata ──────────────────────────────────────────────────

  /** List workflows for a repository. */
  async workflows(ref: { owner: string; name: string }): Promise<readonly GitHubWorkflow[]> {
    const workflows: GitHubWorkflow[] = [];
    for await (const raw of this.client.paginate<Record<string, unknown>>(
      `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}/actions/workflows`,
      { query: { per_page: 100 } },
    )) {
      if (typeof raw['id'] === 'number' && typeof raw['name'] === 'string') {
        workflows.push(normalizeWorkflow(raw));
      }
    }
    return workflows;
  }

  /** Get a workflow by id. */
  async workflow(ref: { owner: string; name: string }, workflowId: number): Promise<GitHubWorkflow> {
    const response = await this.client.get<Record<string, unknown>>(
      `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}/actions/workflows/${workflowId}`,
    );
    return normalizeWorkflow(response.body);
  }

  /** List workflow runs (optionally for a specific workflow/branch). */
  async runs(
    ref: { owner: string; name: string },
    options: { workflowId?: number; branch?: string; event?: string; status?: WorkflowRunStatus; limit?: number } = {},
  ): Promise<readonly GitHubWorkflowRun[]> {
    const limit = options.limit ?? 30;
    const query: Record<string, string | number | boolean | undefined> = { per_page: 100 };
    if (options.workflowId !== undefined) query['workflow_id'] = options.workflowId;
    if (options.branch !== undefined) query['branch'] = options.branch;
    if (options.event !== undefined) query['event'] = options.event;
    if (options.status !== undefined) query['status'] = options.status;
    const runs: GitHubWorkflowRun[] = [];
    let count = 0;
    for await (const raw of this.client.paginate<Record<string, unknown>>(
      `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}/actions/runs`,
      { query },
    )) {
      if (count >= limit) break;
      runs.push(normalizeWorkflowRun(raw));
      count += 1;
    }
    return runs;
  }

  /** Get a single workflow run. */
  async run(ref: { owner: string; name: string }, runId: number): Promise<GitHubWorkflowRun> {
    validatePositive(runId, 'run id');
    const response = await this.client.get<Record<string, unknown>>(
      `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}/actions/runs/${runId}`,
    );
    return normalizeWorkflowRun(response.body);
  }

  /** Fetch the raw log text for a workflow run. */
  async runLogs(ref: { owner: string; name: string }, runId: number): Promise<string> {
    validatePositive(runId, 'run id');
    const response = await this.client.request<string>({
      method: 'GET',
      path: `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}/actions/runs/${runId}/logs`,
      headers: { Accept: 'application/vnd.github+json' },
      raw: true,
    });
    return typeof response.body === 'string' ? response.body : '';
  }

  /** List jobs for a workflow run. */
  async jobs(ref: { owner: string; name: string }, runId: number): Promise<readonly WorkflowJob[]> {
    validatePositive(runId, 'run id');
    const jobs: WorkflowJob[] = [];
    for await (const raw of this.client.paginate<Record<string, unknown>>(
      `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}/actions/runs/${runId}/jobs`,
      { query: { per_page: 100 } },
    )) {
      jobs.push(normalizeJob(raw));
    }
    return jobs;
  }

  // ── Monitoring ─────────────────────────────────────────────────────────

  /** Poll a run until it completes or the timeout elapses. */
  async monitorRun(
    ref: { owner: string; name: string },
    runId: number,
    options: { pollIntervalMs?: number; timeoutMs?: number; now?: () => number; sleep?: (ms: number) => Promise<void> } = {},
  ): Promise<MonitoredRun> {
    const interval = options.pollIntervalMs ?? 5_000;
    const timeout = options.timeoutMs ?? 30 * 60_000;
    const now = options.now ?? (() => Date.now());
    const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    const started = now();

    let current = await this.run(ref, runId);
    while (!isTerminalStatus(current.status)) {
      if (now() - started > timeout) break;
      await sleep(interval);
      current = await this.run(ref, runId);
    }
    return { run: current, completed: isTerminalStatus(current.status) };
  }

  // ── Failure analysis ───────────────────────────────────────────────────

  /** Analyze a run's failure: failed jobs, failed steps, and log snippets. */
  async analyzeFailure(ref: { owner: string; name: string }, run: GitHubWorkflowRun, options: { maxSnippetChars?: number } = {}): Promise<WorkflowFailureAnalysis> {
    const maxSnippet = options.maxSnippetChars ?? 2_000;
    const jobs = await this.jobs(ref, run.id);
    const failedJobs: FailedJob[] = [];
    let failedSteps = 0;

    for (const job of jobs) {
      const failedStepNames = (job.steps ?? [])
        .filter((step) => isFailingConclusion(step.conclusion))
        .map((step) => step.name);
      if (failedStepNames.length > 0 || isFailingConclusion(job.conclusion)) {
        failedSteps += failedStepNames.length;
        const snippet = failedStepNames.length > 0 ? await this.stepLogSnippet(ref, run.id, job.id, failedStepNames[0]!, maxSnippet) : '';
        failedJobs.push({ id: job.id, name: job.name, failedSteps: failedStepNames, logSnippet: snippet });
      }
    }

    const failed = failedJobs.length > 0 || isFailingConclusion(run.conclusion);
    const summary = failed
      ? `Workflow run #${run.runNumber} failed with ${failedJobs.length} failing job(s).`
      : `Workflow run #${run.runNumber} completed with conclusion ${run.conclusion ?? 'unknown'}.`;
    return { runId: run.id, failed, conclusion: run.conclusion, failedJobs, summary };
  }

  /** Re-run a workflow. */
  async rerun(ref: { owner: string; name: string }, runId: number): Promise<void> {
    validatePositive(runId, 'run id');
    await this.client.post(`/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}/actions/runs/${runId}/rerun`);
  }

  /** Cancel a workflow run. */
  async cancel(ref: { owner: string; name: string }, runId: number): Promise<void> {
    validatePositive(runId, 'run id');
    await this.client.post(`/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}/actions/runs/${runId}/cancel`);
  }

  // ── Fix-CI repair loop ─────────────────────────────────────────────────

  /**
   * Run the full fix-ci loop: wait for the run, analyze the failure, repair
   * with the Autonomous Agent, re-run, and repeat up to `maxRetries`.
   */
  async fixCi(
    ref: { owner: string; name: string },
    runId: number,
    options: FixCiOptions,
  ): Promise<FixCiResult> {
    const maxRetries = options.maxRetries ?? 3;
    if (maxRetries < 0) throw new GitHubValidationError('maxRetries must be >= 0');

    const attempts: RetryOutcome[] = [];
    let repairPatches = 0;
    let currentRun = await this.run(ref, runId);
    let succeeded = isPassingConclusion(currentRun.conclusion);

    // Wait for the initial run to complete if it is still in progress.
    if (!isTerminalStatus(currentRun.status)) {
      const monitored = await this.monitorRun(ref, runId, {
        pollIntervalMs: options.pollIntervalMs,
        timeoutMs: options.runTimeoutMs,
        now: options.now,
        sleep: options.sleep,
      });
      currentRun = monitored.run;
      succeeded = isPassingConclusion(currentRun.conclusion);
    }

    attempts.push({
      attempt: 1,
      runId: currentRun.id,
      status: currentRun.status,
      conclusion: currentRun.conclusion,
      repaired: false,
      message: `initial run #${currentRun.runNumber} ${succeeded ? 'passed' : 'failed'}`,
    });

    let cycle = 0;
    while (!succeeded && cycle < maxRetries) {
      cycle += 1;
      const analysis = await this.analyzeFailure(ref, currentRun);
      const repairResult = await this.repairWithAgent(options, analysis.summary);
      repairPatches += repairResult.patches;

      await this.rerun(ref, runId);
      const monitored = await this.monitorRun(ref, runId, {
        pollIntervalMs: options.pollIntervalMs,
        timeoutMs: options.runTimeoutMs,
        now: options.now,
        sleep: options.sleep,
      });
      currentRun = monitored.run;
      succeeded = isPassingConclusion(currentRun.conclusion);

      attempts.push({
        attempt: cycle + 1,
        runId: currentRun.id,
        status: currentRun.status,
        conclusion: currentRun.conclusion,
        repaired: repairResult.patches > 0,
        message: `repair cycle ${cycle}: ${repairResult.message}`,
      });
    }

    return {
      succeeded,
      attempts,
      finalConclusion: currentRun.conclusion,
      repairPatches,
      stoppedAfterRetries: !succeeded && cycle >= maxRetries,
    };
  }

  // ── Internals ──────────────────────────────────────────────────────────

  private async stepLogSnippet(
    ref: { owner: string; name: string },
    runId: number,
    jobId: number,
    stepName: string,
    maxChars: number,
  ): Promise<string> {
    try {
      const logs = await this.runLogs(ref, runId);
      const lines = logs.split('\n');
      const interesting: string[] = [];
      let found = false;
      for (const line of lines) {
        if (line.includes(stepName)) found = true;
        if (found) interesting.push(line);
        if (interesting.length > 60) break;
      }
      return interesting.join('\n').slice(0, maxChars);
    } catch {
      return '';
    }
  }

  private async repairWithAgent(
    options: FixCiOptions,
    failureSummary: string,
  ): Promise<{ patches: number; message: string }> {
    const agent: RepairAgent =
      options.agentFactory?.(`Fix the failing CI: ${failureSummary}`, options.workspaceRoot) ??
      new AutonomousAgent({
        ...(options.agent ?? {}),
        goal: `Fix the failing CI: ${failureSummary}`,
        environment: {
          workspaceRoot: options.workspaceRoot,
        },
      });
    try {
      const result = await agent.run();
      return {
        patches: result.patchesGenerated,
        message: result.outcome === 'SUCCESS' ? result.terminationMessage : `repair incomplete: ${result.terminationMessage}`,
      };
    } catch (error) {
      return {
        patches: 0,
        message: `repair agent threw: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}

function isTerminalStatus(status: WorkflowRunStatus): boolean {
  return status === 'completed';
}

function isPassingConclusion(conclusion: WorkflowRunConclusion | null): boolean {
  return conclusion === 'success' || conclusion === 'neutral' || conclusion === 'skipped';
}

function isFailingConclusion(conclusion: WorkflowRunConclusion | null): boolean {
  return conclusion === 'failure' || conclusion === 'timed_out' || conclusion === 'startup_failure' || conclusion === 'action_required' || conclusion === 'cancelled';
}

function normalizeWorkflow(raw: Record<string, unknown>): GitHubWorkflow {
  return {
    id: typeof raw['id'] === 'number' ? raw['id'] : 0,
    name: typeof raw['name'] === 'string' ? raw['name'] : '',
    path: typeof raw['path'] === 'string' ? raw['path'] : '',
    state: (['active', 'disabled_manually', 'disabled_inactivity', 'disabled_default_branch'] as const).includes(raw['state'] as never)
      ? (raw['state'] as GitHubWorkflow['state'])
      : 'active',
    htmlUrl: typeof raw['html_url'] === 'string' ? raw['html_url'] : undefined,
  };
}

function normalizeWorkflowRun(raw: Record<string, unknown>): GitHubWorkflowRun {
  const conclusionRaw = typeof raw['conclusion'] === 'string' ? raw['conclusion'] : null;
  return {
    id: typeof raw['id'] === 'number' ? raw['id'] : 0,
    name: typeof raw['name'] === 'string' ? raw['name'] : null,
    headBranch: typeof raw['head_branch'] === 'string' ? raw['head_branch'] : '',
    headSha: typeof raw['head_sha'] === 'string' ? raw['head_sha'] : '',
    runNumber: typeof raw['run_number'] === 'number' ? raw['run_number'] : 0,
    status: (['queued', 'in_progress', 'completed', 'requested', 'waiting', 'pending'] as const).includes(raw['status'] as never)
      ? (raw['status'] as WorkflowRunStatus)
      : 'queued',
    conclusion: conclusionRaw as WorkflowRunConclusion | null,
    event: typeof raw['event'] === 'string' ? raw['event'] : '',
    workflowId: typeof raw['workflow_id'] === 'number' ? raw['workflow_id'] : 0,
    displayTitle: typeof raw['display_title'] === 'string' ? raw['display_title'] : '',
    runAttempt: typeof raw['run_attempt'] === 'number' ? raw['run_attempt'] : undefined,
    htmlUrl: typeof raw['html_url'] === 'string' ? raw['html_url'] : undefined,
    createdAt: typeof raw['created_at'] === 'string' ? raw['created_at'] : undefined,
    updatedAt: typeof raw['updated_at'] === 'string' ? raw['updated_at'] : undefined,
    completedAt: typeof raw['updated_at'] === 'string' ? raw['updated_at'] : null,
  };
}

function normalizeJob(raw: Record<string, unknown>): WorkflowJob {
  const steps = Array.isArray(raw['steps'])
    ? (raw['steps'] as Record<string, unknown>[]).map((s) => ({
        name: typeof s['name'] === 'string' ? s['name'] : '',
        status: (['queued', 'in_progress', 'completed', 'requested', 'waiting', 'pending'] as const).includes(s['status'] as never)
          ? (s['status'] as WorkflowRunStatus)
          : 'queued',
        conclusion: typeof s['conclusion'] === 'string' ? (s['conclusion'] as WorkflowRunConclusion) : null,
        number: typeof s['number'] === 'number' ? s['number'] : 0,
        startedAt: typeof s['started_at'] === 'string' ? s['started_at'] : undefined,
        completedAt: typeof s['completed_at'] === 'string' ? s['completed_at'] : undefined,
      }))
    : [];
  return {
    id: typeof raw['id'] === 'number' ? raw['id'] : 0,
    name: typeof raw['name'] === 'string' ? raw['name'] : '',
    status: (['queued', 'in_progress', 'completed', 'requested', 'waiting', 'pending'] as const).includes(raw['status'] as never)
      ? (raw['status'] as WorkflowRunStatus)
      : 'queued',
    conclusion: typeof raw['conclusion'] === 'string' ? (raw['conclusion'] as WorkflowRunConclusion) : null,
    startedAt: typeof raw['started_at'] === 'string' ? raw['started_at'] : undefined,
    completedAt: typeof raw['completed_at'] === 'string' ? raw['completed_at'] : undefined,
    steps,
  };
}

function validatePositive(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new GitHubValidationError(`${label} must be a positive integer`);
  }
}

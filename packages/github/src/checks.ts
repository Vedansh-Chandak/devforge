/**
 * @devforge/github — Checks API (DF-021).
 *
 * Publishes progress, status, summary, repair reports, and verification
 * results as GitHub check runs. Progress is written as check-run output;
 * final status/conclusion is written when the work completes.
 */

import type { GitHubClient } from './client.js';
import type { CheckAnnotation, CheckRun, CheckRunConclusion, CheckRunOutput, CheckRunStatus, RepoRef } from './types.js';
import { GitHubValidationError } from './errors.js';

/** Options for creating a check run. */
export interface CreateCheckRunOptions {
  readonly name: string;
  readonly headSha: string;
  readonly status: CheckRunStatus;
  readonly conclusion?: CheckRunConclusion;
  readonly output?: CheckRunOutput;
  readonly detailsUrl?: string;
}

/** The checks service. */
export class ChecksService {
  private readonly client: GitHubClient;

  constructor(client: GitHubClient) {
    this.client = client;
  }

  /** Create a check run on a commit. */
  async create(ref: RepoRef, options: CreateCheckRunOptions): Promise<CheckRun> {
    if (!options.name || options.name.trim().length === 0) {
      throw new GitHubValidationError('Check run name is required');
    }
    if (!options.headSha || options.headSha.trim().length === 0) {
      throw new GitHubValidationError('Check run headSha is required');
    }
    const body: Record<string, unknown> = {
      name: options.name,
      head_sha: options.headSha,
      status: options.status,
    };
    if (options.conclusion !== undefined) body['conclusion'] = options.conclusion;
    if (options.detailsUrl !== undefined) body['details_url'] = options.detailsUrl;
    if (options.output !== undefined) body['output'] = serializeOutput(options.output);
    const response = await this.client.post<Record<string, unknown>>(
      `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}/check-runs`,
      { body },
    );
    return normalizeCheckRun(response.body);
  }

  /** Update an existing check run. */
  async update(ref: RepoRef, checkRunId: number, options: Omit<CreateCheckRunOptions, 'name' | 'headSha'>): Promise<CheckRun> {
    if (!Number.isInteger(checkRunId) || checkRunId <= 0) {
      throw new GitHubValidationError('Check run id must be a positive integer');
    }
    const body: Record<string, unknown> = {
      status: options.status,
    };
    if (options.conclusion !== undefined) body['conclusion'] = options.conclusion;
    if (options.detailsUrl !== undefined) body['details_url'] = options.detailsUrl;
    if (options.output !== undefined) body['output'] = serializeOutput(options.output);
    const response = await this.client.patch<Record<string, unknown>>(
      `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}/check-runs/${checkRunId}`,
      { body },
    );
    return normalizeCheckRun(response.body);
  }

  /** Get a check run by id. */
  async get(ref: RepoRef, checkRunId: number): Promise<CheckRun> {
    if (!Number.isInteger(checkRunId) || checkRunId <= 0) {
      throw new GitHubValidationError('Check run id must be a positive integer');
    }
    const response = await this.client.get<Record<string, unknown>>(
      `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}/check-runs/${checkRunId}`,
    );
    return normalizeCheckRun(response.body);
  }

  /** Publish an in-progress check run with a progress message. */
  async publishProgress(
    ref: RepoRef,
    options: { name: string; headSha: string; message: string; progress?: number },
  ): Promise<CheckRun> {
    const output: CheckRunOutput = {
      title: 'In progress',
      summary: options.message,
      text: options.progress !== undefined ? `Progress: ${options.progress}%` : undefined,
    };
    return this.create(ref, { name: options.name, headSha: options.headSha, status: 'in_progress', output });
  }

  /** Publish a status-only check run update. */
  async publishStatus(
    ref: RepoRef,
    checkRunId: number,
    status: CheckRunStatus,
    conclusion?: CheckRunConclusion,
  ): Promise<CheckRun> {
    return this.update(ref, checkRunId, { status, conclusion });
  }

  /** Publish a summary as the check output without completing the run. */
  async publishSummary(ref: RepoRef, checkRunId: number, summary: string, title = 'Summary'): Promise<CheckRun> {
    return this.update(ref, checkRunId, { status: 'in_progress', output: { title, summary } });
  }

  /** Publish a repair report (after autonomous repair) on an in-progress run. */
  async publishRepairReport(
    ref: RepoRef,
    checkRunId: number,
    options: { attempts: number; patches: number; message: string; succeeded: boolean },
  ): Promise<CheckRun> {
    const summary = [
      `Repair report (attempts: ${options.attempts}, patches: ${options.patches})`,
      options.message,
    ].join('\n');
    return this.update(ref, checkRunId, {
      status: 'in_progress',
      output: { title: options.succeeded ? 'Repair succeeded' : 'Repair incomplete', summary },
    });
  }

  /** Publish verification results and complete the run. */
  async publishVerification(
    ref: RepoRef,
    checkRunId: number,
    options: {
      succeeded: boolean;
      summary: string;
      annotations?: readonly CheckAnnotation[];
    },
  ): Promise<CheckRun> {
    return this.update(ref, checkRunId, {
      status: 'completed',
      conclusion: options.succeeded ? 'success' : 'failure',
      output: {
        title: options.succeeded ? 'Verification passed' : 'Verification failed',
        summary: options.summary,
        ...(options.annotations && options.annotations.length > 0 ? { annotations: options.annotations } : {}),
      },
    });
  }
}

function serializeOutput(output: CheckRunOutput): Record<string, unknown> {
  const serialized: Record<string, unknown> = { summary: output.summary };
  if (output.title !== undefined) serialized['title'] = output.title;
  if (output.text !== undefined) serialized['text'] = output.text;
  if (output.annotations !== undefined) {
    serialized['annotations'] = output.annotations.map((a) => ({
      path: a.path,
      start_line: a.startLine,
      end_line: a.endLine,
      annotation_level: a.annotationLevel,
      message: a.message,
      ...(a.startColumn !== undefined ? { start_column: a.startColumn } : {}),
      ...(a.endColumn !== undefined ? { end_column: a.endColumn } : {}),
      ...(a.title !== undefined ? { title: a.title } : {}),
    }));
  }
  return serialized;
}

function normalizeCheckRun(raw: Record<string, unknown>): CheckRun {
  const status = (['queued', 'in_progress', 'completed'] as const).includes(raw['status'] as never)
    ? (raw['status'] as CheckRunStatus)
    : 'queued';
  const conclusion = typeof raw['conclusion'] === 'string' ? (raw['conclusion'] as CheckRunConclusion) : null;
  return {
    id: typeof raw['id'] === 'number' ? raw['id'] : 0,
    name: typeof raw['name'] === 'string' ? raw['name'] : '',
    headSha: typeof raw['head_sha'] === 'string' ? raw['head_sha'] : '',
    status,
    conclusion,
    startedAt: typeof raw['started_at'] === 'string' ? raw['started_at'] : undefined,
    completedAt: typeof raw['completed_at'] === 'string' ? raw['completed_at'] : undefined,
    htmlUrl: typeof raw['html_url'] === 'string' ? raw['html_url'] : undefined,
    detailsUrl: typeof raw['details_url'] === 'string' ? raw['details_url'] : undefined,
  };
}

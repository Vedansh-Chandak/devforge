/**
 * GitHub Actions integration tests (DF-021).
 *
 * Covers workflow metadata, run monitoring (polling/timeout), failure
 * analysis, re-runs, and the fix-ci repair loop. The Autonomous Agent is
 * replaced with an injectable agentFactory so the whole loop stays fast,
 * deterministic, and network-free.
 */

import { describe, expect, it } from 'vitest';
import { ActionsService } from '../src/actions.js';
import type { RepairAgent } from '../src/actions.js';
import { GitHubValidationError } from '../src/errors.js';
import { makeClient, json } from './helpers/mock.js';
import type { RepoRef } from '../src/types.js';

const REF: RepoRef = { owner: 'acme', name: 'widget' };
const RUN = '/repos/acme/widget/actions/runs/10';

function runPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 10,
    name: 'CI',
    head_branch: 'main',
    head_sha: 'deadbeef',
    run_number: 77,
    status: 'completed',
    conclusion: 'failure',
    event: 'push',
    workflow_id: 5,
    display_title: 'CI run',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T01:00:00Z',
    ...overrides,
  };
}

function jobPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 100,
    name: 'test',
    status: 'completed',
    conclusion: 'failure',
    steps: [
      { name: 'Checkout', status: 'completed', conclusion: 'success', number: 1 },
      { name: 'Run tests', status: 'completed', conclusion: 'failure', number: 2 },
    ],
    ...overrides,
  };
}

describe('ActionsService workflow metadata', () => {
  it('lists workflows', async () => {
    const { client, fetch } = makeClient({
      '/repos/acme/widget/actions/workflows?per_page=100': json([
        { id: 1, name: 'ci.yml', path: '.github/workflows/ci.yml', state: 'active' },
      ]),
    });
    const service = new ActionsService(client);
    const workflows = await service.workflows(REF);
    expect(workflows[0]?.name).toBe('ci.yml');
    expect(workflows[0]?.state).toBe('active');
    expect(fetch.requests[0]?.url).toContain('/actions/workflows');
  });

  it('gets a single workflow', async () => {
    const { client } = makeClient({
      '/repos/acme/widget/actions/workflows/5': json({ id: 5, name: 'ci.yml', path: '.github/workflows/ci.yml', state: 'active' }),
    });
    const service = new ActionsService(client);
    const workflow = await service.workflow(REF, 5);
    expect(workflow.id).toBe(5);
  });

  it('lists runs with filters', async () => {
    const { client, fetch } = makeClient({
      '/repos/acme/widget/actions/runs?per_page=100&workflow_id=5&branch=main': json([runPayload()]),
    });
    const service = new ActionsService(client);
    const runs = await service.runs(REF, { workflowId: 5, branch: 'main' });
    expect(runs[0]?.runNumber).toBe(77);
    expect(runs[0]?.conclusion).toBe('failure');
    expect(fetch.requests[0]?.url).toContain('branch=main');
  });

  it('gets a single run', async () => {
    const { client } = makeClient({ [RUN]: json(runPayload()) });
    const service = new ActionsService(client);
    const run = await service.run(REF, 10);
    expect(run.id).toBe(10);
    expect(run.status).toBe('completed');
    expect(run.displayTitle).toBe('CI run');
  });

  it('validates run ids', async () => {
    const { client } = makeClient();
    const service = new ActionsService(client);
    await expect(service.run(REF, 0)).rejects.toBeInstanceOf(GitHubValidationError);
  });

  it('fetches raw run logs as text', async () => {
    const { client } = makeClient({
      [`${RUN}/logs`]: { body: '##[section]Run tests\nerror TS1001\n##[section]Cleanup' },
    });
    const service = new ActionsService(client);
    const logs = await service.runLogs(REF, 10);
    expect(logs).toContain('error TS1001');
  });

  it('lists jobs for a run', async () => {
    const { client } = makeClient({ [`${RUN}/jobs?per_page=100`]: json([jobPayload()]) });
    const service = new ActionsService(client);
    const jobs = await service.jobs(REF, 10);
    expect(jobs[0]?.name).toBe('test');
    expect(jobs[0]?.steps).toHaveLength(2);
    expect(jobs[0]?.steps?.[1]?.conclusion).toBe('failure');
  });
});

describe('ActionsService rerun/cancel', () => {
  it('re-runs a failed workflow via POST', async () => {
    const { client, fetch } = makeClient({ [`${RUN}/rerun`]: { status: 202, body: {} } });
    const service = new ActionsService(client);
    await service.rerun(REF, 10);
    expect(fetch.lastRequest()?.method).toBe('POST');
    expect(fetch.lastRequest()?.url).toContain('/rerun');
  });

  it('cancels a workflow run', async () => {
    const { client, fetch } = makeClient({ [`${RUN}/cancel`]: { status: 202, body: {} } });
    const service = new ActionsService(client);
    await service.cancel(REF, 10);
    expect(fetch.lastRequest()?.method).toBe('POST');
    expect(fetch.lastRequest()?.url).toContain('/cancel');
  });
});

describe('ActionsService monitorRun', () => {
  it('completes immediately when the run is already terminal', async () => {
    const { client } = makeClient({ [RUN]: json(runPayload({ status: 'completed', conclusion: 'success' })) });
    const service = new ActionsService(client);
    const monitored = await service.monitorRun(REF, 10, { sleep: async () => {}, now: () => 0 });
    expect(monitored.completed).toBe(true);
    expect(monitored.run.conclusion).toBe('success');
  });

  it('polls until the run completes', async () => {
    const { client, fetch } = makeClient();
    let calls = 0;
    fetch.on(RUN, () => {
      calls += 1;
      if (calls < 3) return { status: 200, body: runPayload({ status: 'in_progress', conclusion: null }) };
      return { status: 200, body: runPayload({ status: 'completed', conclusion: 'success' }) };
    });
    const service = new ActionsService(client);
    const monitored = await service.monitorRun(REF, 10, {
      sleep: async () => {},
      now: () => 0,
      pollIntervalMs: 1,
    });
    expect(calls).toBe(3);
    expect(monitored.completed).toBe(true);
    expect(monitored.run.conclusion).toBe('success');
  });

  it('gives up when the timeout elapses', async () => {
    const { client, fetch } = makeClient();
    fetch.on(RUN, () => ({ status: 200, body: runPayload({ status: 'in_progress', conclusion: null }) }));
    const service = new ActionsService(client);
    let t = 0;
    const monitored = await service.monitorRun(REF, 10, {
      sleep: async () => {},
      now: () => {
        t += 1;
        return t;
      },
      timeoutMs: 0,
      pollIntervalMs: 1,
    });
    expect(monitored.completed).toBe(false);
    expect(monitored.run.status).toBe('in_progress');
  });
});

describe('ActionsService analyzeFailure', () => {
  it('identifies failed jobs and steps with a log snippet', async () => {
    const { client } = makeClient({
      [`${RUN}/jobs?per_page=100`]: json([jobPayload()]),
      [`${RUN}/logs`]: { body: 'Run tests\n##[error]boom\nCleanup' },
    });
    const service = new ActionsService(client);
    const analysis = await service.analyzeFailure(REF, JSON.parse(JSON.stringify(runPayload())) as never);
    expect(analysis.failed).toBe(true);
    expect(analysis.failedJobs).toHaveLength(1);
    expect(analysis.failedJobs[0]?.failedSteps).toEqual(['Run tests']);
    expect(analysis.failedJobs[0]?.logSnippet).toContain('##[error]boom');
    expect(analysis.summary).toContain('failed');
  });

  it('reports success without failing jobs', async () => {
    const { client } = makeClient({
      [`${RUN}/jobs?per_page=100`]: json([{ id: 1, name: 'test', status: 'completed', conclusion: 'success', steps: [] }]),
    });
    const service = new ActionsService(client);
    const analysis = await service.analyzeFailure(REF, runPayload({ conclusion: 'success' }) as never);
    expect(analysis.failed).toBe(false);
    expect(analysis.summary).toContain('success');
  });

  it('tolerates unreadable logs', async () => {
    const { client } = makeClient({
      [`${RUN}/jobs?per_page=100`]: json([jobPayload()]),
      [`${RUN}/logs`]: { status: 500, body: {} },
    });
    const service = new ActionsService(client);
    const analysis = await service.analyzeFailure(REF, runPayload() as never);
    expect(analysis.failedJobs[0]?.logSnippet).toBe('');
  });
});

describe('ActionsService fixCi', () => {
  function repairAgent(outcome: string, message: string, patches: number): RepairAgent {
    return { run: async () => ({ outcome, terminationMessage: message, patchesGenerated: patches }) };
  }

  it('passes immediately when the initial run succeeds', async () => {
    const { client } = makeClient({ [RUN]: json(runPayload({ conclusion: 'success' })) });
    const service = new ActionsService(client);
    const result = await service.fixCi(REF, 10, {
      workspaceRoot: '/ws',
      agentFactory: () => repairAgent('SUCCESS', 'all good', 0),
    });
    expect(result.succeeded).toBe(true);
    expect(result.attempts).toHaveLength(1);
    expect(result.repairPatches).toBe(0);
  });

  it('repairs once and re-runs until success', async () => {
    const { client, fetch } = makeClient({ [RUN]: json(runPayload({ conclusion: 'failure' })) });
    let repairs = 0;
    let postRerunRun = false;
    fetch.on(`${RUN}/jobs?per_page=100`, json([jobPayload()]));
    fetch.on(`${RUN}/logs`, { body: 'Run tests\n##[error]fixed next time' });
    fetch.on(`${RUN}/rerun`, { status: 202, body: {} });

    const service = new ActionsService(client);
    // After rerun, the next read returns success.
    const originalRun = fetch.requests.length;
    void originalRun;
    let runReads = 0;
    fetch.on(RUN, () => {
      runReads += 1;
      if (runReads > 1) return { status: 200, body: runPayload({ conclusion: 'success' }) };
      return { status: 200, body: runPayload({ conclusion: 'failure' }) };
    });

    const result = await service.fixCi(REF, 10, {
      workspaceRoot: '/ws',
      agentFactory: (goal) => {
        repairs += 1;
        expect(goal).toContain('Fix the failing CI');
        return repairAgent('SUCCESS', 'patched', 2);
      },
      sleep: async () => {},
      now: () => 0,
    });
    expect(repairs).toBe(1);
    expect(result.succeeded).toBe(true);
    expect(result.attempts).toHaveLength(2);
    expect(result.repairPatches).toBe(2);
    const lastAttempt = result.attempts[result.attempts.length - 1];
    expect(lastAttempt?.repaired).toBe(true);
  });

  it('stops after configured retries without success', async () => {
    const { client, fetch } = makeClient();
    fetch.on(RUN, () => ({ status: 200, body: runPayload({ conclusion: 'failure' }) }));
    fetch.on(`${RUN}/jobs?per_page=100`, json([jobPayload()]));
    fetch.on(`${RUN}/logs`, { body: 'Run tests\n##[error]still failing' });
    fetch.on(`${RUN}/rerun`, { status: 202, body: {} });

    const service = new ActionsService(client);
    const result = await service.fixCi(REF, 10, {
      workspaceRoot: '/ws',
      maxRetries: 2,
      agentFactory: () => repairAgent('FAILED', 'could not fix', 1),
      sleep: async () => {},
      now: () => 0,
    });
    expect(result.succeeded).toBe(false);
    expect(result.attempts).toHaveLength(3);
    expect(result.stoppedAfterRetries).toBe(true);
    expect(result.repairPatches).toBe(2);
  });

  it('supports maxRetries=0 (no repair cycles)', async () => {
    const { client } = makeClient({ [RUN]: json(runPayload({ conclusion: 'failure' })) });
    const service = new ActionsService(client);
    const result = await service.fixCi(REF, 10, {
      workspaceRoot: '/ws',
      maxRetries: 0,
      agentFactory: () => repairAgent('SUCCESS', 'x', 0),
    });
    expect(result.succeeded).toBe(false);
    expect(result.attempts).toHaveLength(1);
    expect(result.stoppedAfterRetries).toBe(true);
    expect(result.repairPatches).toBe(0);
  });

  it('rejects negative maxRetries', async () => {
    const { client } = makeClient();
    const service = new ActionsService(client);
    await expect(
      service.fixCi(REF, 10, { workspaceRoot: '/ws', maxRetries: -1, agentFactory: () => repairAgent('SUCCESS', 'x', 0) }),
    ).rejects.toBeInstanceOf(GitHubValidationError);
  });

  it('handles a throwing repair agent gracefully', async () => {
    const { client, fetch } = makeClient();
    fetch.on(RUN, () => ({ status: 200, body: runPayload({ conclusion: 'failure' }) }));
    fetch.on(`${RUN}/jobs?per_page=100`, json([jobPayload()]));
    fetch.on(`${RUN}/rerun`, { status: 202, body: {} });

    const service = new ActionsService(client);
    const result = await service.fixCi(REF, 10, {
      workspaceRoot: '/ws',
      maxRetries: 1,
      agentFactory: () => ({
        run: async () => {
          throw new Error('agent crashed');
        },
      }),
      sleep: async () => {},
      now: () => 0,
    });
    expect(result.repairPatches).toBe(0);
    expect(result.attempts[1]?.message).toContain('agent threw');
  });

  it('migrates between initial in-progress runs by polling', async () => {
    const { client, fetch } = makeClient();
    let reads = 0;
    fetch.on(RUN, () => {
      reads += 1;
      if (reads === 1) return { status: 200, body: runPayload({ status: 'in_progress', conclusion: null }) };
      return { status: 200, body: runPayload({ conclusion: 'failure' }) };
    });
    fetch.on(`${RUN}/jobs?per_page=100`, json([jobPayload()]));
    fetch.on(`${RUN}/rerun`, { status: 202, body: {} });

    const service = new ActionsService(client);
    const result = await service.fixCi(REF, 10, {
      workspaceRoot: '/ws',
      maxRetries: 1,
      agentFactory: () => repairAgent('SUCCESS', 'ok', 1),
      sleep: async () => {},
      now: () => 0,
    });
    // Initial read + monitor first read + post-rerun monitor first read.
    expect(reads).toBeGreaterThanOrEqual(3);
    expect(result.finalConclusion).toBe('failure');
    expect(result.attempts[0]?.status).toBe('completed');
  });
});
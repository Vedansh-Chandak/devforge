/**
 * Checks API tests (DF-021).
 *
 * Covers creating, updating, reading check runs, output serialization, and the
 * progress/status/summary/repair/verification publishers.
 */

import { describe, expect, it } from 'vitest';
import { ChecksService } from '../src/checks.js';
import { GitHubValidationError } from '../src/errors.js';
import { makeClient, json } from './helpers/mock.js';
import type { RepoRef } from '../src/types.js';

const REF: RepoRef = { owner: 'acme', name: 'widget' };

function checkPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 300,
    name: 'devforge',
    head_sha: 'deadbeef',
    status: 'in_progress',
    conclusion: null,
    started_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('ChecksService create', () => {
  it('creates a check run with name, head sha, and status', async () => {
    const { client, fetch } = makeClient({
      '/repos/acme/widget/check-runs': json(checkPayload({ id: 301 })),
    });
    const service = new ChecksService(client);
    const check = await service.create(REF, { name: 'devforge', headSha: 'deadbeef', status: 'queued' });
    expect(check.id).toBe(301);
    const body = JSON.parse(fetch.lastRequest()?.body ?? '{}') as Record<string, unknown>;
    expect(body['name']).toBe('devforge');
    expect(body['head_sha']).toBe('deadbeef');
    expect(body['status']).toBe('queued');
  });

  it('includes conclusion, details URL, and serialized output', async () => {
    const { client, fetch } = makeClient({ '/repos/acme/widget/check-runs': json(checkPayload()) });
    const service = new ChecksService(client);
    await service.create(REF, {
      name: 'n',
      headSha: 'hhhh',
      status: 'completed',
      conclusion: 'failure',
      detailsUrl: 'https://example.com/logs',
      output: {
        title: 'Build',
        summary: 'Failed at step X',
        annotations: [
          { path: 'src/a.ts', startLine: 1, endLine: 2, annotationLevel: 'failure', message: 'boom', title: 't' },
        ],
      },
    });
    const body = JSON.parse(fetch.lastRequest()?.body ?? '{}') as Record<string, unknown>;
    expect(body['conclusion']).toBe('failure');
    expect(body['details_url']).toBe('https://example.com/logs');
    const output = body['output'] as Record<string, unknown>;
    expect(output['summary']).toBe('Failed at step X');
    const annotations = output['annotations'] as Array<Record<string, unknown>>;
    expect(annotations[0]?.['start_line']).toBe(1);
    expect(annotations[0]?.['annotation_level']).toBe('failure');
  });

  it('rejects empty names and head shas', async () => {
    const { client } = makeClient();
    const service = new ChecksService(client);
    await expect(service.create(REF, { name: '', headSha: 'h', status: 'queued' })).rejects.toBeInstanceOf(GitHubValidationError);
    await expect(service.create(REF, { name: 'n', headSha: '', status: 'queued' })).rejects.toBeInstanceOf(GitHubValidationError);
  });
});

describe('ChecksService update & get', () => {
  it('updates status and conclusion with PATCH', async () => {
    const { client, fetch } = makeClient({
      '/repos/acme/widget/check-runs/300': json(checkPayload({ status: 'completed', conclusion: 'success' })),
    });
    const service = new ChecksService(client);
    const check = await service.update(REF, 300, { status: 'completed', conclusion: 'success' });
    expect(fetch.lastRequest()?.method).toBe('PATCH');
    expect(check.conclusion).toBe('success');
    const body = JSON.parse(fetch.lastRequest()?.body ?? '{}') as Record<string, unknown>;
    expect(body['conclusion']).toBe('success');
  });

  it('gets a check run by id', async () => {
    const { client } = makeClient({
      '/repos/acme/widget/check-runs/300': json(checkPayload({ status: 'completed', conclusion: 'neutral' })),
    });
    const service = new ChecksService(client);
    const check = await service.get(REF, 300);
    expect(check.conclusion).toBe('neutral');
    expect(check.status).toBe('completed');
  });

  it('rejects invalid check run ids', async () => {
    const { client } = makeClient();
    const service = new ChecksService(client);
    await expect(service.get(REF, 0)).rejects.toBeInstanceOf(GitHubValidationError);
    await expect(service.update(REF, -1, { status: 'queued' })).rejects.toBeInstanceOf(GitHubValidationError);
  });
});

describe('ChecksService publishers', () => {
  it('publishes progress as an in-progress run with progress text', async () => {
    const { client, fetch } = makeClient({ '/repos/acme/widget/check-runs': json(checkPayload({ id: 400 })) });
    const service = new ChecksService(client);
    const check = await service.publishProgress(REF, {
      name: 'devforge-plan',
      headSha: 'deadbeef',
      message: 'Planning…',
      progress: 25,
    });
    expect(check.status).toBe('in_progress');
    const body = JSON.parse(fetch.lastRequest()?.body ?? '{}') as Record<string, unknown>;
    const output = body['output'] as Record<string, unknown>;
    expect(output['title']).toBe('In progress');
    expect(output['text']).toBe('Progress: 25%');
  });

  it('publishes a status update', async () => {
    const { client, fetch } = makeClient({
      '/repos/acme/widget/check-runs/400': json(checkPayload({ status: 'completed', conclusion: 'failure' })),
    });
    const service = new ChecksService(client);
    await service.publishStatus(REF, 400, 'completed', 'failure');
    const body = JSON.parse(fetch.lastRequest()?.body ?? '{}') as Record<string, unknown>;
    expect(body['status']).toBe('completed');
    expect(body['conclusion']).toBe('failure');
  });

  it('publishes a summary without completing the run', async () => {
    const { client, fetch } = makeClient({
      '/repos/acme/widget/check-runs/400': json(checkPayload()),
    });
    const service = new ChecksService(client);
    await service.publishSummary(REF, 400, 'Found 3 issues');
    const body = JSON.parse(fetch.lastRequest()?.body ?? '{}') as Record<string, unknown>;
    expect(body['status']).toBe('in_progress');
    const output = body['output'] as Record<string, unknown>;
    expect(output['summary']).toBe('Found 3 issues');
  });

  it('publishes a repair report with attempt/patches summary', async () => {
    const { client, fetch } = makeClient({
      '/repos/acme/widget/check-runs/400': json(checkPayload()),
    });
    const service = new ChecksService(client);
    await service.publishRepairReport(REF, 400, {
      attempts: 2,
      patches: 3,
      message: 'Fixed the test',
      succeeded: true,
    });
    const body = JSON.parse(fetch.lastRequest()?.body ?? '{}') as Record<string, unknown>;
    const output = body['output'] as Record<string, unknown>;
    expect(output['title']).toBe('Repair succeeded');
    expect(output['summary']).toContain('attempts: 2');
    expect(output['summary']).toContain('patches: 3');
  });

  it('completes a run with success when verification passes', async () => {
    const { client, fetch } = makeClient({
      '/repos/acme/widget/check-runs/400': json(checkPayload({ status: 'completed', conclusion: 'success' })),
    });
    const service = new ChecksService(client);
    await service.publishVerification(REF, 400, { succeeded: true, summary: 'All green' });
    const body = JSON.parse(fetch.lastRequest()?.body ?? '{}') as Record<string, unknown>;
    expect(body['status']).toBe('completed');
    expect(body['conclusion']).toBe('success');
    const output = body['output'] as Record<string, unknown>;
    expect(output['title']).toBe('Verification passed');
  });

  it('completes a run with failure conclusion and annotations', async () => {
    const { client, fetch } = makeClient({
      '/repos/acme/widget/check-runs/400': json(checkPayload({ status: 'completed', conclusion: 'failure' })),
    });
    const service = new ChecksService(client);
    const annotations = [
      { path: 'src/a.ts', startLine: 1, endLine: 1, annotationLevel: 'failure' as const, message: 'Type error' },
    ];
    await service.publishVerification(REF, 400, { succeeded: false, summary: 'Failed', annotations });
    const body = JSON.parse(fetch.lastRequest()?.body ?? '{}') as Record<string, unknown>;
    expect(body['conclusion']).toBe('failure');
    const output = body['output'] as Record<string, unknown>;
    expect((output['annotations'] as Array<Record<string, unknown>>)).toHaveLength(1);
  });

  it('omits annotations when none are supplied', async () => {
    const { client, fetch } = makeClient({
      '/repos/acme/widget/check-runs/400': json(checkPayload({ status: 'completed', conclusion: 'success' })),
    });
    const service = new ChecksService(client);
    await service.publishVerification(REF, 400, { succeeded: true, summary: 'ok' });
    const body = JSON.parse(fetch.lastRequest()?.body ?? '{}') as Record<string, unknown>;
    const output = body['output'] as Record<string, unknown>;
    expect('annotations' in output).toBe(false);
  });
});
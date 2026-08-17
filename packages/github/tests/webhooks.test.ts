/**
 * Webhook tests (DF-021).
 *
 * Covers payload parsing for every supported event, HMAC signature
 * verification, unsupported events, malformed payloads, and the event-bus
 * translation helpers.
 */

import { describe, expect, it } from 'vitest';
import * as crypto from 'node:crypto';
import {
  parseWebhook,
  verifySignature,
  toGitHubEvent,
  isSupportedEvent,
} from '../src/webhooks.js';
import { GitHubWebhookError } from '../src/errors.js';

function signature(payload: string, secret: string): string {
  return `sha256=${crypto.createHmac('sha256', secret).update(payload, 'utf-8').digest('hex')}`;
}

const PAYLOAD = JSON.stringify({ action: 'opened', number: 5, repository: { full_name: 'a/b' } });

describe('parseWebhook', () => {
  it('parses a supported event with an action', () => {
    const event = parseWebhook(PAYLOAD, {
      'x-github-event': 'pull_request',
      'x-github-delivery': 'delivery-1',
    });
    expect(event.name).toBe('pull_request');
    expect(event.action).toBe('opened');
    expect(event.deliveryId).toBe('delivery-1');
    expect((event.payload as Record<string, unknown>)['number']).toBe(5);
  });

  it('parses every supported event name', () => {
    const events = ['push', 'pull_request', 'issue', 'workflow_run', 'check_suite', 'check_run', 'repository_dispatch'];
    for (const name of events) {
      const event = parseWebhook(PAYLOAD, { 'x-github-event': name });
      expect(event.name).toBe(name);
    }
  });

  it('omits the action when absent from the payload', () => {
    const event = parseWebhook('{"ref":"main"}', { 'x-github-event': 'push' });
    expect(event.action).toBeUndefined();
  });

  it('captures the signature header', () => {
    const sig = signature(PAYLOAD, 'secret');
    const event = parseWebhook(PAYLOAD, { 'x-github-event': 'push', 'x-hub-signature-256': sig });
    expect(event.signature).toBe(sig);
  });

  it('rejects invalid JSON', () => {
    expect(() => parseWebhook('not json', { 'x-github-event': 'push' })).toThrow(GitHubWebhookError);
  });

  it('rejects non-object payloads', () => {
    expect(() => parseWebhook('"just a string"', { 'x-github-event': 'push' })).toThrow(GitHubWebhookError);
  });

  it('rejects arrays as payloads', () => {
    expect(() => parseWebhook('[1,2,3]', { 'x-github-event': 'push' })).toThrow(GitHubWebhookError);
  });

  it('rejects a missing event header', () => {
    expect(() => parseWebhook(PAYLOAD, {})).toThrow(GitHubWebhookError);
  });

  it('rejects unsupported events', () => {
    expect(() => parseWebhook(PAYLOAD, { 'x-github-event': 'gollum' })).toThrow(GitHubWebhookError);
  });

  it('verifies a valid signature when a secret is configured', () => {
    const sig = signature(PAYLOAD, 'topsecret');
    expect(() =>
      parseWebhook(PAYLOAD, { 'x-github-event': 'push', 'x-hub-signature-256': sig }, { verifySecret: 'topsecret' }),
    ).not.toThrow();
  });

  it('rejects an invalid signature when a secret is configured', () => {
    expect(() =>
      parseWebhook(PAYLOAD, { 'x-github-event': 'push', 'x-hub-signature-256': signature(PAYLOAD, 'wrong') }, { verifySecret: 'right' }),
    ).toThrow(GitHubWebhookError);
  });

  it('rejects a missing signature when a secret is configured', () => {
    expect(() =>
      parseWebhook(PAYLOAD, { 'x-github-event': 'push' }, { verifySecret: 'secret' }),
    ).toThrow(GitHubWebhookError);
  });

  it('falls back to the legacy x-hub-signature header for verification', () => {
    const sig = signature(PAYLOAD, 'legacy');
    expect(() =>
      parseWebhook(PAYLOAD, { 'x-github-event': 'push', 'x-hub-signature': sig }, { verifySecret: 'legacy' }),
    ).not.toThrow();
  });
});

describe('verifySignature', () => {
  const sig = signature(PAYLOAD, 'secret');

  it('returns true for a matching signature', () => {
    expect(verifySignature(PAYLOAD, sig, 'secret')).toBe(true);
  });

  it('returns false for a mismatched secret', () => {
    expect(verifySignature(PAYLOAD, sig, 'other')).toBe(false);
  });

  it('returns false for a tampered payload', () => {
    expect(verifySignature(PAYLOAD + 'x', sig, 'secret')).toBe(false);
  });

  it('returns false for a missing signature or secret', () => {
    expect(verifySignature(PAYLOAD, '', 'secret')).toBe(false);
    expect(verifySignature(PAYLOAD, sig, '')).toBe(false);
  });

  it('is constant-time safe against length mismatch', () => {
    expect(verifySignature(PAYLOAD, 'short', 'secret')).toBe(false);
  });

  it('is deterministic for the same inputs', () => {
    expect(verifySignature(PAYLOAD, sig, 'secret')).toBe(true);
    expect(verifySignature(PAYLOAD, sig, 'secret')).toBe(true);
  });
});

describe('toGitHubEvent & isSupportedEvent', () => {
  it('translates a parsed webhook into a bus event', () => {
    const event = parseWebhook(PAYLOAD, { 'x-github-event': 'issue' });
    const bus = toGitHubEvent(event);
    expect(bus.type).toBe('issue');
    expect(bus.action).toBe('opened');
    expect(bus.payload).toBe(event.payload);
  });

  it('recognizes supported events', () => {
    for (const name of ['push', 'pull_request', 'issue', 'workflow_run', 'check_suite', 'check_run', 'repository_dispatch']) {
      expect(isSupportedEvent(name)).toBe(true);
    }
  });

  it('rejects unsupported event names', () => {
    expect(isSupportedEvent('deployment')).toBe(false);
    expect(isSupportedEvent('')).toBe(false);
  });
});
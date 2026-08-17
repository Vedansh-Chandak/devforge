/**
 * @devforge/github — Webhooks (DF-021).
 *
 * Parses GitHub webhook deliveries for the supported event types and verifies
 * their HMAC signatures. Parsing is pure; verification uses `node:crypto`.
 *
 * Supported events: push, pull_request, issue, workflow_run, check_suite,
 * check_run, repository_dispatch.
 */

import * as crypto from 'node:crypto';
import type { WebhookEvent, WebhookEventName } from './types.js';
import { GitHubWebhookError } from './errors.js';

const SUPPORTED_EVENTS: ReadonlySet<string> = new Set([
  'push',
  'pull_request',
  'issue',
  'workflow_run',
  'check_suite',
  'check_run',
  'repository_dispatch',
]);

/** Headers that identify a webhook delivery. */
export interface WebhookHeaders {
  readonly 'x-github-event'?: string;
  readonly 'x-github-delivery'?: string;
  readonly 'x-hub-signature-256'?: string;
  readonly 'x-hub-signature'?: string;
}

/** Verify an HMAC-SHA256 webhook signature. */
export function verifySignature(
  payload: string,
  signature: string,
  secret: string,
): boolean {
  if (!signature || !secret) return false;
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(payload, 'utf-8').digest('hex')}`;
  return timingSafeEqual(expected, signature);
}

function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Parse a raw webhook payload into a typed {@link WebhookEvent}. The event
 * name is taken from the `x-github-event` header and must be supported.
 */
export function parseWebhook(
  payload: string,
  headers: WebhookHeaders = {},
  options: { verifySecret?: string } = {},
): WebhookEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new GitHubWebhookError('Webhook payload is not valid JSON', {
      code: 'WEBHOOK_VERIFICATION_FAILED',
    });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new GitHubWebhookError('Webhook payload must be a JSON object', {
      code: 'WEBHOOK_VERIFICATION_FAILED',
    });
  }

  const eventName = headers['x-github-event'];
  if (!eventName) {
    throw new GitHubWebhookError('Missing x-github-event header', {
      code: 'WEBHOOK_VERIFICATION_FAILED',
    });
  }
  if (!SUPPORTED_EVENTS.has(eventName)) {
    throw new GitHubWebhookError(`Unsupported webhook event: ${eventName}`, {
      code: 'WEBHOOK_UNSUPPORTED',
    });
  }

  if (options.verifySecret) {
    const signature = headers['x-hub-signature-256'] ?? headers['x-hub-signature'];
    if (!signature || !verifySignature(payload, signature, options.verifySecret)) {
      throw new GitHubWebhookError('Webhook signature verification failed', {
        code: 'WEBHOOK_VERIFICATION_FAILED',
      });
    }
  }

  const record = parsed as Record<string, unknown>;
  const action = typeof record['action'] === 'string' ? record['action'] : undefined;
  return {
    name: eventName as WebhookEventName,
    action,
    payload: record,
    signature: headers['x-hub-signature-256'],
    deliveryId: headers['x-github-delivery'],
  };
}

/** A parsed event shaped for the event bus. */
export function toGitHubEvent(event: WebhookEvent): {
  type: WebhookEventName;
  action?: string;
  payload: Record<string, unknown>;
} {
  return { type: event.name, action: event.action, payload: event.payload };
}

/** Whether an event name is supported by the webhook system. */
export function isSupportedEvent(name: string): name is WebhookEventName {
  return SUPPORTED_EVENTS.has(name);
}

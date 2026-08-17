/**
 * @devforge/github — Events (DF-021).
 *
 * A small typed event bus for webhook/event dispatch. Handlers can be
 * registered per event type and action; dispatch is synchronous and
 * deterministic. Listeners receive a snapshot of the event payload.
 */

import type { GitHubEvent, WebhookEventName } from './types.js';

/** A handler receiving an emitted event. */
export type EventHandler = (event: GitHubEvent) => void | Promise<void>;

/** Filters for handler registration. */
export interface EventFilter {
  readonly type?: WebhookEventName;
  readonly action?: string;
}

/** The event bus. */
export class EventBus {
  private readonly handlers: Array<{ filter: EventFilter; handler: EventHandler }> = [];
  private readonly emitted: GitHubEvent[] = [];

  /** Register a handler. Returns an unsubscribe function. */
  on(filter: EventFilter, handler: EventHandler): () => void {
    this.handlers.push({ filter, handler });
    return () => {
      const index = this.handlers.findIndex((entry) => entry.handler === handler);
      if (index >= 0) this.handlers.splice(index, 1);
    };
  }

  /** Register a catch-all handler. */
  onAny(handler: EventHandler): () => void {
    return this.on({}, handler);
  }

  /** Synchronously dispatch an event to all matching handlers. */
  emit(event: GitHubEvent): void {
    this.emitted.push(event);
    const matches = this.handlers.filter((entry) => matchesFilter(entry.filter, event));
    for (const entry of matches) {
      void entry.handler(event);
    }
  }

  /** Asynchronously dispatch and await all handlers. */
  async emitAsync(event: GitHubEvent): Promise<void> {
    this.emitted.push(event);
    const matches = this.handlers.filter((entry) => matchesFilter(entry.filter, event));
    await Promise.all(matches.map((entry) => entry.handler(event)));
  }

  /** All events emitted since construction (or since {@link clear}). */
  history(): readonly GitHubEvent[] {
    return [...this.emitted];
  }

  /** Clear the emit history (handlers remain registered). */
  clear(): void {
    this.emitted.length = 0;
  }

  /** Number of registered handlers. */
  get handlerCount(): number {
    return this.handlers.length;
  }
}

function matchesFilter(filter: EventFilter, event: GitHubEvent): boolean {
  if (filter.type !== undefined && filter.type !== event.type) return false;
  if (filter.action !== undefined && filter.action !== event.action) return false;
  return true;
}

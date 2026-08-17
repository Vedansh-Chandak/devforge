/**
 * @devforge/multi-agent — Shared conversation (DF-022).
 *
 * An append-only log of structured messages shared by every agent in a run.
 * Messages are stamped with a monotonic index in post order and filtered via
 * deterministic queries. The conversation is the single source of truth for
 * the final report timeline.
 */

import type { AgentRole, Message, MessageType } from './types.js';
import { buildMessage, type MessageDraft } from './message.js';

/** Listener invoked for every posted message (in post order). */
export type ConversationListener = (message: Message) => void;

/** Options controlling conversation behaviour. */
export interface ConversationOptions {
  readonly listener?: ConversationListener;
  readonly startIndex?: number;
}

/** Shared, deterministic, append-only message log. */
export class Conversation {
  readonly runId: string;
  private readonly messages: Message[] = [];
  private readonly listeners: ConversationListener[] = [];
  private nextIndex: number;

  constructor(runId: string, options: ConversationOptions = {}) {
    this.runId = runId;
    this.nextIndex = options.startIndex ?? 0;
    if (options.listener) {
      this.listeners.push(options.listener);
    }
  }

  /** Append a draft, stamping its index and id deterministically. */
  post(draft: MessageDraft): Message {
    const message = buildMessage(this.runId, this.nextIndex, draft);
    this.nextIndex += 1;
    this.messages.push(message);
    for (const listener of this.listeners) {
      listener(message);
    }
    return message;
  }

  /** All messages, in post order. */
  all(): readonly Message[] {
    return [...this.messages];
  }

  /** Number of posted messages. */
  get size(): number {
    return this.messages.length;
  }

  /** Messages matching a type. */
  byType(type: MessageType): readonly Message[] {
    return this.messages.filter((message) => message.type === type);
  }

  /** Messages mentioning a task, in post order. */
  byTask(taskId: string): readonly Message[] {
    return this.messages.filter((message) => message.taskId === taskId);
  }

  /** Messages posted by a role, in post order. */
  byRole(role: AgentRole): readonly Message[] {
    return this.messages.filter((message) => message.role === role);
  }

  /** The most recent message, if any. */
  last(): Message | undefined {
    return this.messages[this.messages.length - 1];
  }

  /** Subscribe to future messages. Returns an unsubscribe function. */
  subscribe(listener: ConversationListener): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index >= 0) {
        this.listeners.splice(index, 1);
      }
    };
  }

  /** Remove all messages (used between phases in tests). */
  clear(): void {
    this.messages.length = 0;
    this.nextIndex = 0;
  }
}

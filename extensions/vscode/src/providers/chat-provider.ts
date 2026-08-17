/**
 * @devforge/vscode-extension — Chat provider (DF-020).
 *
 * Implements the Chat panel as a `WebviewViewProvider`. Message storage and
 * HTML rendering are vscode-free and fully unit-testable; the provider binds
 * them to a webview view.
 */

import type * as vscode from 'vscode';

/** A single chat message. */
export interface ChatMessage {
  readonly role: 'user' | 'assistant' | 'system';
  readonly content: string;
  readonly timestamp: number;
}

/** Interface the commands use to append output to the chat panel. */
export interface ChatView {
  /** Append a message to the chat. */
  append(role: ChatMessage['role'], content: string): void;
  /** Clear all messages. */
  clear(): void;
  /** All messages, in order. */
  readonly messages: readonly ChatMessage[];
  /** Reveal the chat view. */
  show(): Promise<void>;
}

/** Pure chat model (no vscode imports). */
export class ChatModel {
  private readonly messages_: ChatMessage[] = [];
  private readonly now: () => number;

  constructor(now?: () => number) {
    this.now = now ?? (() => Date.now());
  }

  /** All messages in chronological order. */
  get messages(): readonly ChatMessage[] {
    return this.messages_;
  }

  get size(): number {
    return this.messages_.length;
  }

  /** Append a message. */
  append(role: ChatMessage['role'], content: string): ChatMessage {
    const message: ChatMessage = { role, content, timestamp: this.now() };
    this.messages_.push(message);
    return message;
  }

  /** Clear all messages. */
  clear(): void {
    this.messages_.length = 0;
  }

  /** The last message, if any. */
  get last(): ChatMessage | undefined {
    return this.messages_[this.messages_.length - 1];
  }
}

/** Escape HTML special characters for safe embedding. */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Render messages to a minimal HTML body (pure, testable). */
export function renderChatHtml(messages: readonly ChatMessage[]): string {
  const roleLabel: Record<ChatMessage['role'], string> = {
    user: 'You',
    assistant: 'DevForge',
    system: 'System',
  };
  const parts = messages.map((message) => {
    const label = roleLabel[message.role];
    const body = escapeHtml(message.content);
    return `<div class="message ${message.role}"><div class="role">${label}</div><pre class="body">${body}</pre></div>`;
  });
  return `<html><head><style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); }
  .message { margin: 0.5rem 0; }
  .role { font-weight: bold; opacity: 0.8; font-size: 0.85rem; }
  pre.body { white-space: pre-wrap; word-break: break-word; background: var(--vscode-textCodeBlock-background); padding: 0.5rem; }
  </style></head><body>${parts.join('\n') || '<p>No messages yet.</p>'}</body></html>`;
}

/** Options for the chat view provider. */
export interface ChatViewProviderOptions {
  readonly vscode: typeof import('vscode');
  readonly model?: ChatModel;
}

/** A webview view provider for the DevForge chat panel. */
export class ChatViewProvider implements vscode.WebviewViewProvider, ChatView {
  private readonly vscodeNs: typeof import('vscode');
  private readonly model: ChatModel;
  private view: vscode.WebviewView | null = null;

  constructor(options: ChatViewProviderOptions) {
    this.vscodeNs = options.vscode;
    this.model = options.model ?? new ChatModel();
  }

  get messages(): readonly ChatMessage[] {
    return this.model.messages;
  }

  append(role: ChatMessage['role'], content: string): void {
    this.model.append(role, content);
    this.postMessages();
  }

  clear(): void {
    this.model.clear();
    this.postMessages();
  }

  async show(): Promise<void> {
    await this.vscodeNs.commands.executeCommand('devforge.chat.focus');
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: false };
    this.postMessages();
    webviewView.onDidDispose(() => {
      this.view = null;
    });
  }

  private postMessages(): void {
    if (!this.view) return;
    this.view.webview.html = renderChatHtml(this.model.messages);
  }
}

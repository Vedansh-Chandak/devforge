import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatModel, escapeHtml, renderChatHtml, ChatViewProvider } from '../../src/providers/chat-provider.js';
import * as vscode from '../mocks/vscode.js';

describe('ChatModel', () => {
  it('starts empty', () => {
    const model = new ChatModel();
    expect(model.size).toBe(0);
    expect(model.messages).toEqual([]);
    expect(model.last).toBeUndefined();
  });

  it('appends messages with a timestamp', () => {
    const model = new ChatModel(() => 1234);
    const message = model.append('user', 'hello');
    expect(message).toEqual({ role: 'user', content: 'hello', timestamp: 1234 });
    expect(model.size).toBe(1);
    expect(model.last).toEqual(message);
  });

  it('preserves insertion order across roles', () => {
    const model = new ChatModel(() => 0);
    model.append('user', 'q');
    model.append('assistant', 'a');
    expect(model.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('clear empties the model', () => {
    const model = new ChatModel();
    model.append('system', 'x');
    model.clear();
    expect(model.size).toBe(0);
  });

  it('uses Date.now by default', () => {
    const model = new ChatModel();
    const before = Date.now();
    const message = model.append('user', 'x');
    expect(message.timestamp).toBeGreaterThanOrEqual(before);
  });
});

describe('escapeHtml', () => {
  it('escapes angle brackets and ampersands', () => {
    expect(escapeHtml('<b>&</b>')).toBe('&lt;b&gt;&amp;&lt;/b&gt;');
  });

  it('escapes quotes', () => {
    expect(escapeHtml(`"'"`)).toBe('&quot;&#39;&quot;');
  });

  it('leaves plain text alone', () => {
    expect(escapeHtml('plain text')).toBe('plain text');
  });
});

describe('renderChatHtml', () => {
  it('renders each message with a role label', () => {
    const html = renderChatHtml([
      { role: 'user', content: 'hi', timestamp: 1 },
      { role: 'assistant', content: 'hello', timestamp: 2 },
    ]);
    expect(html).toContain('You');
    expect(html).toContain('DevForge');
    expect(html).toContain('hi');
    expect(html).toContain('hello');
  });

  it('escapes message content', () => {
    const html = renderChatHtml([{ role: 'user', content: '<script>alert(1)</script>', timestamp: 1 }]);
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('renders a placeholder for an empty chat', () => {
    expect(renderChatHtml([])).toContain('No messages yet.');
  });

  it('labels system messages as System', () => {
    const html = renderChatHtml([{ role: 'system', content: 'boot', timestamp: 1 }]);
    expect(html).toContain('System');
  });
});

describe('ChatViewProvider', () => {
  beforeEach(() => vscode.__resetMocks());

  function makeProvider(): ChatViewProvider {
    return new ChatViewProvider({ vscode: vscode as unknown as typeof import('vscode') });
  }

  it('exposes messages through the ChatView surface', () => {
    const provider = makeProvider();
    provider.append('user', 'q');
    expect(provider.messages).toHaveLength(1);
    expect(provider.messages[0]?.content).toBe('q');
  });

  it('clear empties messages', () => {
    const provider = makeProvider();
    provider.append('user', 'q');
    provider.clear();
    expect(provider.messages).toHaveLength(0);
  });

  it('show focuses the chat view', async () => {
    const provider = makeProvider();
    const executed = vi.fn();
    vscode.commands.registerCommand('devforge.chat.focus', () => { executed('devforge.chat.focus'); });
    await provider.show();
    expect(executed).toHaveBeenCalled();
  });

  it('resolveWebviewView wires html and disposes cleanly', () => {
    const provider = makeProvider();
    provider.append('user', 'hello');
    const view = new vscode.WebviewView();
    provider.resolveWebviewView(view as never);
    expect(view.webview.html).toContain('hello');
    expect(view.webview.options).toEqual({ enableScripts: false });
  });

  it('resolveWebviewView clears the html on dispose', () => {
    const provider = makeProvider();
    provider.append('user', 'before');
    const view = new vscode.WebviewView();
    provider.resolveWebviewView(view as never);
    expect(view.webview.html).toContain('before');
    view.__fireDispose();
    provider.append('user', 'after');
    expect(provider.messages).toHaveLength(2);
    expect(view.webview.html).toContain('before');
  });
});

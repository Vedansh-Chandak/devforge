import { describe, it, expect, vi } from 'vitest';
import { parseSse } from '../sse.js';
import type { SseRecord } from '../sse.js';

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

async function parseOne(chunks: string[]): Promise<SseRecord[]> {
  async function* bytes(): AsyncGenerator<Uint8Array> {
    for (const chunk of chunks) yield encode(chunk);
  }
  const records: SseRecord[] = [];
  for await (const record of parseSse(bytes())) records.push(record);
  return records;
}

describe('parseSse', () => {
  it('parses a single data frame', async () => {
    const records = await parseOne(['data: hello\n\n']);
    expect(records).toEqual([{ data: 'hello' }]);
  });

  it('parses multiple frames delivered in one chunk', async () => {
    const records = await parseOne(['data: one\n\ndata: two\n\ndata: three\n\n']);
    expect(records.map((r) => r.data)).toEqual(['one', 'two', 'three']);
  });

  it('splits frames across arbitrary chunk boundaries', async () => {
    const records = await parseOne([
      'data: hel',
      'lo world\n\n',
      'data: second',
      ' frame\n\n',
    ]);
    expect(records.map((r) => r.data)).toEqual(['hello world', 'second frame']);
  });

  it('preserves the event name', async () => {
    const records = await parseOne([
      'event: content_block_delta\ndata: {"x":1}\n\n',
    ]);
    expect(records).toEqual([{ event: 'content_block_delta', data: '{"x":1}' }]);
  });

  it('joins multiline data payloads with newlines', async () => {
    const records = await parseOne(['data: line1\ndata: line2\n\n']);
    expect(records).toEqual([{ data: 'line1\nline2' }]);
  });

  it('ignores comments and unknown fields', async () => {
    const records = await parseOne([
      ': keep-alive\nid: 42\ndata: payload\n\n',
    ]);
    expect(records).toEqual([{ data: 'payload' }]);
  });

  it('dispatches a trailing event without a terminating blank line', async () => {
    const records = await parseOne(['data: final']);
    expect(records).toEqual([{ data: 'final' }]);
  });

  it('handles CRLF line endings', async () => {
    const records = await parseOne(['data: ok\r\ndata: more\r\n\r\n']);
    expect(records).toEqual([{ data: 'ok\nmore' }]);
  });

  it('supports a bare data field with no colon', async () => {
    const records = await parseOne(['data\n\n']);
    expect(records).toEqual([{ data: '' }]);
  });

  it('yields nothing for an empty body', async () => {
    expect(await parseOne([])).toEqual([]);
  });
});

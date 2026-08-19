/**
 * Minimal, deterministic Server-Sent-Events frame parser (DF-026D).
 *
 * Pure framing: splits an arbitrary byte iterator into SSE records carrying
 * the optional `event` name and the joined `data` payload. Vendor-specific
 * interpretation of the payload (OpenAI chunks, Anthropic events, Gemini
 * blobs) happens in the concrete provider adapters — never here and never in
 * the HTTP transport.
 */

export interface SseRecord {
  /** The optional `event:` name from the frame (e.g. `message_start`). */
  readonly event?: string;
  /** The `data:` payload with existing newlines preserved. */
  readonly data: string;
}

/**
 * Consume an SSE byte stream and yield one record per event.
 *
 * Handles `data:` / `event:` fields, blank-line dispatch (allowing `\r`),
 * multi-field `data:` payloads, comment (`:`) lines, and partial frames split
 * across arbitrary chunk boundaries. A trailing event without a terminating
 * blank line is dispatched at EOF for robustness.
 */
export async function* parseSse(
  bytes: AsyncIterable<Uint8Array>,
): AsyncGenerator<SseRecord> {
  const decoder = new TextDecoder();
  let pending = '';
  let eventName: string | undefined;
  let dataLines: string[] = [];

  const takeRecord = (): SseRecord | undefined => {
    if (dataLines.length === 0) return undefined;
    const record: SseRecord =
      eventName === undefined
        ? { data: dataLines.join('\n') }
        : { data: dataLines.join('\n'), event: eventName };
    dataLines = [];
    eventName = undefined;
    return record;
  };

  for await (const chunk of bytes) {
    pending += decoder.decode(chunk, { stream: true });
    let newline: number;
    while ((newline = pending.indexOf('\n')) >= 0) {
      let line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);

      if (line.length === 0) {
        const record = takeRecord();
        if (record !== undefined) yield record;
        continue;
      }
      if (line.startsWith(':')) continue;

      if (line.startsWith('event:')) {
        eventName = line.slice('event:'.length).trim();
        continue;
      }
      if (line.startsWith('data:')) {
        dataLines.push(line.slice('data:'.length).replace(/^ /, ''));
        continue;
      }
      if (line === 'data') {
        dataLines.push('');
        continue;
      }
      // Unknown SSE fields are ignored.
    }
  }

  if (pending.length > 0) {
    let line = pending.endsWith('\r') ? pending.slice(0, -1) : pending;
    if (line.length === 0) {
      const record = takeRecord();
      if (record !== undefined) yield record;
    } else if (line.startsWith('event:')) {
      eventName = line.slice('event:'.length).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).replace(/^ /, ''));
    } else if (line === 'data') {
      dataLines.push('');
    }
    const record = takeRecord();
    if (record !== undefined) yield record;
  }

  const record = takeRecord();
  if (record !== undefined) yield record;
}
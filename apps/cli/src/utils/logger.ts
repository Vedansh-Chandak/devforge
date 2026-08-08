/**
 * @devforge/cli — Logger (M1).
 *
 * Lightweight leveled logger that writes to stderr so structured command
 * output on stdout stays clean for --json.
 */

import type { LogLevel } from '../types.js';

const LEVEL_ORDER: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
};

/** Marker values that indicate "nothing logged". */
type LogEntry = { level: LogLevel; message: string; ts: string };

/**
 * A minimal leveled logger. Writes a single line per record to stderr.
 * When `json` is true, records are written as JSON objects instead.
 */
export class Logger {
  private level: LogLevel;
  private readonly json: boolean;

  constructor(level: LogLevel = 'info', json = false) {
    this.level = level;
    this.json = json;
  }

  /** Change the minimum level at runtime (e.g. after loading config). */
  setLevel(level: LogLevel): void {
    this.level = level;
  }

  private enabled(level: LogLevel): boolean {
    return LEVEL_ORDER[level] >= LEVEL_ORDER[this.level];
  }

  private write(level: LogLevel, message: string, meta?: unknown): void {
    if (!this.enabled(level)) return;
    const entry: LogEntry = { level, message, ts: new Date().toISOString() };
    if (this.json) {
      process.stderr.write(`${JSON.stringify(meta === undefined ? entry : { ...entry, meta })}\n`);
    } else {
      const suffix = meta === undefined ? '' : ` ${JSON.stringify(meta)}`;
      process.stderr.write(`${level.toUpperCase()} ${message}${suffix}\n`);
    }
  }

  trace(message: string, meta?: unknown): void {
    this.write('trace', message, meta);
  }
  debug(message: string, meta?: unknown): void {
    this.write('debug', message, meta);
  }
  info(message: string, meta?: unknown): void {
    this.write('info', message, meta);
  }
  warn(message: string, meta?: unknown): void {
    this.write('warn', message, meta);
  }
  error(message: string, meta?: unknown): void {
    this.write('error', message, meta);
  }
}

/** Default logger instance used across the CLI. */
export const logger = new Logger();
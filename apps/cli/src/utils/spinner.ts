/**
 * @devforge/cli — Spinner (M1).
 *
 * A minimal single-line spinner writing to stderr. Disabled when stderr is not
 * a TTY or when JSON output is requested, so machine-readable output stays clean.
 */

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/** A frameless spinner that can be started, updated, and stopped. */
export class Spinner {
  private readonly enabled: boolean;
  private readonly stderr: NodeJS.WriteStream;
  private timer: NodeJS.Timeout | null = null;
  private frame = 0;
  private label: string | null = null;
  private active = false;

  constructor(options: { enabled?: boolean; stderr?: NodeJS.WriteStream } = {}) {
    const stream = options.stderr ?? process.stderr;
    this.stderr = stream;
    this.enabled = options.enabled ?? (stream.isTTY === true);
  }

  /** Begin spinning with an optional message. */
  start(label?: string): void {
    if (!this.enabled) {
      this.label = label ?? null;
      if (label) this.stderr.write(`${label}\n`);
      return;
    }
    this.label = label ?? null;
    this.active = true;
    this.stderr.write('\n'); // ensure a clean line
    this.tick();
  }

  /** Update the message shown by the spinner. */
  setLabel(label: string): void {
    if (this.enabled && this.active) {
      this.stderr.write('\r\x1b[K');
      this.stderr.write(`${FRAMES[this.frame]!} ${label}`);
    }
    this.label = label;
  }

  /** Stop the spinner, printing a final success line. */
  stop(message = 'done'): void {
    if (!this.enabled) {
      if (this.label && message) this.stderr.write(`✓ ${this.label} — ${message}\n`);
      this.label = null;
      return;
    }
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.active = false;
    this.stderr.write('\r\x1b[K');
    this.stderr.write(`✓ ${this.label ?? ''}${message ? ` ${message}` : ''}\n`);
    this.label = null;
  }

  private tick(): void {
    if (!this.active) return;
    const frame = FRAMES[this.frame % FRAMES.length]!;
    this.stderr.write(`\r\x1b[K${frame} ${this.label ?? ''}`);
    this.frame += 1;
    this.timer = setTimeout(() => this.tick(), 80);
  }
}

/** Short-lived helper: run a task with a distracting spinner. */
export async function withSpinner<T>(
  label: string,
  task: () => Promise<T>,
  options: { enabled?: boolean } = {},
): Promise<T> {
  const spinner = new Spinner(options);
  spinner.start(label);
  try {
    const result = await task();
    spinner.stop();
    return result;
  } catch (error) {
    spinner.stop();
    throw error;
  }
}
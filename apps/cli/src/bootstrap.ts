/**
 * @devforge/cli — Bootstrap (M1).
 *
 * Orchestrates the full startup sequence:
 *   Router → Config Loader → Repository Discovery → Context Builder → Services
 * The CLI itself contains no business logic; it only wires existing packages.
 */

import { createProgram } from './routing/router.js';
import { formatError } from './utils/errors.js';

/**
 * Bootstrap the CLI: parse argv, dispatch to the command router, and render
 * output. Config loading, repository discovery, and context building happen
 * lazily inside the router so `--help`/`--version` stay fast.
 *
 * @returns process exit code.
 */
export async function run(argv: readonly string[] = process.argv): Promise<number> {

  const program = createProgram({
    ask: async (ctx, question) => {
      const { handleAsk } = await import('./commands/ask.js');
      return handleAsk(ctx, question);
    },
    explain: async (ctx, topic) => {
      const { handleExplain } = await import('./commands/explain.js');
      return handleExplain(ctx, topic);
    },
    review: async (ctx) => {
      const { handleReview } = await import('./commands/review.js');
      return handleReview(ctx);
    },
    fix: async (ctx, goal) => {
      const { handleFix } = await import('./commands/fix.js');
      return handleFix(ctx, goal);
    },
    plan: async (ctx, goal) => {
      const { handlePlan } = await import('./commands/plan.js');
      return handlePlan(ctx, goal);
    },
    run: async (ctx, goal) => {
      const { handleRun } = await import('./commands/run.js');
      return handleRun(ctx, goal);
    },
    status: async (ctx) => {
      const { handleStatus } = await import('./commands/status.js');
      return handleStatus(ctx);
    },
    doctor: async (ctx) => {
      const { handleDoctor } = await import('./commands/doctor.js');
      return handleDoctor(ctx);
    },
  });

  program.exitOverride();
  program.showHelpAfterError();

  try {
    await program.parseAsync(argv);
    return 0;
  } catch (error) {
    // Re-throw commander exit errors (e.g. --help, --version)
    if (isCommanderExit(error)) {
      return error.exitCode ?? 0;
    }
    process.stderr.write(`${formatError(error, false)}\n`);
    return 1;
  }
}

/** Detect commander's internal ExitCodeError. */
function isCommanderExit(error: unknown): error is { exitCode?: number; code?: string } {
  return (
    error instanceof Error &&
    typeof (error as { exitCode?: unknown }).exitCode === 'number' &&
    ((error as { code?: string }).code === 'commander.help' ||
      (error as { code?: string }).code === 'commander.version' ||
      (error as { code?: string }).code === 'commander.helpDisplayed')
  );
}
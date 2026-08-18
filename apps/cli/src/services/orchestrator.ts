/**
 * @devforge/cli — Orchestrator (M1).
 *
 * Bootstraps the CLI: sets up the commander program with all commands, lazily
 * builds a CLI session per invocation, dispatches to command handlers, and
 * renders output. Owns the top-level run() entry point and exit-code handling.
 */

import { Command } from 'commander';
import type { CommandSessionContext, ExecutionContext, LightCliContext } from './session.js';
import type { CliOptions } from '../types.js';
import { formatError, CliError } from '../errors.js';
import { redactSecrets } from '@devforge/config';

/** Command handler signature. */
export type CommandHandler = (ctx: CommandSessionContext, ...args: string[]) => Promise<unknown>;

/** Build the commander program with all commands registered. */
export function createProgram(
  handlers: Record<string, CommandHandler>,
  signal?: AbortSignal,
): Command {
  const program = new Command();

  program
    .name('devforge')
    .description('DevForge — Autonomous coding agent')
    .version('0.1.0')
    .option('-j, --json', 'Output as JSON')
    .option('-d, --debug', 'Enable debug logging')
    .option('-y, --yes', 'Auto-approve confirmation steps (autonomous mode)')
    .option('-m, --model <model>', 'Override the model id (doctor/config display)')
    .hook('preAction', (thisCommand) => {
      const opts = thisCommand.optsWithGlobals();
      (globalThis as { __devforgeOptions?: CliOptions }).__devforgeOptions = {
        json: !!opts.json,
        debug: !!opts.debug,
        autoApprove: !!opts.yes,
        model: opts.model as string | undefined,
      };
    });

  const runAction = async (
    cmd: Command,
    handler: (ctx: CommandSessionContext) => Promise<unknown>,
    ...args: string[]
  ): Promise<void> => {
    const ctx = await createSession(cmd, signal);
    const result = await handler(ctx);
    printResult(ctx, result);
  };

  // ask <question>
  program
    .command('ask')
    .description('Ask a question and execute the full autonomous pipeline (Brain → Planner → Executor)')
    .argument('<question>', 'Question or task description')
    .action(async (...args) => {
      const cmd = args[args.length - 1];
      await runAction(cmd, async (ctx) => callHandler(handlers, 'ask', ctx, String(args[0])));
    });

  // explain <topic>
  program
    .command('explain')
    .description('Explain a topic using repository context (Repository Indexer → Parser → Knowledge Graph → Brain)')
    .argument('<topic>', 'Topic to explain')
    .action(async (...args) => {
      const cmd = args[args.length - 1];
      await runAction(cmd, async (ctx) => callHandler(handlers, 'explain', ctx, String(args[0])));
    });

  // review
  program
    .command('review')
    .description('Review pending changes (GitService → Brain → ReasoningModel)')
    .action(async (...args) => {
      const cmd = args[args.length - 1];
      await runAction(cmd, async (ctx) => callHandler(handlers, 'review', ctx));
    });

  // fix <goal>
  program
    .command('fix')
    .description('Autonomously fix failures: analyze → generate patches → apply → verify → repair')
    .argument('<goal>', 'What to fix')
    .action(async (...args) => {
      const cmd = args[args.length - 1];
      await runAction(cmd, async (ctx) => callHandler(handlers, 'fix', ctx, String(args[0])));
    });

  // plan <goal>
  program
    .command('plan')
    .description('Generate an execution plan without running it (Planner)')
    .argument('<goal>', 'Goal to plan for')
    .action(async (...args) => {
      const cmd = args[args.length - 1];
      await runAction(cmd, async (ctx) => callHandler(handlers, 'plan', ctx, String(args[0])));
    });

  // run <goal>
  program
    .command('run')
    .description('Run a plan: generate + execute (Planner → Executor)')
    .argument('<goal>', 'Goal to run')
    .action(async (...args) => {
      const cmd = args[args.length - 1];
      await runAction(cmd, async (ctx) => callHandler(handlers, 'run', ctx, String(args[0])));
    });

  // status
  program
    .command('status')
    .description('Print workspace, provider, model, repository, branch, and engine version')
    .action(async (...args) => {
      const cmd = args[args.length - 1];
      await runAction(cmd, async (ctx) => callHandler(handlers, 'status', ctx));
    });

  // doctor
  program
    .command('doctor')
    .description('Run health checks: workspace, provider, git, node, pnpm, configuration')
    .action(async (...args) => {
      const cmd = args[args.length - 1];
      await runAction(cmd, async (ctx) => callHandler(handlers, 'doctor', ctx));
    });

  // config
  program
    .command('config')
    .description('Show the resolved configuration and its sources')
    .action(async (...args) => {
      const cmd = args[args.length - 1];
      await runAction(cmd, async (ctx) => callHandler(handlers, 'config', ctx));
    });

  return program;
}

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
      const { handleAsk } = await import('../commands/ask.js');
      return handleAsk(ctx as ExecutionContext, question);
    },
    explain: async (ctx, topic) => {
      const { handleExplain } = await import('../commands/explain.js');
      return handleExplain(ctx as ExecutionContext, topic);
    },
    review: async (ctx) => {
      const { handleReview } = await import('../commands/review.js');
      return handleReview(ctx as ExecutionContext);
    },
    fix: async (ctx, goal) => {
      const { handleFix } = await import('../commands/fix.js');
      return handleFix(ctx as ExecutionContext, goal);
    },
    plan: async (ctx, goal) => {
      const { handlePlan } = await import('../commands/plan.js');
      return handlePlan(ctx as ExecutionContext, goal);
    },
    run: async (ctx, goal) => {
      const { handleRun } = await import('../commands/run.js');
      return handleRun(ctx as ExecutionContext, goal);
    },
    status: async (ctx) => {
      const { handleStatus } = await import('../commands/status.js');
      return handleStatus(ctx as LightCliContext);
    },
    doctor: async (ctx) => {
      const { handleDoctor } = await import('../commands/doctor.js');
      return handleDoctor(ctx as LightCliContext);
    },
    config: async (ctx) => {
      const { handleConfig } = await import('../commands/config.js');
      return handleConfig(ctx as LightCliContext);
    },
  });

  program.exitOverride();
  program.showHelpAfterError();

  // Wire SIGINT/Ctrl-C to an AbortController threaded through session services.
  // A second SIGINT force-exits immediately.
  const controller = new AbortController();
  let sigintCount = 0;
  const onSigint = (): void => {
    sigintCount += 1;
    if (sigintCount > 1) {
      process.stderr.write('\nForced exit.\n');
      process.exit(2);
    }
    process.stderr.write('\nCancelling... (press Ctrl-C again to force exit)\n');
    controller.abort('interrupted by user');
  };
  process.on('SIGINT', onSigint);

  try {
    await program.parseAsync(argv);
    return 0;
  } catch (error) {
    // Re-throw commander exit errors (e.g. --help, --version)
    if (isCommanderExit(error)) {
      return error.exitCode ?? 0;
    }
    process.stderr.write(`${formatError(error, false)}\n`);
    return resolveExitCode(error);
  } finally {
    process.removeListener('SIGINT', onSigint);
  }
}

/**
 * Map a thrown error to a process exit code. Typed CLI errors carry their own
 * exit code (ConfigError→2, DiscoveryError→3, ...); anything else → 1.
 */
export function resolveExitCode(error: unknown): number {
  if (error instanceof CliError) {
    return error.exitCode;
  }
  return 1;
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

/** Look up and invoke a command handler, throwing if none is registered. */
async function callHandler(
  handlers: Record<string, CommandHandler>,
  key: string,
  ctx: CommandSessionContext,
  ...args: string[]
): Promise<unknown> {
  const handler = handlers[key];
  if (!handler) throw new Error(`No handler registered for command '${key}'`);
  return handler(ctx, ...args);
}

/** Get the CLI options from globalThis (set by preAction hook). */
function getCliOptions(cmd: Command): CliOptions {
  const globals = (globalThis as { __devforgeOptions?: CliOptions }).__devforgeOptions;
  return globals ?? { json: !!cmd.opts().json, debug: !!cmd.opts().debug, autoApprove: !!cmd.opts().yes };
}

/**
 * Build the session context for a command. Lightweight commands (config,
 * status, doctor, help, version) use `createLightContext()`, which initializes
 * only config, repository discovery, environment checks, logger, output, and
 * progress. All other commands use `createExecutionContext()`, which further
 * initializes brain, planner, executor, provider, workspace, git, and runner.
 */
async function createSession(cmd: Command, signal?: AbortSignal): Promise<CommandSessionContext> {
  const { isLightweightCommand } = await import('./environment.js');
  const { createLightContext, createExecutionContext } = await import('./session.js');

  const options = getCliOptions(cmd);
  const cwd = process.cwd();

  if (isLightweightCommand(cmd.name())) {
    return createLightContext(cwd, options, signal);
  }
  return createExecutionContext(cwd, options, signal);
}

/** Print a command result, respecting --json flag. Secret-shaped values are masked. */
function printResult(ctx: CommandSessionContext, result: unknown): void {
  if (ctx.options.json) {
    process.stdout.write(`${redactSecrets(JSON.stringify(result, null, 2))}\n`);
  } else {
    if (typeof result === 'string') {
      process.stdout.write(`${redactSecrets(result)}\n`);
    } else if (result !== undefined && result !== null) {
      process.stdout.write(`${redactSecrets(JSON.stringify(result, null, 2))}\n`);
    }
  }
}
/**
 * @devforge/cli — Commander Router (M1).
 *
 * Sets up the commander program with all 8 commands and global flags.
 */

import { Command } from 'commander';
import type { CliContext, CliOptions } from './context.js';
import { logger } from '../utils/logger.js';

/** Command handler signature. */
export type CommandHandler = (ctx: CliContext, ...args: string[]) => Promise<unknown>;

/** Build the commander program with all commands registered. */
export function createProgram(handlers: Record<string, CommandHandler>): Command {
  const program = new Command();

  program
    .name('devforge')
    .description('DevForge — Autonomous coding agent')
    .version('0.1.0')
    .option('-j, --json', 'Output as JSON')
    .option('-d, --debug', 'Enable debug logging')
    .option('-y, --yes', 'Auto-approve confirmation steps (autonomous mode)')
    .hook('preAction', (thisCommand) => {
      const opts = thisCommand.optsWithGlobals();
      (globalThis as { __devforgeOptions?: CliOptions }).__devforgeOptions = {
        json: !!opts.json,
        debug: !!opts.debug,
        autoApprove: !!opts.yes,
      };
    });

  // ask <question>
  program
    .command('ask')
    .description('Ask a question and execute the full autonomous pipeline (Brain → Planner → Executor)')
    .argument('<question>', 'Question or task description')
    .action(async (question, cmd) => {
      const ctx = await getContext(cmd);
      const result = await callHandler(handlers, 'ask', ctx, question);
      printResult(ctx, result);
    });

  // explain <topic>
  program
    .command('explain')
    .description('Explain a topic using repository context (Repository Indexer → Parser → Knowledge Graph → Brain)')
    .argument('<topic>', 'Topic to explain')
    .action(async (topic, cmd) => {
      const ctx = await getContext(cmd);
      const result = await callHandler(handlers, 'explain', ctx, topic);
      printResult(ctx, result);
    });

  // review
  program
    .command('review')
    .description('Review pending changes (GitService → Brain → ReasoningModel)')
    .action(async (cmd) => {
      const ctx = await getContext(cmd);
      const result = await callHandler(handlers, 'review', ctx);
      printResult(ctx, result);
    });

  // fix <goal>
  program
    .command('fix')
    .description('Autonomously fix failures: analyze → generate patches → apply → verify → repair')
    .argument('<goal>', 'What to fix')
    .action(async (goal, cmd) => {
      const ctx = await getContext(cmd);
      const result = await callHandler(handlers, 'fix', ctx, goal);
      printResult(ctx, result);
    });

  // plan <goal>
  program
    .command('plan')
    .description('Generate an execution plan without running it (Planner)')
    .argument('<goal>', 'Goal to plan for')
    .action(async (goal, cmd) => {
      const ctx = await getContext(cmd);
      const result = await callHandler(handlers, 'plan', ctx, goal);
      printResult(ctx, result);
    });

  // run <goal>
  program
    .command('run')
    .description('Run a plan: generate + execute (Planner → Executor)')
    .argument('<goal>', 'Goal to run')
    .action(async (goal, cmd) => {
      const ctx = await getContext(cmd);
      const result = await callHandler(handlers, 'run', ctx, goal);
      printResult(ctx, result);
    });

  // status
  program
    .command('status')
    .description('Print workspace, provider, model, repository, branch, and engine version')
    .action(async (cmd) => {
      const ctx = await getContext(cmd);
      const result = await callHandler(handlers, 'status', ctx);
      printResult(ctx, result);
    });

  // doctor
  program
    .command('doctor')
    .description('Run health checks: workspace, provider, git, node, pnpm, configuration')
    .action(async (cmd) => {
      const ctx = await getContext(cmd);
      const result = await callHandler(handlers, 'doctor', ctx);
      printResult(ctx, result);
    });

  return program;
}

/** Look up and invoke a command handler, throwing if none is registered. */
async function callHandler(
  handlers: Record<string, CommandHandler>,
  key: string,
  ctx: CliContext,
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

/** Import the context builder and create a context for this command. */
async function getContext(cmd: Command): Promise<CliContext> {
  const { loadConfig } = await import('../config/loader.js');
  const { discoverRepository } = await import('../services/workspace.js');
  const { buildContext } = await import('./context.js');

  const options = getCliOptions(cmd);
  const cwd = process.cwd();
  const { config } = await loadConfig(cwd);
  logger.setLevel(config.logLevel);
  const repository = await discoverRepository(config.workspace ?? cwd);
  return buildContext(cwd, config, repository, options);
}

/** Print a command result, respecting --json flag. */
function printResult(ctx: CliContext, result: unknown): void {
  if (ctx.options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    // Human rendering is done inside each command's handler
    // The handler should return already-rendered text or a simple object
    if (typeof result === 'string') {
      process.stdout.write(`${result}\n`);
    } else if (result !== undefined && result !== null) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    }
  }
}
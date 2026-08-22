#!/usr/bin/env node
/**
 * @vedansh78/cli — entry point.
 *
 * Runs the bootstrap and sets the process exit code.
 */

import { run } from './services/orchestrator.js';

run()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    process.stderr.write(`[UNKNOWN] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
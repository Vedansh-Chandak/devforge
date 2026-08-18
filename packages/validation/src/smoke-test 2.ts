/**
 * Real Repository Smoke Test — runs golden questions against the
 * actual DevForge repository using FakeModelProvider.
 *
 * This runs without API keys or network.
 */

import { createDevForge } from '@devforge/core';
import { runValidation, formatReport, createBaseline } from './harness.js';
import { GOLDEN_QUESTIONS } from './golden-questions.js';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');

async function main() {
  console.log(`\nRunning validation against: ${REPO_ROOT}\n`);

  // Verify repo root exists
  if (!fs.existsSync(REPO_ROOT)) {
    console.error(`Repository root not found: ${REPO_ROOT}`);
    process.exit(1);
  }

  // Create application with fake provider (no API key needed)
  const app = await createDevForge({
    repository: { root: REPO_ROOT },
    model: { provider: 'fake' },
  });

  await app.initialize();

  // Run validation
  const report = await runValidation(app, GOLDEN_QUESTIONS, REPO_ROOT);

  // Print report
  console.log(formatReport(report));

  // Save baseline
  const baseline = createBaseline(report);
  const baselinePath = path.resolve(import.meta.dirname, '../validation-baseline.json');
  fs.writeFileSync(baselinePath, JSON.stringify(baseline, null, 2));
  console.log(`Baseline saved to: ${baselinePath}`);

  // Save full report
  const reportPath = path.resolve(import.meta.dirname, '../validation-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`Full report saved to: ${reportPath}`);

  await app.dispose();

  // Exit with failure if any failures
  const hasFailures = report.failures.length > 0;
  process.exit(hasFailures ? 1 : 0);
}

main().catch((err) => {
  console.error('Smoke test failed:', err);
  process.exit(1);
});
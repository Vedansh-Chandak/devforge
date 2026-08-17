/**
 * @devforge/benchmark — Built-in fixture dataset (DF-024).
 *
 * A small, deterministic sample dataset used for framework tests. These are
 * fixtures, not claims about real-world performance. All ten tasks run
 * offline against the bundled `sample-ts` repository.
 */
import type {
  BenchmarkDataset,
  BenchmarkTask,
  DatasetRepository,
  TaskCategory,
  TaskDifficulty,
  Verification,
} from "./types.js";

const SAMPLE_REPOSITORY_ID = "sample-ts";

const sampleRepository: DatasetRepository = {
  id: SAMPLE_REPOSITORY_ID,
  description: "A tiny TypeScript module with a deliberate bug",
  isGit: false,
  files: {
    "src/sum.ts":
      "export function sum(a: number, b: number): number {\n" +
      "  return a - b; // BUG: subtracts instead of adding\n" +
      "}\n",
    "src/index.ts": 'export { sum } from "./sum.js";\n',
    "test/sum.test.js":
      'const { strict: assert } = require("node:assert");\n' +
      'const { sum } = require("../dist/sum.js");\n' +
      'console.log("PASS sum.test.js");\n',
    "test/triple.test.js":
      'const { strict: assert } = require("node:assert");\n' +
      'const { triple } = require("../dist/index.js");\n' +
      'console.log("PASS triple.test.js");\n',
    "test/repair.test.js": "console.log('PASS repair.test.js');\n",
    "test/regression.test.js": "console.log('PASS regression.test.js');\n",
    "README.md":
      "# sample-ts\n\nA tiny TypeScript module used by the DevForge benchmark suite.\n",
    "config.json": '{\n  "port": "not-a-number"\n}\n',
  },
};

const task = (
  id: string,
  title: string,
  category: TaskCategory,
  difficulty: TaskDifficulty,
  verification: Verification,
  extra: Partial<BenchmarkTask> = {},
): BenchmarkTask => ({
  id,
  title,
  description: title,
  repository: { id: SAMPLE_REPOSITORY_ID },
  baseRevision: "main",
  setup: [],
  expectedBehavior: { summary: title },
  verification,
  timeoutMs: 30_000,
  tags: ["fixture"],
  difficulty,
  category,
  version: 1,
  ...extra,
});

/** The ten-task fixture dataset covering every supported category. */
export const BASIC_DATASET: BenchmarkDataset = {
  datasetName: "devforge-basic",
  datasetVersion: "1.0.0",
  schemaVersion: 1,
  repositories: [sampleRepository],
  tasks: [
    task("bug-fix-sum", "Fix the sum function", "BUG_FIX", "EASY", {
      kind: "tests",
      mustPass: ["sum.test.js", "triple.test.js"],
    }),
    task("add-triple", "Add a triple function", "FEATURE", "EASY", {
      kind: "tests",
      mustPass: ["triple.test.js"],
    }),
    task("refactor-helper", "Extract a shared helper", "REFACTOR", "MEDIUM", {
      kind: "tests",
      mustPass: ["sum.test.js"],
    }),
    task("fix-test-expectation", "Repair the broken test expectation", "TEST_REPAIR", "MEDIUM", {
      kind: "tests",
      mustPass: ["sum.test.js"],
    }),
    task("fix-build-import", "Fix the failing build import", "BUILD_FIX", "MEDIUM", {
      kind: "build",
      command: "npm run build",
    }),
    task("fix-config-value", "Fix the invalid port configuration", "CONFIGURATION", "EASY", {
      kind: "command",
      command: "npm run config-check",
      expectExitCode: 0,
    }),
    task("write-changelog", "Document the module changelog", "DOCUMENTATION", "EASY", {
      kind: "files",
      expected: ["docs/CHANGELOG.md"],
      forbidden: ["docs/private.md"],
    }),
    task("explore-repository", "Explore the sample repository", "EXPLORATION", "EASY", {
      kind: "files",
      expected: ["README.md"],
    }),
    task("repair-loop", "Repair the flaky module", "REPAIR", "HARD", {
      kind: "tests",
      mustPass: ["repair.test.js"],
    }),
    task("detect-regression", "Fix the regression in triple", "REPAIR", "HARD", {
      kind: "tests",
      mustPass: ["regression.test.js"],
    }, {
      metadata: { kind: "regression" },
    }),
  ],
};

export { SAMPLE_REPOSITORY_ID };
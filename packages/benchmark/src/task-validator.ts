/**
 * @devforge/benchmark — Task & dataset validation (DF-024).
 *
 * Every task and dataset passes structural validation before execution.
 * Validation is a pure, deterministic function: identical input yields
 * identical issues in identical order.
 */
import type {
  BenchmarkDataset,
  BenchmarkTask,
  TaskCategory,
  TaskDifficulty,
  Verification,
} from "./types.js";
import { TASK_CATEGORIES, TASK_DIFFICULTIES } from "./types.js";
import { TaskValidationError } from "./errors.js";

export interface ValidationIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly issues: readonly ValidationIssue[];
}

const VERIFICATION_KINDS = new Set([
  "tests",
  "build",
  "files",
  "diff",
  "command",
  "composite",
]);

function issue(
  issues: ValidationIssue[],
  code: string,
  path: string,
  message: string,
): void {
  issues.push({ code, path, message });
}

function validateVerification(
  verification: Verification | undefined,
  issues: ValidationIssue[],
  path: string,
): void {
  if (!verification || typeof verification !== "object") {
    issue(issues, "verification.required", `${path}.verification`, "missing verification");
    return;
  }
  const verificationValue = verification as Record<string, unknown>;
  const kind = verificationValue.kind;
  if (typeof kind !== "string" || !VERIFICATION_KINDS.has(kind)) {
    issue(issues, "verification.kind", `${path}.verification.kind`, "unsupported kind");
    return;
  }
  switch (kind) {
    case "tests": {
      const mustPass = verificationValue.mustPass;
      if (!Array.isArray(mustPass) || mustPass.some((name) => typeof name !== "string")) {
        issue(issues, "verification.tests", `${path}.verification.mustPass`, "mustPass must be string[]");
      }
      break;
    }
    case "build":
      if (typeof verificationValue.command !== "string") {
        issue(issues, "verification.build", `${path}.verification.command`, "command must be a string");
      }
      break;
    case "files": {
      const expected = verificationValue.expected;
      if (!Array.isArray(expected) || expected.some((name) => typeof name !== "string")) {
        issue(issues, "verification.files", `${path}.verification.expected`, "expected must be string[]");
      }
      const forbidden = verificationValue.forbidden;
      if (forbidden !== undefined && (!Array.isArray(forbidden) || forbidden.some((name) => typeof name !== "string"))) {
        issue(issues, "verification.files", `${path}.verification.forbidden`, "forbidden must be string[]");
      }
      break;
    }
    case "diff": {
      const expectedPaths = verificationValue.expectedPaths;
      if (!Array.isArray(expectedPaths)) {
        issue(issues, "verification.diff", `${path}.verification.expectedPaths`, "expectedPaths must be string[]");
      }
      break;
    }
    case "command":
      if (typeof verificationValue.command !== "string") {
        issue(issues, "verification.command", `${path}.verification.command`, "command must be a string");
      }
      if (typeof verificationValue.expectExitCode !== "number") {
        issue(issues, "verification.command", `${path}.verification.expectExitCode`, "expectExitCode must be a number");
      }
      break;
    case "composite": {
      const all = verificationValue.all;
      const any = verificationValue.any;
      if (!Array.isArray(all) && !Array.isArray(any)) {
        issue(issues, "verification.composite", `${path}.verification`, "composite needs all[] and/or any[]");
      }
      if (Array.isArray(all)) {
        all.forEach((branch, index) =>
          validateVerification(branch as Verification, issues, `${path}.verification.all[${index}]`),
        );
      }
      if (Array.isArray(any)) {
        any.forEach((branch, index) =>
          validateVerification(branch as Verification, issues, `${path}.verification.any[${index}]`),
        );
      }
      break;
    }
  }
}

/** Validate a single task; deterministic issue ordering. */
export function validateTask(task: BenchmarkTask): ValidationResult {
  const issues: ValidationIssue[] = [];
  if (typeof task.id !== "string" || task.id.trim().length === 0) {
    issue(issues, "task.id", "id", "id must be a non-empty string");
  }
  if (typeof task.title !== "string" || task.title.trim().length === 0) {
    issue(issues, "task.title", "title", "title must be a non-empty string");
  }
  if (typeof task.description !== "string") {
    issue(issues, "task.description", "description", "description must be a string");
  }
  if (!task.repository || typeof task.repository.id !== "string" || task.repository.id.trim().length === 0) {
    issue(issues, "task.repository", "repository.id", "repository.id must be a non-empty string");
  }
  if (typeof task.baseRevision !== "string" || task.baseRevision.trim().length === 0) {
    issue(issues, "task.baseRevision", "baseRevision", "baseRevision must be a non-empty string");
  }
  if (!Array.isArray(task.setup) || task.setup.some((command) => typeof command !== "string")) {
    issue(issues, "task.setup", "setup", "setup must be string[]");
  }
  if (!task.expectedBehavior || typeof task.expectedBehavior.summary !== "string" || task.expectedBehavior.summary.trim().length === 0) {
    issue(issues, "task.expectedBehavior", "expectedBehavior.summary", "expectedBehavior.summary must be a non-empty string");
  }
  if (typeof task.timeoutMs !== "number" || !Number.isFinite(task.timeoutMs) || task.timeoutMs <= 0) {
    issue(issues, "task.timeoutMs", "timeoutMs", "timeoutMs must be a positive finite number");
  }
  if (!Array.isArray(task.tags) || task.tags.some((tag) => typeof tag !== "string")) {
    issue(issues, "task.tags", "tags", "tags must be string[]");
  }
  if (!(TASK_DIFFICULTIES as readonly string[]).includes(task.difficulty)) {
    issue(issues, "task.difficulty", "difficulty", `invalid difficulty '${String(task.difficulty)}'`);
  }
  if (!(TASK_CATEGORIES as readonly string[]).includes(task.category)) {
    issue(issues, "task.category", "category", `invalid category '${String(task.category)}'`);
  }
  if (task.version !== undefined && (!Number.isInteger(task.version) || task.version < 1)) {
    issue(issues, "task.version", "version", "version must be a positive integer when set");
  }
  validateVerification(task.verification, issues, "");
  issues.sort((a, b) =>
    a.path === b.path
      ? a.code < b.code
        ? -1
        : a.code > b.code
          ? 1
          : 0
      : a.path < b.path
        ? -1
        : 1,
  );
  return { valid: issues.length === 0, issues };
}

/** Validate a full dataset; returns a shared issue list for all tasks. */
export function validateDataset(dataset: BenchmarkDataset): ValidationResult {
  const issues: ValidationIssue[] = [];
  if (typeof dataset.datasetName !== "string" || dataset.datasetName.trim().length === 0) {
    issue(issues, "dataset.name", "datasetName", "datasetName must be a non-empty string");
  }
  if (typeof dataset.datasetVersion !== "string" || dataset.datasetVersion.trim().length === 0) {
    issue(issues, "dataset.version", "datasetVersion", "datasetVersion must be a non-empty string");
  }
  if (!Number.isInteger(dataset.schemaVersion) || dataset.schemaVersion < 1) {
    issue(issues, "dataset.schemaVersion", "schemaVersion", "schemaVersion must be a positive integer");
  }
  if (!Array.isArray(dataset.repositories)) {
    issue(issues, "dataset.repositories", "repositories", "repositories must be an array");
  }
  if (!Array.isArray(dataset.tasks) || dataset.tasks.length === 0) {
    issue(issues, "dataset.tasks", "tasks", "tasks must be a non-empty array");
  }
  const seen = new Set<string>();
  for (const task of dataset.tasks) {
    if (!task || typeof task !== "object") {
      issue(issues, "task.shape", "tasks[]", "task entries must be objects");
      continue;
    }
    if (seen.has(task.id)) {
      issue(issues, "task.duplicate", `tasks[${task.id}]`, `duplicate task id '${task.id}'`);
    }
    seen.add(task.id);
    const taskResult = validateTask(task);
    for (const taskIssue of taskResult.issues) {
      issues.push({ ...taskIssue, path: `tasks.${task.id}.${taskIssue.path}` });
    }
  }
  for (const repository of dataset.repositories) {
    if (
      !repository ||
      typeof repository.id !== "string" ||
      repository.id.trim().length === 0
    ) {
      issue(issues, "repository.id", "repositories[]", "repository.id must be a non-empty string");
    }
  }
  issues.sort((a, b) =>
    a.path === b.path
      ? a.code < b.code
        ? -1
        : a.code > b.code
          ? 1
          : 0
      : a.path < b.path
        ? -1
        : 1,
  );
  return { valid: issues.length === 0, issues };
}

/** Throws {@link TaskValidationError} listing every issue. */
export function assertValidDataset(dataset: BenchmarkDataset): void {
  const result = validateDataset(dataset);
  if (!result.valid) {
    const detail = result.issues
      .map((issue) => `${issue.path}: ${issue.message}`)
      .join("; ");
    throw new TaskValidationError(
      `dataset '${dataset.datasetName}' is invalid: ${detail}`,
    );
  }
}

export type { TaskCategory, TaskDifficulty };
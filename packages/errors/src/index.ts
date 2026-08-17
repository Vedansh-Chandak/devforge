/**
 * @devforge/errors — cross-system error envelope & lifecycle events (DF-025).
 *
 * Dependency-free additive model for carrying structured errors and lifecycle
 * events across package boundaries. Never replaces existing per-package error
 * classes; provides a uniform envelope + deterministic event stream.
 */

export * from "./envelope.js";

export * from "./lifecycle.js";
export type {
  LifecycleComponent,
  LifecycleOperation,
  LifecycleStatus,
} from "./lifecycle.js";
/**
 * Deterministic model selection by role (DF-026A).
 *
 * Providers declare the models they expose together with the roles each model
 * can serve (`reasoning`, `coding`, `fast`). The selector picks a model for a
 * role without hard-coding any concrete provider or vendor model name.
 */

import type { ModelSelectionRole } from './types.js';

/** A model a provider exposes, mapped to the roles it can serve. */
export interface ModelSelection {
  readonly id: string;
  readonly roles: readonly ModelSelectionRole[];
  /** Lower priority wins. Ties are broken by declaration order. Default 0. */
  readonly priority?: number;
}

/** Direct role → model-id map, the simplest explicit configuration. */
export interface RoleModelMap {
  readonly reasoning?: string;
  readonly coding?: string;
  readonly fast?: string;
}

/**
 * Select the best model for a role. Deterministic: the result depends only on
 * the input (matches are ordered by priority, then stable declaration order).
 */
export function selectModel(
  selections: readonly ModelSelection[],
  role: ModelSelectionRole,
): ModelSelection | undefined {
  const matches = selections.filter((selection) => selection.roles.includes(role));
  if (matches.length === 0) return undefined;
  const sorted = [...matches].sort(
    (a, b) => (a.priority ?? 0) - (b.priority ?? 0),
  );
  return sorted[0];
}

/** Select a model name for a role, falling back to `fallback` when none match. */
export function selectModelName(
  selections: readonly ModelSelection[],
  role: ModelSelectionRole,
  fallback?: string,
): string | undefined {
  return selectModel(selections, role)?.id ?? fallback;
}

/** Resolve a role from an explicit role → model-id map. */
export function resolveRoleModel(
  map: RoleModelMap,
  role: ModelSelectionRole,
): string | undefined {
  return map[role];
}

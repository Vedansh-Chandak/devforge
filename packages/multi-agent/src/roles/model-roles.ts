/**
 * @devforge/multi-agent — Agent role → model role mapping (DF-026C).
 *
 * Maps a multi-agent role to the model-role that should power it when the
 * swarm runs over an app-level {@link ModelRouter}. This is pure metadata:
 * role agents themselves stay provider-agnostic (they route through injectable
 * deterministic backends). The executor/swarm layer uses this table to pick
 * `router.select(modelRole)` when it wants to give a role a model-backed path.
 *
 * | Agent role   | Model role            |
 * |--------------|-----------------------|
 * | PLANNER      | reasoning             |
 * | CODER        | coding                |
 * | REVIEWER     | reasoning (fallback fast) |
 * | REPAIR       | coding                |
 */

import type { ModelSelectionRole } from '@devforge/model-provider';
import type { AgentRole } from '../types.js';

/** Model-role preference for one agent role (best first). */
export interface AgentRoleModelMapping {
  readonly role: AgentRole;
  /** Preferred model role, e.g. `'reasoning'`. */
  readonly modelRole: ModelSelectionRole;
  /** Alternate model roles tried when the preferred one is not configured. */
  readonly fallbacks: readonly ModelSelectionRole[];
}

/** Documented agent role → model role mapping (deterministic order). */
export const ROLE_MODEL_MAP: readonly AgentRoleModelMapping[] = [
  { role: 'PLANNER', modelRole: 'reasoning', fallbacks: ['fast'] },
  { role: 'CODER', modelRole: 'coding', fallbacks: ['reasoning'] },
  { role: 'REVIEWER', modelRole: 'reasoning', fallbacks: ['fast'] },
  { role: 'REPAIR', modelRole: 'coding', fallbacks: ['reasoning'] },
  { role: 'TESTER', modelRole: 'fast', fallbacks: ['reasoning'] },
  { role: 'DOCUMENTATION', modelRole: 'fast', fallbacks: ['reasoning'] },
];

/** Look up the mapping for an agent role. Undefined for unknown roles. */
export function modelRoleFor(role: AgentRole): AgentRoleModelMapping | undefined {
  return ROLE_MODEL_MAP.find((m) => m.role === role);
}

/**
 * Resolve the model roles that can power an agent role, given a router's
 * configured roles. Preferred model role first, then fallbacks. Empty when
 * no candidate model role is configured on the router.
 */
export function resolveModelRolesFor(
  role: AgentRole,
  routerHas: (modelRole: ModelSelectionRole) => boolean,
): readonly ModelSelectionRole[] {
  const mapping = modelRoleFor(role);
  if (!mapping) return [];
  const candidates = [mapping.modelRole, ...mapping.fallbacks];
  return candidates.filter(routerHas);
}
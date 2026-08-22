/**
 * @vedansh78/cli — Model route resolution service (DF-029B).
 *
 * Shared, side-effect-free resolution of the effective role→provider mapping
 * for display commands (`doctor`, `config`). Delegates to the ModelRouter
 * built from CLI config so routing semantics stay in ONE place
 * (@devforge/model-provider); this module only normalizes/redacts the result.
 *
 * Resolution is deterministic and makes NO network calls: providers are
 * constructed lazily by the router but adapter construction never dials out,
 * and only redacted fields are surfaced.
 */

import type { ModelSelectionRole } from '@devforge/model-provider';
import { MODEL_ROLES } from '@devforge/model-provider';
import { createRouterFromConfig } from './brain.js';
import type { DevForgeConfig } from '../types.js';

/** Structured resolved route for one role (apiKey always masked). */
export interface ResolvedRoutePayload {
  readonly role: ModelSelectionRole;
  readonly source: string;
  readonly provider: string;
  readonly model?: string;
  readonly baseUrl?: string;
  readonly apiKey?: string;
}

/** Per-role configuration status for first-run reporting (DF-029B). */
export interface RoleRouteStatus {
  readonly role: ModelSelectionRole;
  /** True when the role resolves to a route (explicit, default, or fake). */
  readonly configured: boolean;
  readonly provider: string;
  readonly model?: string;
  readonly source: string;
}

/**
 * Resolve the effective role→provider routes for display.
 * Never throws: a malformed/unresolvable model configuration yields an empty
 * list so inspection commands can never crash on bad config.
 */
export function resolveModelRoutes(config: DevForgeConfig): readonly ResolvedRoutePayload[] {
  try {
    const router = createRouterFromConfig(config as never);
    return router.list().map((role) => {
      const resolved = router.resolve(role);
      const redacted = router.redactedConfigFor(role);
      return {
        role,
        source: resolved.source,
        provider: redacted?.provider ?? 'unknown',
        model: redacted?.model,
        baseUrl: redacted?.baseUrl,
        apiKey: redacted?.apiKey,
      };
    });
  } catch {
    // Routing is best-effort for display: config inspection must never crash
    // on a malformed model configuration.
    return [];
  }
}

/**
 * Summarize per-role status in stable role order (reasoning, coding, fast).
 * Purely derived from {@link resolveModelRoutes}; never throws.
 */
export function summarizeRoleRoutes(
  routes: readonly ResolvedRoutePayload[],
): readonly RoleRouteStatus[] {
  return MODEL_ROLES.map((role) => {
    const route = routes.find((r) => r.role === role);
    return {
      role,
      configured: route !== undefined,
      provider: route?.provider ?? '(unresolved)',
      model: route?.model,
      source: route?.source ?? '(none)',
    };
  });
}

/**
 * True when the resolved config carries ANY explicit model configuration
 * (i.e. the user configured something, as opposed to running on pure
 * defaults). Used by `doctor` to distinguish "intentional fake mode" from
 * "fresh installation that was never configured".
 */
export function hasExplicitModelConfig(config: DevForgeConfig): boolean {
  return (
    config.provider !== 'fake' ||
    config.model !== undefined ||
    config.baseUrl !== undefined ||
    config.apiKey !== undefined ||
    config.roleModels !== undefined
  );
}

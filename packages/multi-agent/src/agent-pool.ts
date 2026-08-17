/**
 * @devforge/multi-agent — Agent pool (DF-022).
 *
 * A registry of role agents used by the coordinator to execute tasks. Each
 * role has at most one agent registered; the pool resolves tasks to their
 * role's agent deterministically and reports availability.
 */

import type { AgentRole, Task } from './types.js';
import type { RoleAgent } from './roles/agent.js';
import { MultiAgentRoleUnavailableError } from './errors.js';

/** A pool that holds one agent per role. */
export class AgentPool {
  private readonly agentsByRole = new Map<AgentRole, RoleAgent>();

  /** Register (or replace) an agent for a role. */
  register(agent: RoleAgent): void {
    this.agentsByRole.set(agent.role, agent);
  }

  /** Remove an agent for a role. */
  unregister(role: AgentRole): void {
    this.agentsByRole.delete(role);
  }

  /** Get the agent for a role, or throw when unavailable. */
  require(role: AgentRole): RoleAgent {
    const agent = this.agentsByRole.get(role);
    if (!agent) {
      throw new MultiAgentRoleUnavailableError(`no agent registered for role ${role}`);
    }
    return agent;
  }

  /** Get the agent for a task's role, or undefined. */
  get(task: Task | AgentRole): RoleAgent | undefined {
    const role = typeof task === 'string' ? task : task.role;
    return this.agentsByRole.get(role);
  }

  /** Whether a role has a registered agent. */
  has(role: AgentRole): boolean {
    return this.agentsByRole.has(role);
  }

  /** All registered roles, in canonical order. */
  roles(): readonly AgentRole[] {
    return [...this.agentsByRole.keys()];
  }

  /** Number of registered agents. */
  get size(): number {
    return this.agentsByRole.size;
  }

  /** Remove all agents. */
  clear(): void {
    this.agentsByRole.clear();
  }
}

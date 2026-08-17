import { describe, expect, it } from 'vitest';
import { AgentPool } from '../src/agent-pool.js';
import { MultiAgentRoleUnavailableError } from '../src/errors.js';
import { makeTask, roleAgent } from './helpers/mock.js';

describe('AgentPool', () => {
  it('starts empty', () => {
    const pool = new AgentPool();
    expect(pool.size).toBe(0);
    expect(pool.roles()).toEqual([]);
  });

  it('registers an agent and reports it', () => {
    const pool = new AgentPool();
    const agent = roleAgent('CODER', () => ({ ok: true, artifacts: [], messages: [] }));
    pool.register(agent);
    expect(pool.size).toBe(1);
    expect(pool.has('CODER')).toBe(true);
    expect(pool.require('CODER')).toBe(agent);
  });

  it('resolves an agent from a task by role', () => {
    const pool = new AgentPool();
    const agent = roleAgent('TESTER', () => ({ ok: true, artifacts: [], messages: [] }));
    pool.register(agent);
    const task = makeTask({ role: 'TESTER', kind: 'TEST' });
    expect(pool.get(task)).toBe(agent);
  });

  it('get returns undefined for an unregistered role', () => {
    const pool = new AgentPool();
    expect(pool.get('CODER')).toBeUndefined();
    expect(pool.get(makeTask({ role: 'CODER' }))).toBeUndefined();
  });

  it('require throws a typed error when the role is unavailable', () => {
    const pool = new AgentPool();
    expect(() => pool.require('CODER')).toThrow(MultiAgentRoleUnavailableError);
    expect(() => pool.require('CODER')).toThrow(/no agent registered for role CODER/);
  });

  it('replaces an existing agent for the same role', () => {
    const pool = new AgentPool();
    const first = roleAgent('CODER', () => ({ ok: true, artifacts: [], messages: [] }));
    const second = roleAgent('CODER', () => ({ ok: true, artifacts: [], messages: [] }));
    pool.register(first);
    pool.register(second);
    expect(pool.size).toBe(1);
    expect(pool.require('CODER')).toBe(second);
  });

  it('unregister removes an agent', () => {
    const pool = new AgentPool();
    pool.register(roleAgent('CODER', () => ({ ok: true, artifacts: [], messages: [] })));
    pool.unregister('CODER');
    expect(pool.has('CODER')).toBe(false);
    expect(pool.size).toBe(0);
  });

  it('unregister of an absent role is a no-op', () => {
    const pool = new AgentPool();
    expect(() => pool.unregister('REPAIR')).not.toThrow();
  });

  it('clear removes all agents', () => {
    const pool = new AgentPool();
    pool.register(roleAgent('CODER', () => ({ ok: true, artifacts: [], messages: [] })));
    pool.register(roleAgent('REPAIR', () => ({ ok: true, artifacts: [], messages: [] })));
    pool.clear();
    expect(pool.size).toBe(0);
    expect(pool.roles()).toEqual([]);
  });

  it('supports all six canonical roles independently', () => {
    const pool = new AgentPool();
    for (const role of ['PLANNER', 'CODER', 'REVIEWER', 'TESTER', 'REPAIR', 'DOCUMENTATION']) {
      pool.register(roleAgent(role, () => ({ ok: true, artifacts: [], messages: [] })));
    }
    expect(pool.size).toBe(6);
    expect(pool.roles().sort()).toEqual([
      'CODER',
      'DOCUMENTATION',
      'PLANNER',
      'REPAIR',
      'REVIEWER',
      'TESTER',
    ]);
  });

  it('keeps agents isolated between distinct pools', () => {
    const a = new AgentPool();
    const b = new AgentPool();
    a.register(roleAgent('CODER', () => ({ ok: true, artifacts: [], messages: [] })));
    expect(a.has('CODER')).toBe(true);
    expect(b.has('CODER')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { Conversation } from '../src/conversation.js';
import { taskAssigned, runStarted } from '../src/message.js';

describe('Conversation', () => {
  it('stamps increasing indices in post order', () => {
    const c = new Conversation('run-1');
    c.post(runStarted({ at: 0, goal: 'g' }));
    c.post(taskAssigned({ at: 1, taskId: 'a', role: 'CODER', title: 'A' }));
    c.post(taskAssigned({ at: 2, taskId: 'b', role: 'CODER', title: 'B' }));
    expect(c.all().map((m) => m.index)).toEqual([0, 1, 2]);
    expect(c.all().map((m) => m.id)).toEqual(['run-1:0', 'run-1:1', 'run-1:2']);
  });

  it('returns all in post order', () => {
    const c = new Conversation('r');
    c.post(runStarted({ at: 0, goal: 'g' }));
    c.post(taskAssigned({ at: 1, taskId: 'a', role: 'CODER', title: 'A' }));
    expect(c.size).toBe(2);
    expect(c.all()[1].taskId).toBe('a');
  });

  it('filters by type', () => {
    const c = new Conversation('r');
    c.post(runStarted({ at: 0, goal: 'g' }));
    c.post(taskAssigned({ at: 1, taskId: 'a', role: 'CODER', title: 'A' }));
    const assigned = c.byType('TASK_ASSIGNED');
    expect(assigned).toHaveLength(1);
  });

  it('filters by task', () => {
    const c = new Conversation('r');
    c.post(taskAssigned({ at: 0, taskId: 'a', role: 'CODER', title: 'A' }));
    c.post(taskAssigned({ at: 1, taskId: 'b', role: 'CODER', title: 'B' }));
    expect(c.byTask('a')).toHaveLength(1);
    expect(c.byTask('b')).toHaveLength(1);
  });

  it('filters by role', () => {
    const c = new Conversation('r');
    c.post(taskAssigned({ at: 0, taskId: 'a', role: 'CODER', title: 'A' }));
    c.post(taskAssigned({ at: 1, taskId: 'b', role: 'REVIEWER', title: 'B' }));
    expect(c.byRole('REVIEWER')).toHaveLength(1);
  });

  it('presents the last message', () => {
    const c = new Conversation('r');
    c.post(runStarted({ at: 0, goal: 'g' }));
    c.post(taskAssigned({ at: 1, taskId: 'a', role: 'CODER', title: 'A' }));
    expect(c.last()?.taskId).toBe('a');
  });

  it('is empty initially', () => {
    const c = new Conversation('r');
    expect(c.size).toBe(0);
    expect(c.last()).toBeUndefined();
  });

  it('notifies subscribed listeners in post order', () => {
    const c = new Conversation('r');
    const seen: string[] = [];
    c.subscribe((m) => seen.push(m.type));
    c.post(runStarted({ at: 0, goal: 'g' }));
    c.post(taskAssigned({ at: 1, taskId: 'a', role: 'CODER', title: 'A' }));
    expect(seen).toEqual(['RUN_STARTED', 'TASK_ASSIGNED']);
  });

  it('unsubscribe stops delivery', () => {
    const c = new Conversation('r');
    const seen: string[] = [];
    const unsubscribe = c.subscribe((m) => seen.push(m.type));
    c.post(runStarted({ at: 0, goal: 'g' }));
    unsubscribe();
    c.post(taskAssigned({ at: 1, taskId: 'a', role: 'CODER', title: 'A' }));
    expect(seen).toEqual(['RUN_STARTED']);
  });

  it('clear wipes messages and resets indices', () => {
    const c = new Conversation('r');
    c.post(runStarted({ at: 0, goal: 'g' }));
    c.clear();
    expect(c.size).toBe(0);
    c.post(runStarted({ at: 1, goal: 'g2' }));
    expect(c.all()[0].index).toBe(0);
  });

  it('honours a custom start index', () => {
    const c = new Conversation('r', { startIndex: 10 });
    c.post(runStarted({ at: 0, goal: 'g' }));
    expect(c.all()[0].index).toBe(10);
  });

  it('delivers to the constructor listener', () => {
    const seen: string[] = [];
    const c = new Conversation('r', {
      listener: (m) => seen.push(m.type),
    });
    c.post(runStarted({ at: 0, goal: 'g' }));
    expect(seen).toEqual(['RUN_STARTED']);
  });

  it('is deterministic for identical posting sequences', () => {
    const a = new Conversation('r');
    const b = new Conversation('r');
    a.post(taskAssigned({ at: 0, taskId: 'x', role: 'CODER', title: 'X' }));
    b.post(taskAssigned({ at: 0, taskId: 'x', role: 'CODER', title: 'X' }));
    expect(a.all()).toEqual(b.all());
  });
});
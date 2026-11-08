import { describe, expect, it } from 'vitest';
import { registerEntries, registerSummary } from './register';
import { storeSolve } from './act/solution';
import { followEntry } from './act/follow';

describe('the solutions register', () => {
  it('lists solutions, steps and follow-ups — never bookkeeping — newest first', () => {
    const rows = [
      {
        id: 'a',
        title: 'Lights left on',
        proposedActions: [
          storeSolve({ kind: 'home', entities: ['light.study'] }, { at: '2026-10-28T21:00:00Z', entities: ['light.study'], message: 'Turned off light.study.', undoneAt: null }),
          { kind: 'replaces', label: 'Replaces 1', payload: '[]', done: { at: '2026-10-28T20:00:00Z' } },
        ],
      },
      {
        id: 'b',
        title: 'Sleep is short',
        proposedActions: [
          storeSolve({ kind: 'track', metric: 'sleep_hours', goal: 'at_least', target: 7.5, days: 21, label: 'Sleep 7.5 h' }, { at: '2026-10-29T07:00:00Z', ref: 't1', href: '/jkai/daydreams/solutions#tracker-t1', undoneAt: null }),
          followEntry('research', 'Research started', { sessionId: 's1' }, new Date('2026-10-20T09:00:00Z')),
        ],
      },
      { id: 'c', title: 'Not acted on', proposedActions: [storeSolve({ kind: 'open', url: '/trips', label: 'Open your trips' })] },
    ];
    const entries = registerEntries(rows);
    expect(entries.map((e) => [e.thoughtId, e.kind, e.state])).toEqual([
      ['b', 'Tracker', 'running'],
      ['a', 'Home Assistant', 'done'],
      ['b', 'Research run', 'done'],
    ]);
    expect(entries[2].href).toBe('/research/s1');
    expect(registerSummary(entries, new Date('2026-10-29T12:00:00Z'))).toMatchObject({ total: 3, last30: 3, running: 1 });
  });
});

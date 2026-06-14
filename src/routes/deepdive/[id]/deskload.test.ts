import { describe, it, expect } from 'vitest';
import { buildDeskLoad } from './deskload';

const row = {
  id: 'abc',
  topic: 'UK civil-service AI hiring',
  status: 'phase2',
  goals: ['focus on Whitehall'],
  shareToken: null,
  createdAt: new Date('2026-06-14T10:00:00.000Z'),
  completedAt: null,
};

describe('buildDeskLoad', () => {
  it('projects the session into the desk metadata shape', () => {
    expect(buildDeskLoad(row)).toEqual({
      session: {
        id: 'abc',
        topic: 'UK civil-service AI hiring',
        status: 'phase2',
        goals: ['focus on Whitehall'],
        shareToken: null,
        createdAt: '2026-06-14T10:00:00.000Z',
        completedAt: null,
      },
      mode: 'deep',
    });
  });
  it('serialises completedAt when present', () => {
    const done = { ...row, status: 'complete', completedAt: new Date('2026-06-14T11:00:00.000Z') };
    expect(buildDeskLoad(done).session.completedAt).toBe('2026-06-14T11:00:00.000Z');
  });
  it('coerces null goals to an empty array', () => {
    expect(buildDeskLoad({ ...row, goals: null }).session.goals).toEqual([]);
  });
});

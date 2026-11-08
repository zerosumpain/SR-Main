import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PushMessage } from '$lib/server/apns';

vi.mock('$lib/db', () => ({ db: {} }));
vi.mock('$lib/home/presence/companion-accounts', () => ({ pilotSteps: async () => ({ ok: false, reason: 'not-found' }) }));
vi.mock('$lib/server/access', () => ({
  getOwnerEmails: () => ['owner@example.test', 'owner.alt@example.test'],
  isOwnerEmail: (e: string) => ['owner@example.test', 'owner.alt@example.test'].includes(e.trim().toLowerCase()),
}));
vi.mock('$lib/family/roster.server', () => ({
  familyRoster: async () => [
    { id: 'f_owner', email: 'owner@example.test', name: 'Owner', parent: true, pilot: true, stepsSharing: true },
    { id: 'f_kid', email: 'kid@example.test', name: 'Kid', parent: false, pilot: true, stepsSharing: true },
    { id: 'f_parent', email: 'parent@example.test', name: 'Parent', parent: true, pilot: false },
  ],
  nameFromEmail: (e: string) => e,
}));

const { askForSteps, resetStepsAsk } = await import('./steps.server');

function harness(sent = 2) {
  const pushes: Array<{ emails: readonly string[]; message: PushMessage }> = [];
  const push = vi.fn(async (emails: readonly string[], message: PushMessage) => {
    pushes.push({ emails, message });
    return { reached: new Set<string>(), sent, failed: 0 };
  });
  const later: number[] = [];
  return { push, pushes, later, schedule: (ms: number) => void later.push(ms) };
}

const T0 = new Date('2026-10-27T12:00:00Z');

beforeEach(() => resetStepsAsk());

describe('askForSteps', () => {
  it('silently pushes everybody else, then re-reads the pilot at +25 s and +60 s', async () => {
    const h = harness(3);
    expect(await askForSteps('kid@example.test', T0, h.push, h.schedule)).toEqual({ asked: 3, people: 2, throttled: false });
    expect([...h.pushes[0].emails].sort()).toEqual(['owner.alt@example.test', 'owner@example.test', 'parent@example.test']);
    expect(h.pushes[0].message).toMatchObject({ background: true, userInfo: { category: 'family-report', reason: 'steps' } });
    expect(h.later).toEqual([25_000, 60_000]);
  });

  it('never wakes the owner’s own phones when the owner asks', async () => {
    const h = harness();
    await askForSteps('owner.alt@example.test', T0, h.push, h.schedule);
    expect([...h.pushes[0].emails].sort()).toEqual(['kid@example.test', 'parent@example.test']);
  });

  it('asks nobody again inside the minute, whoever opens the screen', async () => {
    const h = harness();
    await askForSteps('kid@example.test', T0, h.push, h.schedule);
    expect(await askForSteps('parent@example.test', new Date(T0.getTime() + 59_000), h.push, h.schedule)).toEqual({
      asked: 0, people: 0, throttled: true,
    });
    expect(h.push).toHaveBeenCalledTimes(1);
    expect(h.later).toEqual([25_000, 60_000]);
    expect((await askForSteps('parent@example.test', new Date(T0.getTime() + 60_000), h.push, h.schedule)).throttled).toBe(false);
    expect(h.push).toHaveBeenCalledTimes(2);
  });
});

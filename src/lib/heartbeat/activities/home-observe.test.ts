import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  members: null as unknown[] | null,
  membersFail: false,
  polled: [] as string[],
  companionCalls: 0,
  pushFresh: false,
}));

vi.mock('$lib/home/presence/members', async (orig) => {
  const real = await orig<typeof import('$lib/home/presence/members')>();
  return {
    ...real,
    listMembers: async () => {
      if (h.membersFail) throw new Error('db hiccup');
      return h.members;
    },
  };
});

vi.mock('$lib/home/presence/observe', () => ({
  hasFreshFix: async () => h.pushFresh,
  pollAllSubjects: async (subjects: Array<{ subject: string; entity: string }>) => {
    h.polled = subjects.map((s) => `${s.subject}=${s.entity}`);
    return new Map(subjects.map((s) => [s.subject, { fix: { lat: 51, lon: -1 } }]));
  },
  recordFix: async () => ({ id: 1, isHome: false, placeId: null, mode: 'unknown' }),
  recordGap: async () => {},
}));

vi.mock('$lib/home/presence/companion', () => ({
  ingestCompanion: async () => {
    h.companionCalls++;
    return { pages: 1, written: 2, dropped: 1, rejected: 0, more: false };
  },
}));

import { homeObserve } from './home-observe';
import { FAMILY_SUBJECTS } from '$lib/home/presence/types';

const ctx = { config: {} } as unknown as Parameters<typeof homeObserve.run>[0];

function member(subject: string, source: string, entity: string | null = `person.${subject}`) {
  return {
    subject,
    email: `${subject}@example.test`,
    displayName: subject,
    source,
    haPersonEntity: entity,
    whatsapp: null,
    alerts: {},
  };
}

beforeEach(() => {
  h.members = null;
  h.membersFail = false;
  h.polled = [];
  h.companionCalls = 0;
  h.pushFresh = false;
});

describe('home-observe', () => {
  it('polls Home Assistant only for life360 members, then pulls the companion lane', async () => {
    h.members = [member('p', 'life360'), member('q', 'companion'), member('r', 'none')];
    const res = await homeObserve.run(ctx);
    expect(h.polled).toEqual(['p=person.p']);
    expect(h.companionCalls).toBe(1);
    expect(res.summary).toContain('companion: 2 written, 1 unmapped');
  });

  it('falls back to the seed list when the members read fails, and skips companion', async () => {
    h.membersFail = true;
    await homeObserve.run(ctx);
    expect(h.polled).toHaveLength(FAMILY_SUBJECTS.length);
    expect(h.companionCalls).toBe(0);
  });

  it('still pulls companion fixes while the push stream lets the poll stand down', async () => {
    h.pushFresh = true;
    h.members = [member('john', 'life360'), member('q', 'companion')];
    const res = await homeObserve.run(ctx);
    expect(h.polled).toEqual([]);
    expect(h.companionCalls).toBe(1);
    expect(res.summary).toContain('push stream fresh');
  });
});

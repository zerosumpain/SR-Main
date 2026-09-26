import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  members: null as unknown[] | null,
  membersFail: false,
  polled: [] as string[],
  companionCalls: 0,
  pushFresh: false,
  alertsFail: false,
  alertCalls: [] as string[],
}));


vi.mock('$lib/home/presence/alerts', () => ({
  runCrossings: async () => {
    h.alertCalls.push('crossings');
    if (h.alertsFail) throw new Error('events table missing');
    return { written: 1, deduped: 0, initialised: [], errors: [] };
  },
  deliverAlerts: async () => {
    h.alertCalls.push('deliver');
    if (h.alertsFail) throw new Error('pilot down');
    return { forwarded: 1, unfollowed: 0, whatsappSent: ['…000'], whatsappFailed: [] };
  },
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

// household-live owns the companion pull now; observe must never make it.
vi.mock('$lib/home/presence/companion', () => ({
  ingestCompanion: async () => {
    h.companionCalls++;
    return { pages: 1, written: 2, dropped: 1, rejected: 0, skipped: 0, more: false };
  },
}));

import { homeObserve } from './home-observe';

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
  h.alertsFail = false;
  h.alertCalls = [];
});

describe('home-observe', () => {
  it('polls Home Assistant only for life360 members, and leaves the companion lane to household-live', async () => {
    h.members = [member('p', 'life360'), member('q', 'companion'), member('r', 'none')];
    await homeObserve.run(ctx);
    expect(h.polled).toEqual(['p=person.p']);
    expect(h.companionCalls).toBe(0);
  });

  it('polls nobody and skips companion when the members read fails, without an error outcome', async () => {
    h.membersFail = true;
    const res = await homeObserve.run(ctx);
    expect(h.polled).toEqual([]);
    expect(h.companionCalls).toBe(0);
    expect(res.outcome).toBe('ok');
    expect(res.summary).toContain('db hiccup');
  });

  it('filters configured subjects through the life360 members', async () => {
    h.members = [member('p', 'life360'), member('q', 'companion')];
    const cfgCtx = {
      config: {
        subjects: [
          { subject: 'p', entity: 'person.p' },
          { subject: 'q', entity: 'person.q' },
          { subject: 'stranger', entity: 'person.stranger' },
        ],
      },
    } as unknown as Parameters<typeof homeObserve.run>[0];
    await homeObserve.run(cfgCtx);
    expect(h.polled).toEqual(['p=person.p']);
  });

  it('stands the poll down while the push stream is fresh', async () => {
    h.pushFresh = true;
    h.members = [member('john', 'life360'), member('q', 'companion')];
    const res = await homeObserve.run(ctx);
    expect(h.polled).toEqual([]);
    expect(res.summary).toContain('push stream fresh');
  });

  it('raises crossings after the fixes are written, then delivers them', async () => {
    h.members = [member('p', 'life360'), member('q', 'companion')];
    const res = await homeObserve.run(ctx);
    expect(h.alertCalls).toEqual(['crossings', 'deliver']);
    expect(res.summary).toContain('crossings: 1 new');
    expect(res.summary).toContain('alerts: 1 to the app, WhatsApp to …000');
  });

  it('never fails the run when crossings or delivery throw', async () => {
    h.alertsFail = true;
    h.members = [member('p', 'life360')];
    const res = await homeObserve.run(ctx);
    expect(res.outcome).toBe('ok');
    expect(res.summary).toContain('crossings failed');
    expect(res.summary).toContain('alerts failed');
  });
});

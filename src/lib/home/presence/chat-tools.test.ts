import { beforeEach, describe, expect, it, vi } from 'vitest';

// The places tools (workflow knit 2026-11-11, slices 3 and 4): the OWNER's own
// saved places and visits, naming a place, merging places, and the forecast's
// scorecard. Nobody else's visits, no coordinate and no address may come out.
// Fixtures are synthetic.

const h = vi.hoisted(() => ({ named: [] as unknown[], confirmed: [] as unknown[], merged: [] as unknown[], confirmFails: false }));
const WHERE = { lat: 12.345678, lon: -98.765432, radiusM: 80, address: '1 Synthetic Street', suggestedAddress: '2 Synthetic Street' };
const visit = (subject: string, n: number) => ({ subject, dateLabel: `${n} Jan`, dayName: 'Someday', timeLabel: 'morning', dwellMins: 30 + n, startedAt: `2026-01-0${n}T09:00:00Z`, ...WHERE });

vi.mock('./members', () => ({ listMembers: async () => [{ subject: 'owner-phone', isOwner: true }, { subject: 'kid-phone', isOwner: false }] }));
vi.mock('./location-hold.server', () => ({ ownerSubjects: (members: Array<{ subject: string; isOwner: boolean }>) => members.filter((m) => m.isOwner).map((m) => m.subject) }));
vi.mock('./forecast-eval.server', () => ({
  loadScorecard: async () => ({
    latest: {
      generatedAt: '2026-01-02T03:00:00Z', from: '2025-12-05', to: '2026-01-01', days: 28, learnDays: 28,
      next: { predictions: 10, hits: 7, precision: 0.7, eligible: 20, foreseen: 9, recall: 0.45, byPerson: [{ subject: 'kid-phone', predictions: 5, hits: 3, eligible: 9, foreseen: 4 }] },
      duration: { trips: 30, estimated: 25, mae: 4, medianError: 3, band: 0.8, p80: 0.79 },
      odds: { trips: 20, offered: 18, top1: 0.5, top2: 0.7, sharpness: 0.4 },
      eta: { checks: 12, offered: 10, rightPlace: 8, wrongPlace: 2, mae: 3, window: 0.75 },
      overdue: { fired: 2, late: 1, skipped: 1, recent: [{ date: '2026-01-01', subject: 'kid-phone', to: 'Synthetic School', outcome: 'late' }] },
    },
    history: Array.from({ length: 30 }, (_, i) => ({ date: `n${i}`, precision: 0.7, recall: 0.4, band: 0.8, p80: 0.8, etaWindow: 0.7, overdueFired: 0, overdueSkipped: 0 })),
  }),
}));
vi.mock('./places', () => ({
  PLACE_KINDS: ['home', 'work', 'school', 'shop', 'other', 'unknown'],
  PLACE_LABEL_MAX: 60,
  isPlaceKind: (k: unknown) => ['home', 'work', 'school', 'shop', 'other', 'unknown'].includes(k as string),
  listPanelPlaces: async () => [
    { id: 'pl1', label: 'Synthetic Gym', kind: 'other', isHome: false, visitCount: 12, lastSeenAt: new Date('2026-01-02T03:04:05Z'), alerts: false, ...WHERE },
    { id: 'pl2', label: null, kind: 'unknown', isHome: false, visitCount: 1, lastSeenAt: null, alerts: false, ...WHERE },
  ],
  listNamingQueue: async () => [
    { id: 'q-mine', suggestedLabel: 'Synthetic Cafe', suggestedKind: 'shop', ...WHERE },
    { id: 'q-theirs', suggestedLabel: 'Synthetic School', suggestedKind: 'school', ...WHERE },
  ],
  getPlaceVisits: async (id: string) => (id === 'q-theirs' ? [visit('kid-phone', 1)] : [visit('kid-phone', 1), visit('owner-phone', 2), visit('owner-phone', 3)]),
  namePlace: async (...a: unknown[]) => (a[0] === 'missing' ? null : (h.named.push(a), { id: a[0] })),
  confirmPlace: async (...a: unknown[]) => {
    if (h.confirmFails) throw new Error('memory is down');
    h.confirmed.push(a);
  },
  mergePlaces: async (...a: unknown[]) => (h.merged.push(a), { merged: (a[1] as string[]).length, centre: WHERE, radiusM: 120 }),
}));

const TIERS: Record<string, [string, string, string]> = {
  places_list: ['read', 'never', 'places'],
  place_visits: ['read', 'never', 'places'],
  forecast_history: ['read', 'never', 'places'],
  place_name: ['mutate', 'light', 'places'],
  place_merge: ['destructive', 'always', 'places'],
};

const { tools } = await import('$lib/tools/registry-internal');
await import('./chat-tools');
const { MEMBER_SAFE_TOOLS, tierOf, principalRefusal } = await import('$lib/tools/invoke-contract');
const { MEMBER_FORBIDDEN_TOOLSETS } = await import('$lib/jkai/member-chat/policy');
const { WHATSAPP_READ_TOOLS } = await import('$lib/integrations/whatsapp/tool-whitelist');

const NAMES = Object.keys(TIERS);
const tool = (name: string) => tools.find((t) => t.name === name)!;
const run = (name: string, args: Record<string, unknown> = {}, principalId?: string) => tool(name).handler(args, { emit: () => {}, ...(principalId ? { principalId } : {}) });

function contract(forbidden = true) {
  it('declare their tier, are owner-only, and are off every member and WhatsApp list', async () => {
    for (const name of NAMES) {
      const t = tool(name);
      expect(tools.filter((x) => x.name === name).length, name).toBe(1);
      expect(tierOf(t), name).toEqual({ effect: TIERS[name][0], confirm: TIERS[name][1], lane: TIERS[name][0] === 'destructive' ? 'destructive' : 'standard' });
      expect(t.toolset, name).toBe(TIERS[name][2]);
      expect(t.surfaces, name).toEqual(['chat', 'app']);
      expect(MEMBER_SAFE_TOOLS.includes(name), name).toBe(false);
      expect((WHATSAPP_READ_TOOLS as readonly string[]).includes(name), name).toBe(false);
      if (forbidden) expect((MEMBER_FORBIDDEN_TOOLSETS as readonly string[]).includes(t.toolset), name).toBe(true);
      expect(JSON.stringify([t.description, t.parameters]), name).not.toMatch(/\b20\d\d-\d\d-\d\d\b|\b\d{1,2}:\d\d\b/);
      const r = await run(name, {}, 'u_member');
      expect(r.success, name).toBe(false);
      expect(r.error, name).toMatch(/owner/);
      expect(principalRefusal({ principalId: 'u_member', via: 'session', attended: true, jobId: 'j', allowedTools: [name] }, { name, tier: tierOf(t) }), name).toBeTruthy();
      if (TIERS[name][0] !== 'read') {
        expect(principalRefusal({ principalId: 'owner', via: 'heartbeat', attended: false }, { name, tier: tierOf(t) }), name).toBeTruthy();
      }
    }
  });
}

const LEAKS = /12\.345678|98\.765432|Synthetic Street|"lat"|"lon"|radiusM|"address"|kid-phone|owner-phone|"centre"/;

describe('places chat tools', () => {
  beforeEach(() => {
    h.named = [];
    h.confirmed = [];
    h.merged = [];
    h.confirmFails = false;
  });
  contract();

  it('places_list names places without where they are, and queues only stops the owner himself made', async () => {
    const r = await run('places_list');
    expect(r.success, r.error).toBe(true);
    expect(r.data).toMatchObject({ named: [{ id: 'pl1', name: 'Synthetic Gym', kind: 'other', visits: 12 }], unnamed: [{ id: 'q-mine', guess: 'Synthetic Cafe', guessKind: 'shop' }] });
    expect((r.data as { named: unknown[]; unnamed: unknown[] }).named).toHaveLength(1);
    expect((r.data as { unnamed: unknown[] }).unnamed).toHaveLength(1);
    const out = JSON.stringify(r.data);
    expect(out).not.toMatch(LEAKS);
    expect(out).not.toMatch(/Synthetic School/);
    expect(((await run('places_list', { unnamed: false })).data as { unnamed: unknown[] }).unnamed).toEqual([]);
  });

  it('place_visits returns the owner\'s visits only, with no subject on them', async () => {
    expect((await run('place_visits', {})).error).toMatch(/placeId/);
    const r = await run('place_visits', { placeId: 'pl1' });
    expect(r.data).toMatchObject({ placeId: 'pl1', count: 2, visits: [{ date: '2 Jan', minutes: 32 }, { date: '3 Jan', minutes: 33 }] });
    expect(JSON.stringify(r.data)).not.toMatch(LEAKS);
    expect((await run('place_visits', { placeId: 'q-theirs' })).data).toMatchObject({ count: 0, visits: [] });
  });

  it('forecast_history gives household totals and drops who went where', async () => {
    const r = await run('forecast_history', { nights: 5 });
    expect(r.success).toBe(true);
    const d = r.data as { scorecard: { next: Record<string, unknown>; overdue: Record<string, unknown> }; history: unknown[] };
    expect(d.scorecard.next).toEqual({ predictions: 10, hits: 7, precision: 0.7, eligible: 20, foreseen: 9, recall: 0.45 });
    expect(d.scorecard.overdue).toEqual({ fired: 2, late: 1, skipped: 1 });
    expect(d.history).toHaveLength(5);
    expect(JSON.stringify(r.data)).not.toMatch(/kid-phone|Synthetic School|byPerson|recent/);
  });

  it('place_name validates, names through namePlace, and survives memory failing', async () => {
    expect((await run('place_name', { placeId: 'pl2', name: '', kind: 'shop' })).error).toMatch(/name/);
    expect((await run('place_name', { placeId: 'pl2', name: 'x'.repeat(61), kind: 'shop' })).error).toMatch(/name/);
    expect((await run('place_name', { placeId: 'pl2', name: 'Synthetic Cafe', kind: 'unknown' })).error).toMatch(/kind/);
    expect((await run('place_name', { placeId: 'missing', name: 'Synthetic Cafe', kind: 'shop' })).error).toMatch(/No such place/);
    expect(h.named).toEqual([]);
    expect((await run('place_name', { placeId: 'pl2', name: ' Synthetic Cafe ', kind: 'shop' })).data).toMatchObject({ placeId: 'pl2', name: 'Synthetic Cafe', kind: 'shop', remembered: true });
    expect(h.named).toEqual([['pl2', 'Synthetic Cafe', 'shop']]);
    h.confirmFails = true;
    expect((await run('place_name', { placeId: 'pl2', name: 'Synthetic Cafe', kind: 'shop' })).data).toMatchObject({ remembered: false });
  });

  it('place_merge is destructive, refused unattended even when allowed, validates its ids and answers with a count only', async () => {
    const t = tool('place_merge');
    expect(principalRefusal({ principalId: 'owner', via: 'service', attended: false, jobId: 'wf:r:n:h', allowedTools: ['place_merge'] }, { name: 'place_merge', tier: tierOf(t) })).toBeTruthy();
    expect((await run('place_merge', { targetId: 'pl1', sourceIds: [] })).success).toBe(false);
    expect((await run('place_merge', { targetId: 'pl1', sourceIds: ['pl1'] })).success).toBe(false);
    expect((await run('place_merge', { targetId: 'pl1', sourceIds: ['a', 'a'] })).success).toBe(false);
    expect((await run('place_merge', { targetId: 'pl1', sourceIds: Array.from({ length: 9 }, (_, i) => `s${i}`) })).success).toBe(false);
    expect(h.merged).toEqual([]);
    const r = await run('place_merge', { targetId: 'pl1', sourceIds: ['pl2'] });
    expect(r.data).toEqual({ placeId: 'pl1', merged: 1, url: '/home/people/places', message: 'Merged. This cannot be undone.' });
    expect(h.merged).toEqual([['pl1', ['pl2'], 'enclose']]);
  });
});

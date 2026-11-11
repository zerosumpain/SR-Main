import { beforeEach, describe, expect, it, vi } from 'vitest';

// The workflow knit's additions to existing tool modules (2026-11-11, slices
// 3 to 5): wish-list offers and sweep, the briefing vote, the solutions
// register and one-press run, the capture follow-up and speaker writes, and
// the event monitor tools. Each declares its tier, is owner-only, and a write
// is refused when nobody is attached. Fixtures are synthetic.

const h = vi.hoisted(() => ({
  swept: 0,
  votes: [] as unknown[],
  ran: [] as unknown[],
  decided: [] as unknown[],
  patched: [] as unknown[],
  created: [] as unknown[],
  removed: [] as string[],
  started: 0,
}));

const ITEM = { id: 'w1', kind: 'hunt', status: 'active', title: 'Synthetic kettle', forPerson: null, deadline: null, criteria: { maxPricePence: 5000, constraints: [] }, targetPricePence: null, feeds: [], urls: [], lastCheckedAt: null, lastError: null };
vi.mock('$lib/wishlist/add.server', () => ({ addWish: async () => null, rereadWish: async () => null }));
vi.mock('$lib/wishlist/store.server', () => ({
  getItem: async (id: string) => (id === 'w1' ? ITEM : null),
  listItems: async () => [ITEM],
  listOffers: async () => [{ id: 'o1', expired: false }, { id: 'o2', expired: true }, { id: 'o3', expired: false }],
  deleteItem: async () => true,
  saveItem: async () => ITEM,
}));
vi.mock('$lib/wishlist/sweep.server', () => ({
  checkItem: async () => null,
  rankOffers: (o: Array<{ expired: boolean }>) => o.filter((x) => !x.expired),
  sweepWishlist: async () => (h.swept++, { due: 2, checked: [{ itemId: 'w1', candidates: 9, kept: 2, notified: 1, errors: ['e'.repeat(900), 'b', 'c', 'd'], internal: 'SECRET_VALUE' }] }),
}));
vi.mock('$lib/wishlist/value', () => ({
  compareRows: (offers: Array<{ id: string }>) =>
    offers.map((o, i) => ({ title: `Synthetic listing ${o.id} ${'t'.repeat(300)}`, url: `https://example.invalid/${o.id}`, merchant: 'Synthetic shop', priceLabel: '£40', priceNote: i ? null : 'with delivery', verdict: 'match', when: null, value: 100 - i, coverage: 1, factors: Array.from({ length: 12 }, (_, n) => ({ label: `f${n}` })), raw: 'SECRET_VALUE' })),
}));

vi.mock('$lib/briefing/dashboard.server', () => ({
  listBriefingDays: async () => [{ id: '2026-01-02' }],
  loadBriefingDay: async (id: string) => (id === '2026-01-02' ? { id, title: 'Synthetic', markdown: '', startedAt: '', detail: null } : null),
}));
vi.mock('$lib/briefing/feedback', () => ({ recordVote: async (...a: unknown[]) => void h.votes.push(a) }));
vi.mock('$lib/server/access', () => ({ getOwnerEmails: () => ['owner@example.invalid'] }));
vi.mock('$lib/today/today.server', () => ({ loadToday: async () => ({}) }));

vi.mock('$lib/daydream/summary.server', () => ({ loadDaydreamSummary: async () => ({ counts: {}, waiting: [], matched: [] }) }));
vi.mock('$lib/daydream/think/notes.server', () => ({ loadFeedNote: async () => null, thinkNoteKind: async (id: string) => (id === 'n1' || id === 'n2' ? 'note' : null) }));
vi.mock('$lib/daydream/register.server', () => ({
  loadRegisterRoom: async () => ({
    entries: [
      { at: '2026-01-02T03:04:05Z', thoughtId: 'n1', noteTitle: 'Synthetic note', kind: 'tracker', what: 'Started a tracker', state: 'running', result: null, href: '/jkai/daydreams?note=n1' },
      { at: '2026-01-01T03:04:05Z', thoughtId: 'n2', noteTitle: 'N'.repeat(400), kind: 'build', what: 'Queued a build', state: 'done', result: 'r'.repeat(900), href: null },
    ],
  }),
}));
vi.mock('$lib/daydream/act/solution.server', () => ({
  runSolution: async (id: string, ports: unknown) => (h.ran.push([id, ports]), id === 'n1' ? { ok: true, message: 'Tracker started.', href: '/jkai/x' } : { ok: false, reason: 'This note has no solution.' }),
}));
vi.mock('$lib/selfimprove/follow-ports.server', () => ({ backlogPorts: { synthetic: true } }));

const ACTION = { id: 'act_1', captureId: 'cap_abc', kind: 'reminder', title: 'Synthetic reminder', detail: null, who: null, dueAt: null, params: { secret: 'SECRET_VALUE' }, state: 'approved', refKind: null, refId: null, error: null, createdAt: new Date('2026-01-02T03:04:05Z'), decidedAt: null };
vi.mock('$lib/captures/store.server', () => ({ recorderSpace: () => 'owner' }));
vi.mock('$lib/captures/search.server', () => ({ searchCaptures: async () => ({ captures: [], entities: [] }), captureEntityPage: async () => null, findPersonEntity: async () => null }));
vi.mock('$lib/captures/service.server', () => ({
  captureWithActions: async () => null,
  isRefusal: (v: unknown) => !!v && typeof v === 'object' && 'error' in (v as object) && 'status' in (v as object),
  decideAction: async (...a: unknown[]) => (h.decided.push(a), a[2] === 'gone' ? { status: 404, error: 'No such follow-up.' } : { ...ACTION, state: (a[3] as { decision: string }).decision === 'approve' ? 'approved' : 'dismissed' }),
  patchCapture: async (...a: unknown[]) => {
    h.patched.push(a);
    const s = (a[2] as { speakers: Array<{ label: string; confirmed: { name: string } | null }> }).speakers[0];
    return { id: a[1], speakers: [{ label: s.label, confirmed: s.confirmed }, { label: 'Speaker 2' }] };
  },
}));

vi.mock('$lib/monitors/monitors.server', () => ({ createMonitor: async () => null, listMonitors: async () => [] }));
vi.mock('$lib/monitors/event-monitors.server', () => ({
  startEventMonitors: () => void h.started++,
  listEventMonitors: async () => [{ id: 'em_abc', eventType: 'release.live', filter: [], label: 'Synthetic', minMinutes: 10, createdAt: 'x' }],
  createEventMonitor: async (input: Record<string, unknown>) => (h.created.push(input), input.eventType === 'release.live' ? { ok: true, monitor: { id: 'em_abc', eventType: 'release.live', filter: [], label: 'Synthetic', minMinutes: 10, createdAt: 'x' } } : { ok: false, error: 'event must be an event type from the catalogue' }),
  removeEventMonitor: async (id: string) => (h.removed.push(id), id === 'em_abc' ? { id, eventType: 'release.live' } : null),
}));

const { tools } = await import('../registry-internal');
await import('./wishlist');
await import('./briefing');
await import('./monitors');
await import('$lib/daydream/chat-tools');
await import('$lib/captures/chat-tools');
const { MEMBER_SAFE_TOOLS, tierOf, principalRefusal } = await import('../invoke-contract');
const { WHATSAPP_READ_TOOLS } = await import('$lib/integrations/whatsapp/tool-whitelist');
const { EVENT_CATALOGUE } = await import('$lib/events/catalogue');

const TIERS: Record<string, [string, string, string]> = {
  wishlist_offers: ['read', 'never', 'wishlist'],
  wishlist_sweep: ['mutate', 'light', 'wishlist'],
  briefing_vote: ['mutate', 'light', 'briefing'],
  solutions_register: ['read', 'never', 'daydream'],
  solution_run: ['mutate', 'always', 'daydream'],
  capture_followup_decide: ['mutate', 'always', 'captures'],
  capture_speaker_rename: ['mutate', 'light', 'captures'],
  event_monitor_create: ['mutate', 'light', 'monitors'],
  event_monitor_list: ['read', 'never', 'monitors'],
  event_monitor_remove: ['mutate', 'light', 'monitors'],
};
const NAMES = Object.keys(TIERS);
const tool = (name: string) => tools.find((t) => t.name === name)!;
const run = (name: string, args: Record<string, unknown> = {}, principalId?: string) => tool(name).handler(args, { emit: () => {}, ...(principalId ? { principalId } : {}) });

describe('workflow knit additions to existing tool modules', () => {
  beforeEach(() => {
    h.swept = 0;
    h.votes = [];
    h.ran = [];
    h.decided = [];
    h.patched = [];
    h.created = [];
    h.removed = [];
  });

  it('declare their tier, are owner-only, off the member and WhatsApp lists, and a write needs John attached', async () => {
    for (const name of NAMES) {
      const t = tool(name);
      expect(tools.filter((x) => x.name === name).length, name).toBe(1);
      expect(tierOf(t), name).toEqual({ effect: TIERS[name][0], confirm: TIERS[name][1], lane: 'standard' });
      expect(t.toolset, name).toBe(TIERS[name][2]);
      expect(t.surfaces, name).toEqual(['chat', 'app']);
      expect(MEMBER_SAFE_TOOLS.includes(name), name).toBe(false);
      expect((WHATSAPP_READ_TOOLS as readonly string[]).includes(name), name).toBe(false);
      expect(JSON.stringify([t.description, t.parameters]), name).not.toMatch(/\b20\d\d-\d\d-\d\d\b|\b\d{1,2}:\d\d\b/);
      const r = await run(name, {}, 'u_member');
      expect(r.success, name).toBe(false);
      expect(r.error, name).toMatch(/owner/);
      expect(principalRefusal({ principalId: 'u_member', via: 'session', attended: true, jobId: 'j', allowedTools: [name] }, { name, tier: tierOf(t) }), name).toBeTruthy();
      if (TIERS[name][0] !== 'read') expect(principalRefusal({ principalId: 'owner', via: 'heartbeat', attended: false }, { name, tier: tierOf(t) }), name).toBeTruthy();
    }
    expect([h.swept, h.votes, h.ran, h.decided, h.patched, h.created, h.removed]).toEqual([0, [], [], [], [], [], []]);
  });

  it('nothing here merges a pull request, raises an alarm, makes a share link or sends a daydream', () => {
    const held = /^(pull_(merge|close|revert)|pr_(merge|close|revert)|app_release|alarm_(raise|hold)|family_alarm_(raise|hold)|share_(create|revoke|password)|share_link_(create|revoke)|daydream_send|daydream_autonomy|bank_reconnect|trip_decision)/;
    expect(tools.map((t) => t.name).filter((n) => held.test(n))).toEqual([]);
  });

  it('wishlist_offers compares the live listings of one wish, compactly', async () => {
    expect((await run('wishlist_offers', {})).error).toMatch(/id/);
    expect((await run('wishlist_offers', { id: 'nope' })).error).toMatch(/No wish/);
    const r = await run('wishlist_offers', { id: 'w1', limit: 1 });
    const d = r.data as { found: number; offers: Array<Record<string, unknown>> };
    expect(d.found).toBe(2);
    expect(d.offers).toHaveLength(1);
    expect((d.offers[0].title as string).length).toBe(160);
    expect(d.offers[0]).toMatchObject({ merchant: 'Synthetic shop', price: '£40', priceNote: 'with delivery', verdict: 'match', value: 100 });
    expect(d.offers[0].factors).toHaveLength(8);
    expect(d.offers[0]).not.toHaveProperty('when');
    expect(JSON.stringify(r.data)).not.toMatch(/SECRET_VALUE/);
  });

  it('wishlist_sweep runs the sweep once and reports counts', async () => {
    const r = await run('wishlist_sweep');
    expect(h.swept).toBe(1);
    const d = r.data as { due: number; checked: Array<{ id: string; errors: string[] }> };
    expect(d).toMatchObject({ due: 2, checked: [{ id: 'w1', candidates: 9, kept: 2, notified: 1 }] });
    expect(d.checked[0].errors).toHaveLength(3);
    expect(d.checked[0].errors[0]).toHaveLength(200);
    expect(JSON.stringify(r.data)).not.toMatch(/SECRET_VALUE/);
  });

  it('briefing_vote validates, defaults to the newest briefing and records through recordVote', async () => {
    expect((await run('briefing_vote', { vote: 'sideways' })).error).toMatch(/up or down/);
    expect((await run('briefing_vote', { vote: 'up', day: 'yesterday' })).error).toMatch(/YYYY-MM-DD/);
    expect((await run('briefing_vote', { vote: 'up', day: '2026-01-09' })).error).toMatch(/No briefing/);
    expect(h.votes).toEqual([]);
    expect((await run('briefing_vote', { vote: 'down', what: ` ${'w'.repeat(300)} ` })).data).toMatchObject({ day: '2026-01-02', vote: 'down' });
    expect(h.votes).toEqual([['2026-01-02', 'down', 'w'.repeat(120)]]);
    expect((await run('briefing_vote', { vote: 'up', day: '2026-01-02' })).data).toMatchObject({ what: null });
    expect(h.votes[1]).toEqual(['2026-01-02', 'up', '']);
  });

  it('solutions_register lists compact entries and filters by state', async () => {
    const all = (await run('solutions_register')).data as { total: number; entries: Array<Record<string, string>> };
    expect(all.total).toBe(2);
    expect(all.entries[0]).toEqual({ at: '2026-01-02T03:04:05Z', noteId: 'n1', note: 'Synthetic note', kind: 'tracker', what: 'Started a tracker', state: 'running', url: '/jkai/daydreams?note=n1' });
    expect(all.entries[1].note).toHaveLength(160);
    expect(all.entries[1].result).toHaveLength(300);
    expect(((await run('solutions_register', { state: 'done' })).data as { total: number }).total).toBe(1);
    expect(((await run('solutions_register', { limit: 1 })).data as { entries: unknown[] }).entries).toHaveLength(1);
  });

  it('solution_run goes through runSolution with the backlog ports and reports a refusal', async () => {
    expect((await run('solution_run', {})).error).toMatch(/id/);
    expect((await run('solution_run', { id: 'missing' })).error).toMatch(/No such note/);
    expect(h.ran).toEqual([]);
    expect((await run('solution_run', { id: 'n1' })).data).toEqual({ id: 'n1', message: 'Tracker started.', url: '/jkai/x' });
    expect(h.ran).toEqual([['n1', { synthetic: true }]]);
    expect(await run('solution_run', { id: 'n2' })).toMatchObject({ success: false, error: 'This note has no solution.' });
  });

  it('capture_followup_decide validates and decides through decideAction', async () => {
    expect((await run('capture_followup_decide', { captureId: 'nope', actionId: 'act_1', decision: 'approve' })).error).toMatch(/cap_/);
    expect((await run('capture_followup_decide', { captureId: 'cap_abc', actionId: 'a b', decision: 'approve' })).error).toMatch(/actionId/);
    expect((await run('capture_followup_decide', { captureId: 'cap_abc', actionId: 'act_1', decision: 'maybe' })).error).toMatch(/approve or dismiss/);
    expect(h.decided).toEqual([]);
    const r = await run('capture_followup_decide', { captureId: 'cap_abc', actionId: 'act_1', decision: 'dismiss' });
    expect(r.data).toEqual({ captureId: 'cap_abc', action: { id: 'act_1', kind: 'reminder', title: 'Synthetic reminder', state: 'dismissed' }, deepLink: 'sr://captures/cap_abc' });
    expect(h.decided).toEqual([['owner', 'cap_abc', 'act_1', { decision: 'dismiss' }]]);
    expect(await run('capture_followup_decide', { captureId: 'cap_abc', actionId: 'gone', decision: 'approve' })).toEqual({ success: false, error: 'No such follow-up.' });
  });

  it('capture_speaker_rename names or clears one speaker through patchCapture', async () => {
    expect((await run('capture_speaker_rename', { captureId: 'cap_abc', speaker: '' })).error).toMatch(/speaker/);
    expect((await run('capture_speaker_rename', { captureId: 'cap_abc', speaker: 'Speaker 1' })).error).toMatch(/name/);
    expect(h.patched).toEqual([]);
    const r = await run('capture_speaker_rename', { captureId: 'cap_abc', speaker: 'Speaker 1', name: ' Synthetic Person ' });
    expect(r.data).toMatchObject({ captureId: 'cap_abc', speakers: [{ label: 'Speaker 1', name: 'Synthetic Person', confirmed: true }, { label: 'Speaker 2', name: 'Speaker 2' }] });
    expect(h.patched[0]).toEqual(['owner', 'cap_abc', { speakers: [{ label: 'Speaker 1', confirmed: { name: 'Synthetic Person' } }] }]);
    await run('capture_speaker_rename', { captureId: 'cap_abc', speaker: 'Speaker 1', clear: true });
    expect(h.patched[1]).toEqual(['owner', 'cap_abc', { speakers: [{ label: 'Speaker 1', confirmed: null }] }]);
  });

  it('the event monitor tools start the subscription, create, list with the catalogue, and remove by id', async () => {
    expect(h.started).toBe(1);
    expect((await run('event_monitor_create', { event: 'nope' })).success).toBe(false);
    const made = await run('event_monitor_create', { event: 'release.live', filter: [{ key: 'repo', value: 'x' }], label: 'L', everyMinutes: 5 });
    expect(made.data).toMatchObject({ monitor: { id: 'em_abc' } });
    expect(h.created[1]).toEqual({ eventType: 'release.live', filter: [{ key: 'repo', value: 'x' }], label: 'L', minMinutes: 5 });
    const list = (await run('event_monitor_list')).data as { count: number; eventTypes: Array<{ type: string }> };
    expect(list.count).toBe(1);
    expect(list.eventTypes.map((e) => e.type).sort()).toEqual(EVENT_CATALOGUE.map((e) => e.type).sort());
    expect((await run('event_monitor_remove', { id: 'em_../x' })).error).toMatch(/em_/);
    expect(h.removed).toEqual([]);
    expect((await run('event_monitor_remove', { id: 'em_abc' })).data).toEqual({ removed: 'em_abc', eventType: 'release.live' });
    expect((await run('event_monitor_remove', { id: 'em_def' })).error).toMatch(/No event monitor/);
  });
});

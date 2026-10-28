import { beforeEach, describe, expect, it, vi } from 'vitest';

// Slice 7a's domain tools (overhaul plan 2026-10-28, point 2 and point 8):
// owner reads, trips, captures and the daydream mutates. Every one declares
// its tier, is owner-only and not member-safe, stays off the WhatsApp list,
// carries no time-varying text, and goes through the domain's own functions —
// trip changes through the planner, never the store. Fixtures are synthetic.

const h = vi.hoisted(() => ({
  converse: [] as Array<{ text: string; surface: string; caller: { canEdit: boolean; isOwner: boolean; email?: string } }>,
  undo: [] as Array<{ toVersion: number | null; caller: { name: string | null; surface: string } }>,
  feedback: [] as unknown[],
  reasons: [] as unknown[],
  verdicts: [] as unknown[],
  did: [] as string[],
}));

const TRIP = { id: '11111111-1111-4111-8111-111111111111', ownerEmail: 'owner@example.invalid', title: 'Synthetic Rome', destination: 'Rome', timeZone: 'Europe/Rome', startDate: '2026-11-02', endDate: '2026-11-04', status: 'planning', notes: null };
const PLAN = {
  days: [
    { date: '2026-11-02', stayId: null, legs: [], warnings: [], stops: [{ id: 'w1', kind: 'wish', wishId: 'w1', title: 'Synthetic Colosseum', location: null, arriveMin: 540, departMin: 660, waitSec: 0, locked: true, bookingId: null, warnings: [] }] },
    { date: '2026-11-03', stayId: null, legs: [], warnings: [], stops: [{ id: 'w2', kind: 'wish', wishId: 'w2', title: 'Synthetic Pantheon', location: null, arriveMin: 600, departMin: 660, waitSec: 0, locked: false, bookingId: null, warnings: [] }] },
  ],
  dropped: [],
  warnings: [],
  score: 1,
};

vi.mock('$lib/server/access', () => ({ getOwnerEmails: () => ['owner@example.invalid'] }));
vi.mock('$lib/trips/store.server', () => ({
  getTripById: async (id: string) => (id === TRIP.id ? TRIP : null),
  listAllTrips: async () => [{ ...TRIP, planVersion: 3, updatedAt: '' }],
  latestPlan: async () => ({ version: 3, plan: PLAN }),
  listTransport: async () => [],
  loadState: async () => ({ stays: [], wishes: [], bookings: [] }),
  recentMessages: async () => [{ id: 'm1', role: 'assistant', text: 'Synthetic reply', ops: [], planVersion: null, surface: 'jkai', createdAt: '' }],
  tripOnly: (t: unknown) => t,
  viewerOf: () => ({ email: 'owner@example.invalid', isCreator: true }),
}));
vi.mock('$lib/trips/decisions.store.server', () => ({ listProposals: async () => [{ title: 'Synthetic gelato', why: 'near', kind: 'fill' }], listQuestions: async () => [] }));
vi.mock('$lib/trips/converse.server', () => ({
  converse: async (_trip: unknown, input: (typeof h.converse)[number]) => {
    h.converse.push(input);
    return { reply: 'Done (synthetic).', applied: input.caller.canEdit ? [{ op: 'x' }] : [], rejected: [], quickReplies: [], planVersion: input.caller.canEdit ? 4 : 3, changes: [], research: [], messages: [], proposals: [], questions: [], undo: input.caller.canEdit ? { toVersion: 3 } : null };
  },
}));
vi.mock('$lib/trips/undo.server', () => ({
  undoTo: async (_trip: unknown, toVersion: number | null, caller: (typeof h.undo)[number]['caller']) => {
    h.undo.push({ toVersion, caller });
    return { status: 200, body: { planVersion: 5, changes: ['Undone: synthetic'] } };
  },
}));
vi.mock('$lib/captures/search.server', () => ({
  searchCaptures: async () => ({ captures: [{ id: 'cap_abc', title: 'Synthetic dentist', startedAt: '', durationS: 60, status: 'ready', speakers: [], actionsOpen: 0, snippet: 'dentist', score: 1 }], entities: [] }),
  captureEntityPage: async () => null,
  findPersonEntity: async () => null,
}));
vi.mock('$lib/captures/service.server', () => ({
  captureWithActions: async (_space: string, id: string) =>
    id === 'cap_abc'
      ? { c: { id, title: 'Synthetic dentist', startedAt: new Date('2026-10-01T09:00:00Z'), durationS: 60, status: 'ready', speakers: [], turns: [], transcript: 'x'.repeat(7000), summary: 'Synthetic', flow: [], entities: [], place: null, screen: null, intake: null }, actions: [] }
      : null,
}));
vi.mock('$lib/captures/store.server', () => ({ recorderSpace: () => 'owner' }));
vi.mock('$lib/daydream/thought-store', () => ({ recordFeedback: async (...a: unknown[]) => void h.feedback.push(a) }));
vi.mock('$lib/daydream/reasons.server', () => ({ recordReason: async (...a: unknown[]) => (h.reasons.push(a), { verdict: null }) }));
vi.mock('$lib/daydream/owner-verdict', async (orig) => ({ ...(await orig<typeof import('$lib/daydream/owner-verdict')>()), recordOwnerVerdict: async (...a: unknown[]) => void h.verdicts.push(a) }));
vi.mock('$lib/daydream/act/act.server', () => ({
  doIt: async (id: string) => (h.did.push(`do:${id}`), { ok: true, status: 'done', label: 'Added to your calendar' }),
  undoIt: async (id: string) => (h.did.push(`undo:${id}`), { ok: true, status: 'undone', label: 'Removed' }),
}));
vi.mock('$lib/daydream/summary.server', () => ({ loadDaydreamSummary: async () => ({ counts: {}, waiting: [], matched: [] }) }));
vi.mock('$lib/daydream/think/notes.server', () => ({ loadFeedNote: async () => null }));

const { tools } = await import('../registry-internal');
await import('$lib/owner-data/chat-tools');
await import('$lib/trips/chat-tools');
await import('$lib/captures/chat-tools');
await import('$lib/daydream/chat-tools');
const { MEMBER_SAFE_TOOLS, tierOf, principalRefusal } = await import('../invoke-contract');
const { MEMBER_FORBIDDEN_TOOLSETS } = await import('$lib/jkai/member-chat/policy');
const { WHATSAPP_READ_TOOLS } = await import('$lib/integrations/whatsapp/tool-whitelist');
const { cappedTranscript, captureIdOf, TRANSCRIPT_CAP } = await import('$lib/captures/chat-tools');

const TIERS: Record<string, { effect: string; confirm: string }> = {
  spend_ledger: { effect: 'read', confirm: 'never' },
  diary: { effect: 'read', confirm: 'never' },
  health_hub: { effect: 'read', confirm: 'never' },
  health_series: { effect: 'read', confirm: 'never' },
  health_activities: { effect: 'read', confirm: 'never' },
  trip_list: { effect: 'read', confirm: 'never' },
  trip_get: { effect: 'read', confirm: 'never' },
  trip_thread: { effect: 'read', confirm: 'never' },
  trip_open_items: { effect: 'read', confirm: 'never' },
  trip_ask: { effect: 'mutate', confirm: 'never' },
  trip_converse: { effect: 'mutate', confirm: 'always' },
  trip_undo: { effect: 'mutate', confirm: 'light' },
  capture_search: { effect: 'read', confirm: 'never' },
  capture_get: { effect: 'read', confirm: 'never' },
  capture_person: { effect: 'read', confirm: 'never' },
  daydream_rate: { effect: 'mutate', confirm: 'light' },
  daydream_correct: { effect: 'mutate', confirm: 'light' },
  daydream_double_check: { effect: 'mutate', confirm: 'light' },
  daydream_do: { effect: 'mutate', confirm: 'always' },
};
const NAMES = Object.keys(TIERS);
const tool = (name: string) => tools.find((t) => t.name === name)!;
const run = (name: string, args: Record<string, unknown> = {}, principalId?: string) => tool(name).handler(args, { emit: () => {}, ...(principalId ? { principalId } : {}) });

describe('slice 7a domain tools', () => {
  beforeEach(() => {
    h.converse = [];
    h.undo = [];
    h.feedback = [];
    h.reasons = [];
    h.verdicts = [];
    h.did = [];
  });

  it('each declares its tier on the standard lane, is not member-safe and is off the WhatsApp list', () => {
    for (const name of NAMES) {
      const t = tool(name);
      expect(t, name).toBeTruthy();
      expect(tierOf(t), name).toEqual({ ...TIERS[name], lane: 'standard' });
      expect(MEMBER_SAFE_TOOLS.includes(name), name).toBe(false);
      expect((WHATSAPP_READ_TOOLS as readonly string[]).includes(name), name).toBe(false);
      expect((MEMBER_FORBIDDEN_TOOLSETS as readonly string[]).includes(t.toolset), `${name} in ${t.toolset}`).toBe(true);
      expect(t.surfaces).toEqual(['chat', 'app']);
    }
    expect(new Set(NAMES.map((n) => tool(n).toolset))).toEqual(new Set(['money', 'apple-calendar', 'health', 'trips', 'captures', 'daydream']));
  });

  it('names each tool once', () => {
    for (const name of NAMES) expect(tools.filter((t) => t.name === name).length, name).toBe(1);
  });

  it('carry no time-varying text in their descriptions', () => {
    for (const name of NAMES) {
      const text = JSON.stringify([tool(name).description, tool(name).parameters]);
      expect(text, name).not.toMatch(/\b20\d\d-\d\d-\d\d\b|\b\d{1,2}:\d\d\b|\b(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day\b/);
    }
  });

  it('refuse a member principal in the handler, and principalRefusal refuses members and unattended changes', async () => {
    for (const name of NAMES) {
      const r = await run(name, { tripId: TRIP.id, id: 'n1', captureId: 'cap_abc', name: 'X', question: 'q', request: 'r', metric: 'steps' }, 'u_member');
      expect(r.success, name).toBe(false);
      expect(r.error, name).toMatch(/owner/);
      expect(principalRefusal({ principalId: 'u_member', via: 'session', attended: true, jobId: 'j', allowedTools: [name] }, { name, tier: tierOf(tool(name)) }), name).toBeTruthy();
    }
    for (const name of NAMES.filter((n) => TIERS[n].effect === 'mutate')) {
      expect(principalRefusal({ principalId: 'owner', via: 'whatsapp', attended: false }, { name, tier: tierOf(tool(name)) }), name).toBeTruthy();
      expect(principalRefusal({ principalId: 'owner', via: 'heartbeat', attended: false }, { name, tier: tierOf(tool(name)) }), name).toBeTruthy();
    }
  });

  it("trip_get answers \"what's on day 2\" from the plan, and names the range for a day that is not there", async () => {
    const r = await run('trip_get', { tripId: TRIP.id, day: 2 });
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({ planVersion: 3, url: `/trips/${TRIP.id}`, day: { day: 2, date: '2026-11-03', stops: [{ at: '10:00', until: '11:00', title: 'Synthetic Pantheon' }] } });
    const miss = await run('trip_get', { tripId: TRIP.id, day: 9 });
    expect(miss.success).toBe(false);
    expect(miss.error).toMatch(/2 day\(s\)/);
  });

  it('trip_ask asks the planner in advice-only mode on the jkai surface; trip_converse as an editor with undo', async () => {
    const ask = await run('trip_ask', { tripId: TRIP.id, question: 'Is the Pantheon open?' });
    expect(ask.success).toBe(true);
    expect(h.converse[0]).toMatchObject({ text: 'Is the Pantheon open?', surface: 'jkai', caller: { canEdit: false, isOwner: true, email: 'owner@example.invalid' } });
    const change = await run('trip_converse', { tripId: TRIP.id, request: 'Make day 2 lighter' });
    expect(h.converse[1]).toMatchObject({ surface: 'jkai', caller: { canEdit: true } });
    expect(change.data).toMatchObject({ planVersion: 4, undo: { toVersion: 3 } });
  });

  it('trip_undo goes back through the planner as jkai, and refuses a non-integer version', async () => {
    const r = await run('trip_undo', { tripId: TRIP.id, toVersion: 3 });
    expect(r.success).toBe(true);
    expect(h.undo[0]).toEqual({ toVersion: 3, caller: { name: 'jkai', surface: 'site' } });
    expect((await run('trip_undo', { tripId: TRIP.id, toVersion: 'three' })).success).toBe(false);
  });

  it('capture_get labels the transcript as other people\'s words and caps it', async () => {
    const r = await run('capture_get', { captureId: 'capture:cap_abc', part: 'transcript' });
    expect(r.success).toBe(true);
    const d = r.data as { label: string; transcript: { text: string; truncated: boolean; chars: number } };
    expect(d.label).toMatch(/other people's words/);
    expect(d.transcript.truncated).toBe(true);
    expect(d.transcript.chars).toBe(7000);
    expect(d.transcript.text.length).toBeLessThan(TRANSCRIPT_CAP + 80);
    const search = await run('capture_search', { q: 'dentist' });
    expect((search.data as { captures: Array<{ id: string; deepLink: string }> }).captures[0]).toMatchObject({ id: 'cap_abc', deepLink: 'sr://captures/cap_abc' });
    expect(captureIdOf('cap_1/remember/x')).toBeNull();
    expect(cappedTranscript('short')).toEqual({ text: 'short', truncated: false, chars: 5 });
  });

  it('daydream_rate records a verdict or a reason; daydream_correct keeps his words; daydream_do does and undoes', async () => {
    expect((await run('daydream_rate', { id: 'n1', verdict: 'useful' })).success).toBe(true);
    expect(h.feedback[0]).toEqual(['n1', 'useful', undefined]);
    expect((await run('daydream_rate', { id: 'n1', reason: 'not_now' })).success).toBe(true);
    expect(h.reasons[0]).toEqual(['n1', 'not_now']);
    expect((await run('daydream_rate', { id: 'n1', verdict: 'never_kind' })).success).toBe(false);
    expect((await run('daydream_correct', { id: 'n1', verdict: 'wrong' })).success).toBe(false);
    expect((await run('daydream_correct', { id: 'n1', verdict: 'wrong', why: 'That was a refund, not a payment' })).success).toBe(true);
    expect(h.verdicts[0]).toEqual(['n1', 'wrong', 'That was a refund, not a payment']);
    expect((await run('daydream_do', { id: 'n1' })).data).toMatchObject({ status: 'done', undo: { id: 'n1', undo: true } });
    await run('daydream_do', { id: 'n1', undo: true });
    expect(h.did).toEqual(['do:n1', 'undo:n1']);
  });

  it('never exposes sendIt or a whole-kind mute', () => {
    for (const t of tools.filter((x) => x.toolset === 'daydream')) {
      expect(t.name).not.toMatch(/send/);
      expect(JSON.stringify(t.parameters)).not.toMatch(/never_kind|sendIt/);
    }
  });
});

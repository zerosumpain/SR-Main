import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Trip, Wish } from './model';

// One conversation turn with the store, the places, the planner model and the
// solver stubbed: what is stored, what is applied, when it re-solves.
const h = vi.hoisted(() => ({
  messages: [] as Array<{ role: string; text: string; ops: unknown[]; planVersion: number | null; surface: string }>,
  wishes: [] as Wish[],
  replans: [] as Array<{ source: string; opts: unknown }>,
  research: [] as unknown[],
  model: null as null | ((messages: Array<{ role: string; content: string }>) => unknown),
  seen: [] as Array<Array<{ role: string; content: string }>>,
  solved: [] as unknown[],
  research2: [] as Array<{ tool: string; summary: string; sources: unknown[] }>,
  gathered: 0,
  remembered: [] as unknown[],
  viewers: [] as unknown[],
  // v8
  provenance: [] as Array<Record<string, unknown>>,
  drafts: [] as unknown[][],
  offered: [] as unknown[],
  packPlaces: [] as unknown[],
  questionDrafts: [] as unknown[],
  ensured: [] as unknown[],
  replanChanges: [] as string[],
  latest: null as unknown,
}));

// The agentic first call is the same fake planner; its reply is the JSON text.
vi.mock('./agent.server', () => ({
  agentTurn: async (messages: Array<{ role: string; content: string }>) => {
    h.seen.push(messages);
    if (!h.model) throw new Error('no key');
    return { reply: JSON.stringify(h.model(messages)), research: h.research2, seenUrls: [], toolCalls: h.research2.length };
  },
}));
vi.mock('./options.server', () => ({
  checkOptions: async (_trip: unknown, drafts: Array<{ title: string; date: string; stage: string }>) =>
    drafts.map((d, i) => ({ id: `${d.date}:${d.stage}:${i}`, title: d.title, fit: '14:10–15:10', verdict: { fits: true } })),
}));
// v8: the decisions store, the proposals check and the questions check (S2's stub) are stubs here.
vi.mock('./decisions.store.server', () => ({
  readProvenance: async () => ({}),
  noteProvenance: async (_t: string, p: Record<string, unknown>) => void h.provenance.push(p),
  listPackPlaces: async () => h.packPlaces,
  listProposals: async () => [],
  listQuestions: async () => [],
}));
vi.mock('./proposals.server', () => ({
  checkDrafts: async (_trip: unknown, drafts: Array<{ kind: string; title: string; group: string | null; scope: { date: string; stage: string } }>) => {
    h.drafts.push(drafts);
    const proposals = drafts.map((d, i) => ({ id: `p${i}`, groupId: d.group ?? 'g', kind: d.kind, title: d.title, status: 'open' }));
    const options = drafts.filter((d) => d.kind === 'fill' || d.kind === 'swap').map((d, i) => ({ id: `${d.scope.date}:${d.scope.stage}:${i}`, title: d.title, fit: '14:10–15:10', verdict: { fits: true } }));
    return { proposals, options };
  },
  offerFromPack: async (_trip: unknown, slot: unknown) => {
    h.offered.push(slot);
    return { proposals: [{ id: 'pk1', kind: 'fill', title: 'Palazzo Altemps' }], options: [{ id: 'o1', title: 'Palazzo Altemps' }] };
  },
}));
vi.mock('./questions.server', () => ({
  checkQuestionDrafts: async (_t: unknown, drafts: Array<{ key: string }>) => {
    h.questionDrafts.push(...drafts);
    return drafts.map((d) => ({ id: `q-${d.key}`, key: d.key }));
  },
  refreshQuestions: async () => [],
}));
vi.mock('./pack.server', () => ({ ensurePack: async (_t: unknown, opts: unknown) => void h.ensured.push(opts) }));
vi.mock('./profile.server', () => ({
  gatherProfile: async () => {
    h.gathered++;
    return null;
  },
  rememberStated: async (i: unknown) => {
    h.remembered.push(i);
    return { id: 'mem1', stored: true };
  },
  saveProfile: async () => {},
}));
vi.mock('./llm.server', () => ({
  jsonCall: async (_w: string, messages: Array<{ role: string; content: string }>) => {
    h.seen.push(messages);
    if (!h.model) throw new Error('no key');
    return h.model(messages);
  },
}));
vi.mock('./research.server', () => ({
  findPlace: async (q: string) => (q.startsWith('Pantheon') ? { name: 'Pantheon', location: { lat: 41.8986, lng: 12.4769 }, osmId: 'way/1', address: 'Piazza della Rotonda' } : null),
  findPlaceLoosely: async (q: string) => (q.startsWith('Pantheon') ? { name: 'Pantheon', location: { lat: 41.8986, lng: 12.4769 }, osmId: 'way/1', address: 'Piazza della Rotonda' } : null),
  startResearch: async (...args: unknown[]) => {
    h.research.push(args[2]);
    return true;
  },
  suggestNearby: async () => null,
}));
// The solver's answer per re-solve: the plan after the first ops, then after any correction.
const stop = (id: string, title: string, arriveMin: number, departMin: number) => ({ id, kind: 'wish', wishId: id, title, location: null, arriveMin, departMin, waitSec: 0, locked: false, bookingId: null, warnings: [] });
const day = (date: string, stops: ReturnType<typeof stop>[]) => ({ date, stayId: 's', stops, legs: [], warnings: [] });
const BEFORE = { days: [day('2026-10-28', [stop('a', 'Colosseum', 570, 750), stop('b', 'Castel Sant’Angelo', 840, 930)])], dropped: [], warnings: [], score: 0 };
vi.mock('./plan.server', () => ({
  replan: async (_t: unknown, source: string, opts: unknown) => {
    h.replans.push({ source, opts });
    const plan = h.solved[Math.min(h.replans.length - 1, h.solved.length - 1)];
    return { created: true, plan: { version: 4 + h.replans.length, changes: h.replanChanges, plan } };
  },
}));
const TRIP = {
  id: 't1', ownerEmail: 'o@example.test', title: 'Rome', destination: 'Rome, Italy', timeZone: 'Europe/Rome', startDate: '2026-10-27',
  endDate: '2026-10-30', pace: 'normal', modes: ['walk'], status: 'planned', notes: null, research: null, guide: null, updatedAt: 'x',
  profile: { travellers: [{ name: 'You', relation: 'the owner', notes: [] }], preferences: [{ text: 'Prefers walking to taxis', source: 'memory', ref: 'm1' }], constraints: [], history: [], gatheredAt: 'x' },
} as Trip & { research: null; guide: null; updatedAt: string; profile: import('./model').TravellerProfile | null };
vi.mock('./store.server', () => ({
  loadState: async () => ({ stays: [], wishes: h.wishes, bookings: [] }),
  latestPlan: async () => ({ version: 4, plan: h.latest ?? BEFORE }),
  recentMessages: async (_t: string, viewer: unknown) => {
    h.viewers.push(viewer);
    return [];
  },
  viewerOf: (t: { ownerEmail: string }, email: string) => ({ email, isCreator: email === t.ownerEmail }),
  getTrip: async () => TRIP,
  getTripById: async () => TRIP,
  tripOnly: (t: Record<string, unknown>) => {
    const { research: _r, updatedAt: _u, guide: _g, profile: _p, ...rest } = t;
    return rest;
  },
  addMessage: async (_t: string, m: (typeof h.messages)[number]) => {
    h.messages.push(m);
    return { id: `m${h.messages.length}`, createdAt: 'now', ...m };
  },
  addWishes: async (_t: string, list: Array<{ title: string; place: unknown }>) =>
    list.map((w, i) => ({ id: `new${i}`, title: w.title, place: w.place, priority: 'nice', durationSec: null, partOfDay: 'any', fixedDate: null, fixedStartMin: null, locked: false, suggested: false, skipped: false, facts: null, note: null, sortHint: 0 })),
  updateTrip: async () => {},
  addStay: async (_t: string, st: object) => ({ id: 'st-new', ...st }),
  updateStay: async () => {},
  deleteStay: async () => true,
  updateWish: async () => null,
  deleteWish: async () => true,
  saveBooking: async () => null,
  listTransport: async () => [],
  addTransport: async (_t: string, seg: object) => ({ id: 'tr1', ...seg }),
  updateTransport: async () => {},
  deleteTransport: async () => true,
}));

const { converse, NO_PLANNER } = await import('./converse.server');

beforeEach(() => {
  h.messages = [];
  h.wishes = [];
  h.replans = [];
  h.research = [];
  h.model = null;
  h.seen = [];
  h.solved = [BEFORE];
  h.research2 = [];
  h.gathered = 0;
  h.remembered = [];
  h.viewers = [];
  h.provenance = [];
  h.drafts = [];
  h.offered = [];
  h.packPlaces = [];
  h.questionDrafts = [];
  h.ensured = [];
  h.replanChanges = [];
  h.latest = null;
});

/** A fake planner: the first call answers the person, a second one is the check. */
const isCheck = (messages: Array<{ role: string; content: string }>) => messages[0].content.startsWith('You are the trip planner checking');

describe('converse', () => {
  it('stores both messages, applies the ops, re-solves once and returns the result', async () => {
    h.model = (m) => isCheck(m) ? { ok: true, reply: 'Added the Pantheon for Tuesday morning.', ops: [] } : ({
      reply: 'Added the Pantheon for Tuesday morning.',
      ops: [
        { op: 'addWish', wish: { title: 'Pantheon', placeQuery: 'Pantheon, Rome', priority: 'must', partOfDay: 'morning' } },
        { op: 'removeStay', id: 'ghost' },
      ],
      quickReplies: ['What else is near it?'],
    });
    const r = await converse(TRIP, { text: 'Add the Pantheon, first thing', surface: 'site' });
    expect(r).toMatchObject({
      reply: 'Added the Pantheon for Tuesday morning.\n\n(Not done: No such stay.)',
      quickReplies: ['What else is near it?'],
      planVersion: 5,
    });
    expect(r.applied.map((o) => o.op)).toEqual(['addWish']);
    expect(r.rejected).toHaveLength(1);
    expect(h.messages.map((m) => [m.role, m.surface, m.planVersion])).toEqual([
      ['user', 'site', null],
      ['assistant', 'site', 5],
    ]);
    expect(h.messages[1].ops).toHaveLength(1);
    expect(h.replans).toEqual([{ source: 'site', opts: { keepRunningDay: true } }]);
    expect(h.research).toEqual([expect.objectContaining({ wishIds: ['new0'], depth: 'brief' })]);
    // The model saw the system prompt, the trip and the new text last.
    expect(h.seen[0][0].role).toBe('system');
    expect(h.seen[0].at(-1)).toEqual({ role: 'user', content: 'Add the Pantheon, first thing' });
  });

  it('offers checked options for an open question, and changes nothing (v7)', async () => {
    h.model = () => ({
      reply: 'Two ideas for Wednesday afternoon:',
      ops: [],
      quickReplies: [],
      options: [
        { date: '2026-10-28', stage: 'afternoon', title: 'Galleria Spada', placeQuery: 'Galleria Spada, Rome', durationMin: 60, why: 'Small and odd.', indoor: true },
        { date: '2026-10-28', stage: 'afternoon', title: 'Gianicolo walk', placeQuery: 'Gianicolo, Rome', durationMin: 75, why: 'The view.', indoor: false },
      ],
    });
    const r = await converse(TRIP, { text: 'What shall we do Wednesday afternoon?', surface: 'phone' });
    expect(h.replans).toEqual([]);
    expect(r.options?.map((o) => o.title)).toEqual(['Galleria Spada', 'Gianicolo walk']);
  });

  it('offers no options on a turn that changed the plan', async () => {
    h.model = (m) => (isCheck(m) ? { ok: true, reply: 'Done.', ops: [] } : {
      reply: 'Added it.', ops: [{ op: 'addWish', wish: { title: 'Gelato', placeQuery: null } }], quickReplies: [],
      options: [{ date: '2026-10-28', stage: 'afternoon', title: 'X', placeQuery: 'X, Rome' }],
    });
    const r = await converse(TRIP, { text: 'Add a gelato stop', surface: 'phone' });
    expect(r.options).toEqual([]);
  });

  it('does not re-solve when nothing changed', async () => {
    h.model = () => ({ reply: 'Where are you staying?', ops: [], quickReplies: ['Near Campo de’ Fiori'] });
    const r = await converse(TRIP, { text: 'Hello', surface: 'site' });
    expect(h.replans).toEqual([]);
    expect(r).toMatchObject({ applied: [], planVersion: 4, changes: [] });
  });

  it('on the phone, re-solves as the phone and is not held back by the running-day rule', async () => {
    h.model = (m) => (isCheck(m) ? { ok: true, reply: 'Done.', ops: [] } : { reply: 'Done.', ops: [{ op: 'addWish', wish: { title: 'Gelato', placeQuery: null } }], quickReplies: [] });
    await converse(TRIP, { text: 'Add a gelato stop', surface: 'phone', position: { lat: 41.9, lng: 12.47 } });
    expect(h.replans).toEqual([{ source: 'phone', opts: { keepRunningDay: false } }]);
    expect(h.seen[0][1].content).toContain('Phone position: 41.90000, 12.47000');
  });

  it('without a model, keeps the message and says so', async () => {
    const r = await converse(TRIP, { text: 'Plan Rome for me', surface: 'site' });
    expect(r).toMatchObject({ reply: NO_PLANNER, applied: [], rejected: [], quickReplies: [], planVersion: 4 });
    expect(h.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(h.replans).toEqual([]);
  });
});

describe('check and correct (v2.1)', () => {
  const LIGHTER = { days: [day('2026-10-28', [stop('a', 'Colosseum', 570, 750)])], dropped: [{ wishId: 'b', reason: 'No time on a light day' }], warnings: [], score: 0 };

  it('shows the check the request and the real before/after, and sends one round of corrections', async () => {
    h.solved = [BEFORE, LIGHTER];
    h.model = (m) =>
      isCheck(m)
        ? { ok: false, reply: 'Wednesday was not lighter yet, so I have also dropped Castel Sant’Angelo from it.', ops: [{ op: 'setTrip', fields: { dayLoads: { '2026-10-28': 'light' } } }] }
        : { reply: 'Made Wednesday lighter.', ops: [{ op: 'setTrip', fields: { notes: 'two adults' } }], quickReplies: [] };
    const r = await converse(TRIP, { text: 'Make Wednesday lighter', surface: 'site' });
    expect(h.seen).toHaveLength(2);
    const check = h.seen[1][1].content;
    expect(check).toContain('What they asked: Make Wednesday lighter');
    expect(check).toContain('The schedule did not change.');
    expect(h.replans).toHaveLength(2);
    expect(r.reply).toBe(
      'Wednesday was not lighter yet, so I have also dropped Castel Sant’Angelo from it.\n\nAfter that change the plan could not fit a wish (No time on a light day).',
    );
    expect(r.applied.map((o) => o.op)).toEqual(['setTrip', 'setTrip']);
    expect(r.planVersion).toBe(6);
    expect(r.changes).toEqual(['Castel Sant’Angelo is no longer planned — No time on a light day.']);
  });

  it('confirms without a second solve, and may correct the wording', async () => {
    h.solved = [LIGHTER];
    h.model = (m) =>
      isCheck(m)
        ? { ok: true, reply: 'Wednesday now ends at 12:30; Castel Sant’Angelo had to go.', ops: [] }
        : { reply: 'Made Wednesday lighter.', ops: [{ op: 'setTrip', fields: { dayLoads: { '2026-10-28': 'light' } } }], quickReplies: [] };
    const r = await converse(TRIP, { text: 'Make Wednesday lighter', surface: 'site' });
    expect(h.seen[1][1].content).toContain('Wed 28 Oct (2026-10-28): active 4h30 → 3h00, ends 15:30 → 12:30; removed Castel Sant’Angelo');
    expect(h.replans).toHaveLength(1);
    expect(r.reply).toBe('Wednesday now ends at 12:30; Castel Sant’Angelo had to go.');
  });

  it('keeps the first reply when the check cannot run, and never makes a third call', async () => {
    h.solved = [LIGHTER];
    let calls = 0;
    h.model = (m) => {
      calls++;
      if (isCheck(m)) throw new Error('timeout');
      return { reply: 'Made Wednesday lighter.', ops: [{ op: 'setTrip', fields: { dayLoads: { '2026-10-28': 'light' } } }], quickReplies: [] };
    };
    const r = await converse(TRIP, { text: 'Make Wednesday lighter', surface: 'site' });
    expect(calls).toBe(2);
    expect(r.reply).toBe('Made Wednesday lighter.');
  });

  it('skips the check when nothing changed', async () => {
    h.model = () => ({ reply: 'Which day?', ops: [], quickReplies: [] });
    await converse(TRIP, { text: 'Make it lighter', surface: 'site' });
    expect(h.seen).toHaveLength(1);
  });
});

describe('v3: profile, research and memory', () => {
  it('puts the profile in the prompt as fenced data and returns the turn’s research', async () => {
    h.research2 = [{ tool: 'flight_lookup', summary: 'Looked up flight LS1235 on 2026-10-27: 6 search results', sources: [] }];
    h.model = () => ({ reply: 'You land at 11:05.', ops: [], quickReplies: [] });
    const r = await converse(TRIP, { text: 'Our flight is LS1235 on the 27th', surface: 'site' });
    expect(h.seen[0][0].content).toContain('You may research on your own with tools');
    expect(h.seen[0][1].content).toContain('<<<PROFILE');
    expect(h.seen[0][1].content).toContain('Preferences: Prefers walking to taxis');
    expect(r.research).toEqual(h.research2);
    expect(h.messages[1]).toMatchObject({ role: 'assistant', research: h.research2 });
    expect(h.gathered).toBe(0); // already gathered
  });

  it('gathers the profile on the first turn of a trip without one', async () => {
    h.model = () => ({ reply: 'Hello.', ops: [], quickReplies: [] });
    await converse({ ...TRIP, profile: null }, { text: 'Hi', surface: 'site' });
    expect(h.gathered).toBe(1);
  });

  it('remembers a stated preference against the message it came from', async () => {
    h.model = (m) => (isCheck(m) ? { ok: true, reply: 'ok', ops: [] } : { reply: 'I’ll remember that.', ops: [{ op: 'remember', text: 'We never do early starts', category: 'preferences' }], quickReplies: [] });
    const r = await converse(TRIP, { text: 'We never do early starts', surface: 'site' });
    expect(h.remembered).toEqual([{ text: 'We never do early starts', category: 'preferences', messageId: 'm1', ownerEmail: 'o@example.test' }]);
    expect(r.applied).toEqual([{ op: 'remember', text: 'We never do early starts', category: 'preferences' }]);
    expect(h.replans).toEqual([]); // remembering is not a plan change
  });
});

describe('v5: a family member talking to the planner', () => {
  const kid = { isOwner: false, canEdit: false, name: 'Sam', email: 'kid@example.test' };

  it('never puts the owner’s memories in a member’s prompt — travellers only', async () => {
    h.model = () => ({ reply: 'Gelato is a good idea.', ops: [], quickReplies: [] });
    await converse(TRIP, { text: 'Can we get gelato?', surface: 'phone', caller: kid });
    const prompt = h.seen[0].map((m) => m.content).join('\n');
    expect(prompt).not.toContain('Prefers walking to taxis');
    expect(prompt).toContain('You');
    expect(prompt).toContain('THIS PERSON CANNOT CHANGE THE TRIP');
    expect(h.gathered).toBe(0);
    // Their own thread only: the history read is theirs, and both turns are stored as theirs.
    expect(h.viewers).toEqual([{ email: 'kid@example.test', isCreator: false }]);
    expect(h.messages.map((m) => (m as { author?: unknown }).author)).toEqual([
      { email: 'kid@example.test', id: null },
      { email: 'kid@example.test', id: null },
    ]);
  });

  it('a member without edit rights gets advice: no ops applied, nothing remembered, no re-solve', async () => {
    h.model = (m) =>
      isCheck(m)
        ? { ok: true, reply: 'ok', ops: [] }
        : { reply: 'Ask a parent.', ops: [{ op: 'remember', text: 'Sam loves gelato', category: 'preferences' }, { op: 'setPace', pace: 'relaxed' }], quickReplies: [] };
    const r = await converse(TRIP, { text: 'Remember I love gelato and slow down', surface: 'phone', caller: kid });
    expect(r.applied).toEqual([]);
    expect(h.remembered).toEqual([]);
    expect(h.replans).toEqual([]);
  });

  it('a member who created the trip edits it, but still never writes the owner’s memory', async () => {
    h.model = (m) => (isCheck(m) ? { ok: true, reply: 'ok', ops: [] } : { reply: 'Noted.', ops: [{ op: 'remember', text: 'Sam loves gelato', category: 'preferences' }], quickReplies: [] });
    await converse({ ...TRIP, ownerEmail: 'kid@example.test', profile: null }, { text: 'I love gelato', surface: 'phone', caller: { ...kid, canEdit: true } });
    expect(h.remembered).toEqual([]);
    expect(h.gathered).toBe(0);
  });
});

describe('v8: act, propose, ask', () => {
  const PACK = { id: 'c0ffee00-0000-4000-8000-000000000401', name: 'Palazzo Altemps', kind: 'museum', tags: [], place: { name: 'Palazzo Altemps', location: { lat: 41.9007, lng: 12.4728 }, osmId: 'way/3', address: null }, why: 'Quiet sculpture.', neighbourhood: 'Parione', durationMin: 75, indoor: true, kidFriendly: true, costText: '€10 each', lessVisited: true, bookingRequired: false, bookAheadDays: null, facts: null, image: null, wikidata: null, sources: [], status: 'candidate', rejectReason: null, wishId: null, checkedAt: null };

  it('tells the planner the policy, the brief with origins, the pack and what is open', async () => {
    h.packPlaces = [PACK];
    h.model = () => ({ reply: 'Noted.', ops: [], quickReplies: [] });
    await converse(TRIP, { text: 'Hello', surface: 'site' });
    expect(h.seen[0][0].content).toContain('ACT, PROPOSE OR ASK');
    expect(h.seen[0][0].content).not.toContain('Turn what they say into ops straight away');
    const context = h.seen[0][1].content;
    expect(context).toContain('THE BRIEF');
    expect(context).toContain('Stay: not known yet — Planning from the centre until you add one (ASSUMED by you)');
    expect(context).toContain('[c0ffee00-0000-4000-8000-000000000401] Palazzo Altemps (museum; Parione; indoor; good for children; less visited; €10 each; ~75 min)');
  });

  it('a fill group the planner proposes is checked, stored and returned — and drawn as legacy options for the current app', async () => {
    h.model = () => ({
      reply: 'Three ideas for Monday evening — pick one on the cards.',
      ops: [],
      quickReplies: [],
      proposals: [
        { kind: 'fill', title: 'Roscioli', why: 'Famous deli.', group: 'mon-dinner', scope: { date: '2026-10-27', stage: 'evening' }, ops: [{ op: 'addWish', wish: { title: 'Roscioli', placeQuery: 'Roscioli, Rome', fixedDate: '2026-10-27', replacesMeal: 'dinner' } }] },
        { kind: 'fill', title: 'Da Enzo', why: 'Trastevere trattoria.', group: 'mon-dinner', scope: { date: '2026-10-27', stage: 'evening' }, packPlaceId: 'x', ops: [{ op: 'addWish', wish: { title: 'Da Enzo', placeQuery: 'Da Enzo, Rome' } }] },
      ],
    });
    const r = await converse(TRIP, { text: 'Somewhere for dinner on Monday', surface: 'phone' });
    expect(h.replans).toEqual([]);
    expect(h.drafts).toHaveLength(1);
    expect(r.proposals?.map((p) => p.title)).toEqual(['Roscioli', 'Da Enzo']);
    // The family's current app reads only `options`: it still gets cards to tap.
    expect(r.options?.map((o) => o.title)).toEqual(['Roscioli', 'Da Enzo']);
    expect(r).toMatchObject({ applied: [], rejected: [], planVersion: 4, changes: [], diff: null, undo: null });
    expect(r.brief?.items.some((i) => i.kind === 'preference')).toBe(false); // the phone's brief
  });

  it('reads v7 options as a fill group', async () => {
    h.model = () => ({
      reply: 'Two ideas for Wednesday afternoon:',
      ops: [],
      quickReplies: [],
      options: [{ date: '2026-10-28', stage: 'lunch', title: 'Roscioli', placeQuery: 'Roscioli, Rome', durationMin: 60, why: 'Deli.' }],
    });
    await converse(TRIP, { text: 'Lunch on Wednesday?', surface: 'site' });
    expect(h.drafts[0]).toEqual([
      expect.objectContaining({ kind: 'fill', title: 'Roscioli', group: 'options', scope: expect.objectContaining({ date: '2026-10-28', stage: 'lunch' }), ops: [{ op: 'addWish', wish: expect.objectContaining({ fixedDate: '2026-10-28', replacesMeal: 'lunch', placeQuery: 'Roscioli, Rome' }) }] }),
    ]);
  });

  it('acts AND proposes in one turn, with the difference and the undo', async () => {
    h.model = (m) =>
      isCheck(m)
        ? { ok: true, reply: 'Added.', ops: [] }
        : {
            reply: 'Added the Pantheon; two ideas for after it are on the cards.',
            ops: [{ op: 'addWish', wish: { title: 'Pantheon', placeQuery: 'Pantheon, Rome' }, source: 'you' }],
            quickReplies: [],
            proposals: [{ kind: 'fill', title: 'Sant’Ignazio', why: 'Painted ceiling.', scope: { date: '2026-10-28', stage: 'afternoon' }, ops: [{ op: 'addWish', wish: { title: 'Sant’Ignazio', placeQuery: 'Sant’Ignazio, Rome' } }] }],
          };
    const r = await converse(TRIP, { text: 'Add the Pantheon and something after it', surface: 'site' });
    expect(r.planVersion).toBe(5);
    expect(r.undo).toEqual({ toVersion: 4 });
    expect(r.diff).toMatchObject({ lines: expect.any(Array), changes: expect.any(Array) });
    expect(r.proposals?.map((p) => p.title)).toEqual(['Sant’Ignazio']);
    // Legacy options only on a turn that changed nothing, as v7's always were.
    expect(r.options).toEqual([]);
    expect(h.provenance).toEqual([{ 'wish:new0': { source: 'you', note: null, ref: null } }]);
  });

  it('labels a fact the planner set without saying where it came from as assumed', async () => {
    h.model = (m) =>
      isCheck(m)
        ? { ok: true, reply: 'ok', ops: [] }
        : { reply: 'I have assumed you are near the Pantheon.', ops: [{ op: 'addStay', name: 'Somewhere central', placeQuery: 'Pantheon, Rome', fromDate: '2026-10-27', toDate: '2026-10-30' }, { op: 'setTrip', fields: { pace: 'relaxed' }, source: 'you' }], quickReplies: [] };
    await converse(TRIP, { text: 'Plan it relaxed', surface: 'site' });
    expect(h.provenance[0]).toMatchObject({ pace: { source: 'you' } });
    expect(Object.entries(h.provenance[0]).find(([k]) => k.startsWith('stay:'))?.[1]).toEqual({ source: 'assumed', note: null, ref: null });
  });

  it('retries once when the reply promises ideas and carries nothing', async () => {
    let calls = 0;
    h.model = (m) => {
      calls++;
      if (m.at(-1)?.content.startsWith('Your reply talks about adding')) {
        return { reply: 'Here are three ideas on the cards.', ops: [], proposals: [{ kind: 'fill', title: 'Mercato Centrale', why: 'Food hall.', scope: { date: '2026-10-28', stage: 'lunch' }, ops: [{ op: 'addWish', wish: { title: 'Mercato Centrale', placeQuery: 'Mercato Centrale, Rome' } }] }] };
      }
      return { reply: 'I’ve added a few easy town-centre ideas.', ops: [], quickReplies: [] };
    };
    const r = await converse(TRIP, { text: 'Add some ideas to the plan', surface: 'site' });
    expect(calls).toBe(2);
    expect(r.reply).toBe('Here are three ideas on the cards.');
    expect(r.proposals?.map((p) => p.title)).toEqual(['Mercato Centrale']);
  });

  it('if the retry is still empty, says so plainly and offers what the pack has', async () => {
    h.packPlaces = [PACK];
    const flat = (id: string, min: number) => ({ id, kind: 'stay', wishId: null, title: 'Flat', location: { lat: 41.9, lng: 12.47 }, arriveMin: min, departMin: min, waitSec: 0, locked: true, bookingId: null, warnings: [] });
    h.latest = { days: [day('2026-10-28', [flat('stay:s', 540), stop('a', 'Colosseum', 570, 750), flat('stay:e', 1140)] as never)], dropped: [], warnings: [], score: 0 };
    h.model = () => ({ reply: 'I’ve added a few easy town-centre ideas.', ops: [], quickReplies: [] });
    const r = await converse(TRIP, { text: 'Add some ideas to the plan', surface: 'site' });
    expect(r.reply).toBe('I couldn’t turn that into a change — here’s what I can do:');
    expect(h.offered).toEqual([{ date: '2026-10-28', stage: 'afternoon' }]);
    expect(r.proposals?.map((p) => p.title)).toEqual(['Palazzo Altemps']);
    expect(r.options?.map((o) => o.title)).toEqual(['Palazzo Altemps']);
  });

  it('with nothing to offer, says nothing was changed', async () => {
    h.model = () => ({ reply: 'I’ve added a few easy town-centre ideas.', ops: [], quickReplies: [] });
    const r = await converse(TRIP, { text: 'Add some ideas to the plan', surface: 'site' });
    expect(r.reply).toBe('I couldn’t turn that into a change, so nothing has been changed.');
    expect(r.proposals).toEqual([]);
  });

  it('passes the planner’s question cards to the check, and rebuilds the pack when the dates move', async () => {
    h.model = (m) =>
      isCheck(m)
        ? { ok: true, reply: 'ok', ops: [] }
        : {
            reply: 'Moved the trip a day later; I have assumed dinner around 19:30.',
            ops: [{ op: 'setTrip', fields: { startDate: '2026-10-28', endDate: '2026-10-31' } }],
            quickReplies: [],
            questions: [{ key: 'eat-late', prompt: 'Do you eat late?', answers: [{ label: 'Around 19:30', ops: [] }, { label: 'After 21:00', ops: [] }], defaultIndex: 0 }],
          };
    const r = await converse(TRIP, { text: 'Make it a day later', surface: 'site' });
    expect(h.questionDrafts).toEqual([expect.objectContaining({ key: 'eat-late', prompt: 'Do you eat late?' })]);
    expect(r.questions).toEqual([{ id: 'q-eat-late', key: 'eat-late' }]);
    expect(h.ensured).toEqual([{ reason: 'changed' }]);
  });

  it('someone who cannot edit gets advice: no proposals, no questions, no retry', async () => {
    const kid = { isOwner: false, canEdit: false, name: 'Sam', email: 'kid@example.test' };
    h.model = () => ({
      reply: 'I’ve added a few ideas.',
      ops: [],
      quickReplies: [],
      proposals: [{ kind: 'fill', title: 'Gelato', why: 'Yum.', scope: { date: '2026-10-28', stage: 'afternoon' }, ops: [{ op: 'addWish', wish: { title: 'Gelato' } }] }],
      questions: [{ prompt: 'Which flavour?', answers: [{ label: 'Pistachio', ops: [] }, { label: 'Lemon', ops: [] }] }],
    });
    const r = await converse(TRIP, { text: 'Ideas?', surface: 'phone', caller: kid });
    expect(h.seen).toHaveLength(1);
    expect(h.drafts).toEqual([]);
    expect(h.questionDrafts).toEqual([]);
    expect(r.proposals).toEqual([]);
    expect(r.questions).toEqual([]);
    expect(h.seen[0][1].content).not.toContain('Prefers walking to taxis');
  });

  it('a background re-plan after research that moves things says so in the conversation', async () => {
    h.replanChanges = ['Colosseum moved from Wed 28 Oct to Thu 29 Oct (09:30).'];
    h.model = (m) => (isCheck(m) ? { ok: true, reply: 'ok', ops: [] } : { reply: 'Added.', ops: [{ op: 'addWish', wish: { title: 'Pantheon', placeQuery: 'Pantheon, Rome' } }], quickReplies: [] });
    await converse(TRIP, { text: 'Add the Pantheon', surface: 'site' });
    const job = h.research[0] as { onDone: (id: string) => Promise<void> };
    await job.onDone('t1');
    expect(h.messages.at(-1)).toMatchObject({ role: 'event', text: 'The research finished and the plan moved: Colosseum moved from Wed 28 Oct to Thu 29 Oct (09:30).' });
  });
});

describe('backgroundNote', () => {
  it('is quiet when nothing moved', async () => {
    const { backgroundNote } = await import('./converse.server');
    expect(backgroundNote(['No change to the schedule.'])).toBeNull();
    expect(backgroundNote(['Travel times: 3 legs estimated.'])).toBeNull();
    expect(backgroundNote(['Trevi added on Tue 27 Oct at 15:00.'])).toBe('The research finished and the plan moved: Trevi added on Tue 27 Oct at 15:00.');
  });
});

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
    return { created: true, plan: { version: 4 + h.replans.length, changes: [], plan } };
  },
}));
const TRIP = {
  id: 't1', ownerEmail: 'o@example.test', title: 'Rome', destination: 'Rome, Italy', timeZone: 'Europe/Rome', startDate: '2026-10-27',
  endDate: '2026-10-30', pace: 'normal', modes: ['walk'], status: 'planned', notes: null, research: null, guide: null, updatedAt: 'x',
} as Trip & { research: null; guide: null; updatedAt: string };
vi.mock('./store.server', () => ({
  loadState: async () => ({ stays: [], wishes: h.wishes, bookings: [] }),
  latestPlan: async () => ({ version: 4, plan: BEFORE }),
  recentMessages: async () => [],
  getTrip: async () => TRIP,
  addMessage: async (_t: string, m: (typeof h.messages)[number]) => {
    h.messages.push(m);
    return { id: `m${h.messages.length}`, createdAt: 'now', ...m };
  },
  addWishes: async (_t: string, list: Array<{ title: string; place: unknown }>) =>
    list.map((w, i) => ({ id: `new${i}`, title: w.title, place: w.place, priority: 'nice', durationSec: null, partOfDay: 'any', fixedDate: null, fixedStartMin: null, locked: false, suggested: false, skipped: false, facts: null, note: null, sortHint: 0 })),
  updateTrip: async () => {},
  addStay: async () => ({}),
  updateStay: async () => {},
  deleteStay: async () => true,
  updateWish: async () => null,
  deleteWish: async () => true,
  saveBooking: async () => null,
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
    expect(r.reply).toBe('Wednesday was not lighter yet, so I have also dropped Castel Sant’Angelo from it.');
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

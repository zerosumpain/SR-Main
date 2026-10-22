import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Question, QuestionStatus } from './decisions';
import type { Booking, SolvedPlan, Stay, Trip, Wish } from './model';

// Questions end to end with the store in memory: real ops (./ops), real dry
// runs and the real solver; the plan versions, questions and pushes are kept
// here so each rule is visible.
const h = vi.hoisted(() => ({
  trip: null as unknown as Record<string, unknown>,
  stays: [] as Stay[],
  wishes: [] as Wish[],
  bookings: [] as Booking[],
  plans: [] as Array<{ id: string; tripId: string; version: number; plan: SolvedPlan; changes: string[]; matrix: unknown; createdAt: string; source: string; inputHash: string }>,
  questions: [] as Array<Question & { votesRaw?: Record<string, Array<{ email: string; name: string }>>; pushedAt?: Date | null }>,
  pushes: [] as Array<{ to: string[]; msg: Record<string, unknown> }>,
  provenance: {} as Record<string, unknown>,
  events: [] as string[],
  pack: { status: 'none', calendar: [] } as Record<string, unknown>,
  places: [] as unknown[],
  proposals: [] as Array<Record<string, unknown>>,
}));

vi.mock('$lib/server/access', () => ({ getOwnerEmails: () => ['owner@example.test'], isOwnerEmail: (e: string) => e === 'owner@example.test' }));
vi.mock('$lib/server/push-devices', () => ({
  pushToEmails: async (to: string[], msg: Record<string, unknown>) => {
    h.pushes.push({ to: [...to].sort(), msg });
    return { sent: to.length };
  },
}));
vi.mock('$lib/family/roster.server', () => ({
  familyRoster: async () => [
    { id: 'f_owner', email: 'owner@example.test', name: 'John', parent: true },
    { id: 'f_parent', email: 'parent@example.test', name: 'Alex', parent: true },
    { id: 'f_kid', email: 'kid@example.test', name: 'Sam', parent: false },
  ],
}));
vi.mock('./research.server', () => ({ findPlaceLoosely: async () => null }));
vi.mock('./plan.server', async () => {
  const { estimateMatrix } = await import('$lib/trips/solver');
  return {
    solverInput: async () => {
      const points = [...h.stays.map((s) => ({ id: `stay:${s.id}`, location: s.location })), ...h.wishes.filter((w) => w.place && !w.skipped && !w.suggested).map((w) => ({ id: w.id, location: w.place!.location }))];
      const t = h.trip as unknown as Trip;
      return {
        input: { trip: { id: t.id, timeZone: t.timeZone, startDate: t.startDate, endDate: t.endDate, pace: t.pace, modes: t.modes, dayLoads: t.dayLoads ?? {} }, stays: h.stays, wishes: h.wishes, bookings: h.bookings, transport: [], matrix: estimateMatrix(points, t.modes) },
        state: { stays: h.stays, wishes: h.wishes, bookings: h.bookings },
        routingNotes: [],
      };
    },
  };
});
// The validated path every answer takes: real ops on the in-memory trip, then a solve.
vi.mock('./converse.server', async () => {
  const { applyOps } = await import('./ops');
  const { solveTrip, estimateMatrix } = await import('$lib/trips/solver');
  const { diffPlans } = await import('./changes');
  let n = 0;
  return {
    applyAndReplan: async (_trip: unknown, ops: unknown[], opts: { eventText: string; trustedPlaces?: boolean }) => {
      h.events.push(opts.eventText);
      const t = h.trip as unknown as Trip;
      const ctx = { trip: t, stays: h.stays, wishes: h.wishes, bookings: h.bookings, transport: [], profile: null, knownUrls: new Set<string>() };
      const r = await applyOps(ops, ctx, {
        trustsPlaces: opts.trustedPlaces === true,
        resolvePlace: async () => null,
        setTrip: async (f) => void (h.trip = { ...h.trip, ...f }),
        addStay: async (f) => ({ id: `stay-${++n}`, ...f }),
        updateStay: async (id, f) => void (h.stays = h.stays.map((s) => (s.id === id ? { ...s, ...f } : s))),
        removeStay: async (id) => void (h.stays = h.stays.filter((s) => s.id !== id)),
        addWish: async (f) => {
          const w = { id: `w-new-${++n}`, ...f, locked: f.fixedStartMin !== null, suggested: false, skipped: false, facts: null, sortHint: 0 } as Wish;
          h.wishes = [...h.wishes, w];
          return w;
        },
        updateWish: async (id, p) => void (h.wishes = h.wishes.map((w) => (w.id === id ? ({ ...w, ...p } as Wish) : w))),
        removeWish: async (id) => void (h.wishes = h.wishes.filter((w) => w.id !== id)),
        addBooking: async (b) => {
          const row = { id: `b-${++n}`, wishId: b.wishId, title: b.title, date: b.date ?? null, startMin: b.startMin ?? null, endMin: b.endMin ?? null, reference: null, url: null, documentId: null, status: b.status ?? 'to-book' } as Booking;
          h.bookings = [...h.bookings, row];
          return row;
        },
        updateBooking: async (id, p) => void (h.bookings = h.bookings.map((b) => (b.id === id ? ({ ...b, ...p } as Booking) : b))),
      });
      // applyOps works on copies of the arrays: keep what it saw as the truth.
      h.stays = ctx.stays;
      h.trip = { ...h.trip, ...ctx.trip };
      if (!r.changed) return { applied: r.applied, rejected: r.rejected, planVersion: h.plans.at(-1)?.version ?? null };
      const tt = h.trip as unknown as Trip;
      const points = [...h.stays.map((s) => ({ id: `stay:${s.id}`, location: s.location })), ...h.wishes.filter((w) => w.place && !w.skipped).map((w) => ({ id: w.id, location: w.place!.location }))];
      const plan = solveTrip({ trip: { id: tt.id, timeZone: tt.timeZone, startDate: tt.startDate, endDate: tt.endDate, pace: tt.pace, modes: tt.modes, dayLoads: tt.dayLoads ?? {} }, stays: h.stays, wishes: h.wishes, bookings: h.bookings, transport: [], matrix: estimateMatrix(points, tt.modes) });
      const prev = h.plans.at(-1);
      const version = (prev?.version ?? 0) + 1;
      h.plans.push({ id: `p${version}`, tripId: 't1', version, plan, changes: diffPlans(prev?.plan ?? null, plan), matrix: null, createdAt: new Date().toISOString(), source: 'site', inputHash: String(version) });
      return { applied: r.applied, rejected: r.rejected, planVersion: version };
    },
  };
});
vi.mock('./store.server', () => ({
  getTripById: async () => ({ ...h.trip }),
  latestPlan: async () => h.plans.at(-1) ?? null,
  listTransport: async () => [],
  loadState: async () => ({ stays: h.stays, wishes: h.wishes, bookings: h.bookings }),
  tripOnly: (t: Record<string, unknown>) => {
    const { research: _r, updatedAt: _u, guide: _g, profile: _p, ...rest } = t;
    return rest;
  },
}));
vi.mock('./decisions.store.server', () => {
  let n = 0;
  const strip = ({ votesRaw: _v, pushedAt: _p, ...q }: (typeof h.questions)[number]) => q as Question;
  return {
    questionPushOff: async () => [],
    addQuestion: async (_t: string, q: Omit<Question, 'id'>) => {
      const row = { ...q, id: `q${++n}`, status: 'open' as QuestionStatus, answerId: null, answeredByName: null, votes: {}, createdAt: new Date().toISOString(), answeredAt: null, votesRaw: {}, pushedAt: null };
      h.questions.push(row);
      return strip(row);
    },
    getQuestion: async (_t: string, id: string) => {
      const q = h.questions.find((x) => x.id === id);
      return q ? strip(q) : null;
    },
    listQuestions: async (_t: string, opts: { status?: QuestionStatus[] } = {}) => h.questions.filter((q) => (opts.status ?? ['open']).includes(q.status)).map(strip),
    questionKeys: async () => new Map(h.questions.map((q) => [q.key, q.status])),
    closeQuestion: async (_t: string, id: string, status: QuestionStatus, a: { answerId: string | null; byName: string | null }) => {
      const q = h.questions.find((x) => x.id === id);
      if (!q || q.status !== 'open') return false;
      Object.assign(q, { status, answerId: a.answerId, answeredByName: a.byName, answeredAt: new Date().toISOString() });
      return true;
    },
    voteQuestion: async (_t: string, id: string, answerId: string, voter: { email: string; name: string }) => {
      const q = h.questions.find((x) => x.id === id);
      if (!q || q.status !== 'open') return null;
      const raw = Object.fromEntries(Object.entries(q.votesRaw ?? {}).map(([a, vs]) => [a, vs.filter((v) => v.email !== voter.email)]));
      raw[answerId] = [...(raw[answerId] ?? []), voter];
      q.votesRaw = raw;
      q.votes = Object.fromEntries(Object.entries(raw).map(([a, vs]) => [a, vs.map((v) => v.name)]));
      return strip(q);
    },
    lastQuestionPush: async () => h.questions.map((q) => q.pushedAt).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null,
    markQuestionPushed: async (_t: string, id: string) => {
      const q = h.questions.find((x) => x.id === id);
      if (q) q.pushedAt = new Date();
    },
    noteProvenance: async (_t: string, e: Record<string, unknown>) => void Object.assign(h.provenance, e),
    listPackPlaces: async () => h.places,
    readPack: async () => h.pack,
    listProposals: async (_t: string, opts: { status?: string[] } = {}) => h.proposals.filter((p) => (opts.status ?? ['open']).includes(p.status as string)),
    decideProposal: async (_t: string, id: string, status: string) => {
      const p = h.proposals.find((x) => x.id === id);
      if (!p || p.status !== 'open') return false;
      p.status = status;
      return true;
    },
    supersedeGroup: async (_t: string, g: string, except: string) => void h.proposals.forEach((p) => p.groupId === g && p.id !== except && p.status === 'open' && (p.status = 'superseded')),
    expireProposals: async () => void h.proposals.forEach((p) => p.kind === 'shape' && p.status === 'open' && (p.status = 'expired')),
    readProvenance: async () => ({}),
  };
});

const qs = await import('./questions.server');
const { solveTrip, estimateMatrix } = await import('$lib/trips/solver');
const { emptyFacts } = await import('./research');

const FLAT: Stay = { id: 'flat', name: 'The flat', address: null, location: { lat: 41.8952, lng: 12.4716 }, fromDate: '2026-10-26', toDate: '2026-10-31', checkInMin: null, checkOutMin: null };
const at = (lat: number, lng: number) => ({ name: 'x', location: { lat, lng }, osmId: null, address: null });
function wish(id: string, title: string, lat: number, lng: number, over: Partial<Wish> = {}): Wish {
  return { id, title, place: { ...at(lat, lng), name: title }, priority: 'nice', durationSec: 5400, partOfDay: 'any', fixedDate: null, fixedStartMin: null, locked: false, suggested: false, skipped: false, facts: null, note: null, sortHint: 0, replacesMeal: null, ...over };
}

function solveNow() {
  const t = h.trip as unknown as Trip;
  const points = [...h.stays.map((s) => ({ id: `stay:${s.id}`, location: s.location })), ...h.wishes.filter((w) => w.place && !w.skipped).map((w) => ({ id: w.id, location: w.place!.location }))];
  const plan = solveTrip({ trip: { id: 't1', timeZone: t.timeZone, startDate: t.startDate, endDate: t.endDate, pace: t.pace, modes: t.modes, dayLoads: t.dayLoads ?? {} }, stays: h.stays, wishes: h.wishes, bookings: h.bookings, transport: [], matrix: estimateMatrix(points, t.modes) });
  h.plans = [{ id: 'p1', tripId: 't1', version: 1, plan, changes: [], matrix: null, createdAt: 'x', source: 'site', inputHash: '1' }];
}

const TRIP = () => ({ id: 't1', ownerEmail: 'owner@example.test', title: 'Rome', destination: 'Rome', timeZone: 'Europe/Rome', startDate: '2026-10-26', endDate: '2026-10-30', pace: 'normal', modes: ['walk', 'transit'], status: 'planned', notes: null, dayLoads: {}, research: null, guide: null, profile: { travellers: [{ name: 'You', relation: null, notes: [] }], preferences: [], constraints: [], history: [], gatheredAt: 'x' }, updatedAt: 'x' });
const OWNER = { email: 'owner@example.test', name: 'John', isOwner: true, access: { role: 'creator' as const, canEdit: true, canApprove: true }, surface: 'phone' as const };
const KID = { email: 'kid@example.test', name: 'Sam', isOwner: false, access: { role: 'member' as const, canEdit: false, canApprove: false }, surface: 'phone' as const };
const PARENT = { email: 'parent@example.test', name: 'Alex', isOwner: false, access: { role: 'parent' as const, canEdit: true, canApprove: true }, surface: 'phone' as const };

beforeEach(() => {
  h.trip = TRIP();
  h.stays = [FLAT];
  h.wishes = [
    wish('colosseum', 'Colosseum underground', 41.8902, 12.4922, { facts: { ...emptyFacts('brief', null), bookingRequired: true, bookAheadDays: 3 } }),
    wish('pantheon', 'Pantheon', 41.8986, 12.4769),
    wish('altemps', 'Palazzo Altemps', 41.9007, 12.4728),
  ];
  h.bookings = [];
  h.questions = [];
  h.pushes = [];
  h.provenance = {};
  h.events = [];
  h.pack = { status: 'none', calendar: [] };
  h.places = [];
  h.proposals = [];
  solveNow();
});

const trip = () => h.trip as never;
afterEach(() => qs.questionsSettledForTest());

describe('refreshQuestions', () => {
  it('asks only what changes the plan: a booking deadline, ranked by urgency, and pushes it once', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-21T09:00:00Z'));
    const added = await qs.refreshQuestions(trip());
    const q = added.find((x) => x.key === 'research:book:colosseum')!;
    expect(q).toMatchObject({ origin: 'research', audience: 'owner', appliedDefault: true, defaultAnswerId: 'a0', basedOnVersion: 1 });
    expect(q.answers.map((a) => [a.label, a.changes > 0])).toEqual([["Keep it, I'll book", false], ['Skip it', true]]);
    expect(q.answers[1].summary).toMatch(/Colosseum underground (taken out|left out)|stops change/);
    // Visit within days of the deadline: ×3 or ×2 on the stops it moves.
    expect(q.impact).toBeGreaterThanOrEqual(q.affects.stops * 2);
    await vi.waitFor(() => expect(h.pushes).toHaveLength(1));
    expect(h.pushes[0].to).toEqual(['owner@example.test']);
    expect(h.pushes[0].msg).toMatchObject({ title: 'Rome · quick question', category: `trip-q-${q.id}`, userInfo: { category: 'trip-question', tripId: 't1', questionId: q.id, url: `sr://trips/t1/questions/${q.id}` } });
    // Never the same key twice while open; one push a day.
    expect(await qs.refreshQuestions(trip())).toEqual([]);
    expect(h.questions.filter((x) => x.key === 'research:book:colosseum')).toHaveLength(1);
    vi.useRealTimers();
  });

  it('a background refresh never applies an assumption to a planned trip: it asks, and skipping keeps the plan', async () => {
    h.stays = [{ ...FLAT, toDate: '2026-10-28' }];
    h.wishes = h.wishes.map((w) => ({ ...w, facts: null }));
    solveNow();
    const before = h.plans.length;
    const added = await qs.refreshQuestions(trip(), { reason: 'turn' });
    const q = added.find((x) => x.key.startsWith('brief:stay-nights'))!;
    expect(q.appliedDefault).toBe(false);
    expect(q.ifSkipped).toBe('If you skip: the plan stays as it is.');
    expect(h.plans.length).toBe(before);
  });

  it('assume-and-ask (guided start): the stay is stretched now, and "Somewhere else" puts it back', async () => {
    h.stays = [{ ...FLAT, toDate: '2026-10-28' }];
    h.wishes = h.wishes.map((w) => ({ ...w, facts: null }));
    solveNow();
    const added = await qs.refreshQuestions(trip(), { reason: 'start' });
    const q = added.find((x) => x.key.startsWith('brief:stay-nights'))!;
    expect(q.appliedDefault).toBe(true);
    expect(h.stays[0].toDate).toBe('2026-10-30');
    expect(h.events[0]).toMatch(/^Assumed for now: Yes, the same place/);
    expect(h.provenance['stay:flat']).toMatchObject({ source: 'assumed' });
    expect(q.answers[0]).toMatchObject({ ops: [], changes: 0, summary: null });
    expect(q.answers[1].ops[0]).toEqual({ op: 'updateStay', id: 'flat', fields: { fromDate: '2026-10-26', toDate: '2026-10-28' } });
    // Answer the other way: the stay goes back, a new version with an undo.
    const v = h.plans.at(-1)!.version;
    const out = await qs.answerQuestion(trip(), q.id, { action: 'answer', answerId: 'a1' }, OWNER);
    expect(out.status).toBe(200);
    expect(h.stays[0].toDate).toBe('2026-10-28');
    expect(out.body).toMatchObject({ planVersion: v + 1, undo: { toVersion: v }, remember: null, question: { status: 'answered', answerId: 'a1', answeredByName: 'John' } });
    expect(h.provenance['stay:flat']).toMatchObject({ source: 'you' });
  });

  it('expires an open question whose answers no longer differ', async () => {
    const [q] = await qs.refreshQuestions(trip());
    expect(q.key).toBe('research:book:colosseum');
    // Someone booked it elsewhere and it was taken out: both answers now solve the same.
    h.wishes = h.wishes.filter((w) => w.id !== 'colosseum');
    solveNow();
    await qs.refreshQuestions(trip());
    expect(h.questions.find((x) => x.id === q.id)?.status).toBe('expired');
  });
});

describe('checkQuestionDrafts (the planner’s own)', () => {
  const draft = (key: string, answers: Array<{ label: string; ops: unknown[] }>, extra: Record<string, unknown> = {}) => ({ key, origin: 'planner' as const, prompt: `${key}?`, why: null, answers, defaultIndex: 0, ifSkipped: null, audience: 'owner' as const, deadline: null, ...extra });

  it('drops a question whose answers all give the same plan', async () => {
    expect(await qs.checkQuestionDrafts(trip(), [draft('same', [{ label: 'A', ops: [] }, { label: 'B', ops: [{ op: 'updateWish', id: 'pantheon', fields: { note: 'nice' } }] }])])).toEqual([]);
  });

  it('keeps at most three open per audience, highest impact first', async () => {
    const skip = (id: string) => ({ label: 'Skip', ops: [{ op: 'updateWish', id, fields: { skipped: true } }] });
    const drafts = [
      draft('one', [{ label: 'Keep', ops: [] }, skip('pantheon')]),
      draft('two', [{ label: 'Keep', ops: [] }, skip('altemps')]),
      draft('three', [{ label: 'Keep', ops: [] }, skip('colosseum')]),
      draft('four', [{ label: 'Keep', ops: [] }, { label: 'Both', ops: [...skip('pantheon').ops, ...skip('altemps').ops] }]),
    ];
    const added = await qs.checkQuestionDrafts(trip(), drafts);
    expect(added).toHaveLength(3);
    expect(added[0].key).toBe('four');
    expect(added.every((q) => q.why.startsWith('Changes '))).toBe(true);
  });

  it('a skipped key is not asked again while its answers are the same', async () => {
    const d = draft('skipme', [{ label: 'Keep', ops: [] }, { label: 'Skip', ops: [{ op: 'updateWish', id: 'pantheon', fields: { skipped: true } }] }]);
    const [q] = await qs.checkQuestionDrafts(trip(), [d]);
    await qs.answerQuestion(trip(), q.id, { action: 'skip' }, OWNER);
    expect(await qs.checkQuestionDrafts(trip(), [d])).toEqual([]);
  });
});

describe('answering', () => {
  async function familyQuestion() {
    const [q] = await qs.checkQuestionDrafts(trip(), [
      { key: 'fam', origin: 'planner', prompt: 'Pizza or gelato crawl on Wednesday night?', why: null, answers: [{ label: 'Pizza', ops: [] }, { label: 'Skip the Pantheon', ops: [{ op: 'updateWish', id: 'pantheon', fields: { skipped: true } }], remember: 'We prefer pizza' }], defaultIndex: 0, ifSkipped: null, audience: 'family', deadline: null },
    ]);
    return q;
  }

  it('a family member votes; a parent decides; a member cannot see an owner question', async () => {
    const q = await familyQuestion();
    const vote = await qs.answerQuestion(trip(), q.id, { action: 'answer', answerId: 'a1' }, KID);
    expect(vote.status).toBe(200);
    expect(vote.body).toMatchObject({ question: { status: 'open', votes: { a1: ['Sam'] } }, undo: null });
    expect(h.wishes.find((w) => w.id === 'pantheon')?.skipped).toBe(false);
    expect((await qs.answerQuestion(trip(), q.id, { action: 'decide' }, KID)).status).toBe(403);
    const decided = await qs.answerQuestion(trip(), q.id, { action: 'answer', answerId: 'a1' }, PARENT);
    expect(decided.body).toMatchObject({ question: { status: 'answered', answeredByName: 'Alex' }, remember: null });
    expect(h.wishes.find((w) => w.id === 'pantheon')?.skipped).toBe(true);
    // Already answered: 409, which the phone reads as "done".
    expect((await qs.answerQuestion(trip(), q.id, { action: 'vote', answerId: 'a0' }, KID)).status).toBe(409);
    const [owners] = await qs.checkQuestionDrafts(trip(), [{ key: 'o', origin: 'planner', prompt: 'Owner only?', why: null, answers: [{ label: 'Keep', ops: [] }, { label: 'Skip', ops: [{ op: 'updateWish', id: 'altemps', fields: { skipped: true } }] }], defaultIndex: 0, ifSkipped: null, audience: 'owner', deadline: null }]);
    expect((await qs.answerQuestion(trip(), owners.id, { action: 'vote', answerId: 'a1' }, KID)).status).toBe(404);
  });

  it('remember is offered to the owner only', async () => {
    const q = await familyQuestion();
    const out = await qs.answerQuestion(trip(), q.id, { action: 'answer', answerId: 'a1' }, OWNER);
    expect(out.body).toMatchObject({ remember: 'We prefer pizza' });
  });

  it('decide takes the assumed answer: no stop moves, but its booking is still made', async () => {
    const [q] = await qs.refreshQuestions(trip());
    const out = await qs.answerQuestion(trip(), q.id, { action: 'decide' }, OWNER);
    expect(out.body).toMatchObject({ question: { status: 'answered', answerId: 'a0' }, diff: { changes: [] } });
    // The to-book booking is added (it moves nothing, but it is the answer).
    expect(h.bookings).toEqual([expect.objectContaining({ wishId: 'colosseum', status: 'to-book' })]);
  });

  it('an answer with no ops closes the question without a new version', async () => {
    const [q] = await qs.checkQuestionDrafts(trip(), [{ key: 'n', origin: 'planner', prompt: 'Keep it?', why: null, answers: [{ label: 'Keep', ops: [] }, { label: 'Skip', ops: [{ op: 'updateWish', id: 'altemps', fields: { skipped: true } }] }], defaultIndex: 0, ifSkipped: null, audience: 'owner', deadline: null }]);
    const before = h.plans.length;
    const out = await qs.answerQuestion(trip(), q.id, { action: 'decide' }, OWNER);
    expect(out.body).toMatchObject({ question: { status: 'answered', answerId: 'a0' }, undo: null, diff: { changes: [] }, planVersion: 1 });
    expect(h.plans.length).toBe(before);
  });

  it('a tie between day versions answered here takes that version and closes the other', async () => {
    const add = (title: string, lat: number) => [{ op: 'addWish', wish: { title, placeQuery: null, priority: 'nice', durationMin: 60, partOfDay: 'any', fixedDate: null, fixedStartMin: null, note: null, replacesMeal: null, place: { name: title, location: { lat, lng: 12.48 }, osmId: null, address: null } } }];
    h.proposals = [
      { id: 's1', groupId: 'day:shapes:1', kind: 'day', title: 'Quiet corners', ops: add('Quiet museum', 41.9), status: 'open', scope: { date: '2026-10-27' } },
      { id: 's2', groupId: 'day:shapes:1', kind: 'day', title: 'Famous first', ops: add('Big museum', 41.901), status: 'open', scope: { date: '2026-10-27' } },
    ];
    const added = await qs.refreshQuestions(trip());
    const tie = added.find((q) => q.origin === 'tie');
    expect(tie).toBeDefined();
    expect(tie!.appliedDefault).toBe(false);
    await qs.answerQuestion(trip(), tie!.id, { action: 'answer', answerId: 'a1' }, OWNER);
    expect(h.proposals.map((p) => p.status).sort()).toEqual(['accepted', 'superseded']);
  });

  it('a tie whose versions were decided elsewhere expires', async () => {
    const add = (title: string, lat: number) => [{ op: 'addWish', wish: { title, placeQuery: null, priority: 'nice', durationMin: 60, partOfDay: 'any', fixedDate: null, fixedStartMin: null, note: null, replacesMeal: null, place: { name: title, location: { lat, lng: 12.48 }, osmId: null, address: null } } }];
    h.proposals = [
      { id: 's1', groupId: 'day:shapes:2', kind: 'day', title: 'Quiet corners', ops: add('Quiet museum', 41.9), status: 'open', scope: { date: '2026-10-27' } },
      { id: 's2', groupId: 'day:shapes:2', kind: 'day', title: 'Famous first', ops: add('Big museum', 41.901), status: 'open', scope: { date: '2026-10-27' } },
    ];
    const tie = (await qs.refreshQuestions(trip())).find((q) => q.origin === 'tie')!;
    // Accepted through the proposals route: the shapes are no longer open.
    h.proposals.forEach((p) => (p.status = p.id === 's1' ? 'accepted' : 'expired'));
    await qs.refreshQuestions(trip());
    expect(h.questions.find((q) => q.id === tie.id)?.status).toBe('expired');
  });
});

describe('pushes', () => {
  const q = { id: 'q9', prompt: 'Keep it?', impact: 2, audience: 'parents', answers: [{ id: 'a0', label: 'Yes' }, { id: 'a1', label: 'No' }] } as unknown as Question;
  it('at most one a day, only before the trip, to the question’s audience', async () => {
    // The store stamps a push with the clock, not with `now`: pin the clock to
    // the first push, or "the same day" stops being true the day after this was written.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-21T08:00:00Z'));
    h.questions.push({ ...q, key: 'k', status: 'open' } as never);
    const push = vi.fn(async (to: readonly string[], _msg: unknown) => ({ sent: to.length, failed: 0, reached: new Set<string>() }));
    expect(await qs.pushQuestions(trip(), [q], { push, now: new Date('2026-10-21T08:00:00Z') })).toBe(2);
    expect(push.mock.calls[0][0]).toEqual(['owner@example.test', 'parent@example.test']);
    expect(push.mock.calls[0][1]).toMatchObject({ category: 'trip-q-q9', userInfo: { answers: [{ id: 'a0', label: 'Yes' }, { id: 'a1', label: 'No' }], prompt: 'Keep it?' } });
    expect(await qs.pushQuestions(trip(), [q], { push, now: new Date('2026-10-21T18:00:00Z') })).toBe(0);
    expect(await qs.pushQuestions(trip(), [q], { push, now: new Date('2026-10-26T08:00:00Z') })).toBe(0);
    vi.useRealTimers();
  });

  it('reads the route body', () => {
    expect(qs.parseQuestionAction({ action: 'answer', answerId: 'a1' })).toEqual({ action: 'answer', answerId: 'a1' });
    expect(qs.parseQuestionAction({ action: 'answer' })).toBeNull();
    expect(qs.parseQuestionAction({ action: 'skip' })).toEqual({ action: 'skip' });
    expect(qs.parseQuestionAction({ action: 'vote', answerId: 'x' })).toBeNull();
  });
});

describe('question notifications off, per person (v8.1)', () => {
  it('a push skips anyone who turned this trip’s question notifications off', async () => {
    const sentTo: string[][] = [];
    const q = { id: 'q9', prompt: 'Keep it?', impact: 2, audience: 'owner', answers: [{ id: 'a0', label: 'Yes' }, { id: 'a1', label: 'No' }] } as unknown as Question;
    const push = async (to: string[]) => (sentTo.push(to), { sent: to.length });
    const t = trip() as { ownerEmail: string };
    const before = new Date('2026-10-21T08:00:00Z');
    expect(await qs.pushQuestions(t as never, [q], { push: push as never, now: before, mutedFor: async () => [t.ownerEmail.toLowerCase()] })).toBe(0);
    expect(sentTo).toEqual([]);
    expect(await qs.pushQuestions(t as never, [q], { push: push as never, now: before, mutedFor: async () => [] })).toBe(1);
  });
});

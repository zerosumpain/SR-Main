import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The phone's Noticed endpoints — `GET /api/native/daydream` and
 * `POST /api/native/daydream/feedback`. Device-gated; input validated before
 * anything is read; `never` reaches the writer as the kind mute.
 */

let device: { id: string; ownerEmail: string; expiresAt: Date } | null = { id: 'dev-1', ownerEmail: 'owner@example.com', expiresAt: new Date(Date.now() + 60000) };
vi.mock('$lib/server/native-auth', () => ({
  identifyDevice: async () => device,
  touchDevice: async () => {},
}));
vi.mock('$env/dynamic/private', () => ({ env: { AUTH_ALLOWED_EMAILS: 'owner@example.com' } }));

const note = {
  id: 't-1',
  outcome: 'health_plan',
  channel: 'health',
  title: 'An easier week after three short nights',
  body: 'Three nights under six hours.',
  createdAt: '2026-09-25T16:00:00.000Z',
  url: '/jkai/daydreams?note=t-1',
  feedback: null,
};
const loadNativeNotes = vi.fn(async (_opts: { scope: string; limit: number }) => [note]);
let knownKind: string | null = 'think_health_plan';
const loadNativeDetail = vi.fn(async (_opts: { limit: number }) => ({
  notes: [{ ...note, summary: 'Three nights under six hours.', next: null, sources: [], stage: 'spotted', bucket: 'decide', checkable: false, commissionId: null, commissionState: null }],
  pipeline: { decide: 1, motion: 0, done: 0 },
}));
let impactFails = false;
vi.mock('$lib/daydream/impact.server', () => ({
  loadImpact: async () => {
    if (impactFails) throw new Error('db down');
    const { computeImpact } = await import('../../../../src/lib/daydream/impact');
    return { impact: computeImpact([], [], [], new Date('2026-09-28T12:00:00Z')), results: [] };
  },
}));
vi.mock('$lib/daydream/think/notes.server', () => ({
  loadNativeNotes: (opts: { scope: string; limit: number }) => loadNativeNotes(opts),
  loadNativeDetail: (opts: { limit: number }) => loadNativeDetail(opts),
  thinkNoteKind: async () => knownKind,
}));
const recordFeedback = vi.fn(async () => ({ kind: 'think_health_plan', muted: false }));
vi.mock('$lib/daydream/thought-store', () => ({
  recordFeedback: (...a: unknown[]) => recordFeedback(...(a as [])),
}));

async function list(query = '') {
  const mod = await import('../../../../src/routes/api/native/daydream/+server');
  const request = new Request(`http://x/api/native/daydream${query}`, { headers: { Authorization: 'Bearer t' } });
  return (mod.GET as (e: unknown) => Promise<Response>)({ locals: {}, request, url: new URL(request.url), params: {} });
}

async function feedback(body: unknown) {
  const mod = await import('../../../../src/routes/api/native/daydream/feedback/+server');
  const request = new Request('http://x/api/native/daydream/feedback', {
    method: 'POST',
    headers: { Authorization: 'Bearer t', 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return (mod.POST as (e: unknown) => Promise<Response>)({ locals: {}, request, url: new URL(request.url), params: {} });
}

beforeEach(() => {
  device = { id: 'dev-1', ownerEmail: 'owner@example.com', expiresAt: new Date(Date.now() + 60000) };
  knownKind = 'think_health_plan';
  loadNativeNotes.mockClear();
  loadNativeDetail.mockClear();
  recordFeedback.mockClear();
});

describe('GET /api/native/daydream?detail=1', () => {
  it('adds stage, pipeline and the impact card without touching the plain list', async () => {
    impactFails = false;
    const res = await list('?detail=1');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(loadNativeDetail).toHaveBeenCalledWith({ limit: 40 });
    expect(loadNativeNotes).not.toHaveBeenCalled();
    expect(body.pipeline).toEqual({ decide: 1, motion: 0, done: 0 });
    expect(body.notes[0]).toMatchObject({ id: 't-1', bucket: 'decide', stage: 'spotted' });
    expect(body.impact).toMatchObject({ windowDays: 28, hitRate: null });
    expect(body.impact.weeks).toHaveLength(12);
  });
  it('costs only the card when the impact read fails', async () => {
    impactFails = true;
    const body = await (await list('?detail=1')).json();
    expect(body.impact).toBeNull();
    expect(body.notes).toHaveLength(1);
  });
  it('ignores detail on a scoped read', async () => {
    await list('?detail=1&scope=health');
    expect(loadNativeDetail).not.toHaveBeenCalled();
  });
});

describe('GET /api/native/daydream', () => {
  it('401s without a paired device', async () => {
    device = null;
    expect((await list()).status).toBe(401);
  });

  it('answers { notes } for the health scope, limit clamped to 20', async () => {
    const res = await list('?scope=health&limit=50');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ notes: [note] });
    expect(loadNativeNotes).toHaveBeenCalledWith({ scope: 'health', limit: 20 });
  });

  it('defaults to every note, five of them', async () => {
    await list();
    expect(loadNativeNotes).toHaveBeenCalledWith({ scope: 'all', limit: 5 });
  });

  it('400s an unknown scope without reading anything', async () => {
    expect((await list('?scope=money')).status).toBe(400);
    expect(loadNativeNotes).not.toHaveBeenCalled();
  });
});

describe('POST /api/native/daydream/feedback', () => {
  it('records a verdict through the shared writer', async () => {
    const res = await feedback({ id: 't-1', verdict: 'useful' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(recordFeedback).toHaveBeenCalledWith('t-1', 'useful', undefined, 'explicit');
  });

  it('writes never as the kind mute', async () => {
    await feedback({ id: 't-1', verdict: 'never' });
    expect(recordFeedback).toHaveBeenCalledWith('t-1', 'never_kind', undefined, 'explicit');
  });

  it('400s bad input before touching the ledger', async () => {
    for (const body of ['not json', { id: 't-1' }, { id: 't-1', verdict: 'meh' }, { verdict: 'useful' }]) {
      expect((await feedback(body)).status).toBe(400);
    }
    expect(recordFeedback).not.toHaveBeenCalled();
  });

  it('404s an id that is not a think note', async () => {
    knownKind = null;
    expect((await feedback({ id: 'nope', verdict: 'useful' })).status).toBe(404);
    expect(recordFeedback).not.toHaveBeenCalled();
  });
});

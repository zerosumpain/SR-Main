import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The phone's Noticed endpoints — `GET /api/native/daydream` and
 * `POST /api/native/daydream/feedback`. Device-gated; input validated before
 * anything is read; `never` reaches the writer as the kind mute.
 */

let device: { id: string; ownerEmail: string } | null = { id: 'dev-1', ownerEmail: 'owner@example.com' };
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
vi.mock('$lib/daydream/think/notes.server', () => ({
  loadNativeNotes: (opts: { scope: string; limit: number }) => loadNativeNotes(opts),
  thinkNoteKind: async () => knownKind,
}));
const recordFeedback = vi.fn(async () => ({ kind: 'think_health_plan', muted: false }));
vi.mock('$lib/daydream/thought-store', () => ({
  recordFeedback: (...a: unknown[]) => recordFeedback(...(a as [])),
}));

async function list(query = '') {
  const mod = await import('../../../../src/routes/api/native/daydream/+server');
  const request = new Request(`http://x/api/native/daydream${query}`, { headers: { Authorization: 'Bearer t' } });
  return (mod.GET as (e: unknown) => Promise<Response>)({ request, url: new URL(request.url), params: {} });
}

async function feedback(body: unknown) {
  const mod = await import('../../../../src/routes/api/native/daydream/feedback/+server');
  const request = new Request('http://x/api/native/daydream/feedback', {
    method: 'POST',
    headers: { Authorization: 'Bearer t', 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return (mod.POST as (e: unknown) => Promise<Response>)({ request, url: new URL(request.url), params: {} });
}

beforeEach(() => {
  device = { id: 'dev-1', ownerEmail: 'owner@example.com' };
  knownKind = 'think_health_plan';
  loadNativeNotes.mockClear();
  recordFeedback.mockClear();
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

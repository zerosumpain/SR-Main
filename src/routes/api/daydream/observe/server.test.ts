import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  members: [] as Array<{ subject: string; source: string }>,
  membersFail: false,
  written: [] as string[],
}));

vi.mock('$env/dynamic/private', () => ({ env: { DAYDREAM_INGEST_SECRET: 'test-secret' } }));
vi.mock('$lib/home/presence/types', () => ({
  DEFAULT_SUBJECT: 'john',
  INGEST_SECRET_ENV: 'DAYDREAM_INGEST_SECRET',
  errMsg: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));
vi.mock('$lib/home/presence/observe', () => ({
  recordFix: async (_fix: unknown, _source: string, subject: string) => {
    h.written.push(subject);
    return { id: 1, mode: 'unknown', placeId: null };
  },
}));
vi.mock('$lib/home/presence/members', () => ({
  listMembers: async () => {
    if (h.membersFail) throw new Error('db hiccup');
    return h.members;
  },
  isLife360Subject: (members: Array<{ subject: string; source: string }>, subject: string) =>
    members.some((m) => m.subject === subject && m.source === 'life360'),
}));

import { POST } from './+server';

function post(body: Record<string, unknown>) {
  const request = new Request('http://localhost/api/daydream/observe', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Broadcast-Key': 'test-secret' },
    body: JSON.stringify(body),
  });
  return POST({ request } as unknown as Parameters<typeof POST>[0]) as Promise<Response>;
}

beforeEach(() => {
  h.members = [
    { subject: 'john', source: 'life360' },
    { subject: 'app', source: 'companion' },
    { subject: 'off', source: 'none' },
  ];
  h.membersFail = false;
  h.written = [];
});

describe('POST /api/daydream/observe consent guard', () => {
  it('writes a life360 member', async () => {
    const res = await post({ lat: 51, lon: -1 });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, id: 1 });
    expect(h.written).toEqual(['john']);
  });

  it.each(['app', 'off', 'stranger'])('ignores %s, who is not tracked from HA', async (subject) => {
    const res = await post({ lat: 51, lon: -1, subject });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, ignored: true });
    expect(h.written).toEqual([]);
  });

  it('writes nothing when the members table cannot be read', async () => {
    h.membersFail = true;
    const res = await post({ lat: 51, lon: -1 });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, ignored: true, reason: 'members unavailable' });
    expect(h.written).toEqual([]);
  });
});

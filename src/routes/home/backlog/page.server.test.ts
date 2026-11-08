import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BacklogRecord } from '$lib/family/backlog';

const h = vi.hoisted(() => ({
  caller: { email: 'owner@example.test', parent: true } as null | { email: string; parent: boolean },
  items: new Map<string, BacklogRecord>(),
}));

vi.mock('$lib/family/access.server', () => ({ webFamilyCaller: async () => h.caller }));
vi.mock('$lib/server/viewer', () => ({ viewerOf: async () => ({ kind: h.caller?.parent ? 'owner' : 'member' }) }));
vi.mock('$lib/family/roster.server', () => ({
  familyRoster: async () => [{ id: 'f_owner', email: 'owner@example.test', name: 'Owner', parent: true, pilot: true }],
  familyId: (e: string) => `f_${e.split('@')[0]}`,
  familyPersonFor: async (email: string, parent: boolean) => ({ id: `f_${email.split('@')[0]}`, email, name: 'x', parent, pilot: false }),
}));
vi.mock('$lib/family/backlog.server', () => ({
  loadItems: async () => [...h.items.values()],
  loadReactions: async () => [],
  getItem: async (id: string) => h.items.get(id) ?? null,
  applyTransition: async (id: string, t: { from: string; patch: Partial<BacklogRecord> }) => {
    const cur = h.items.get(id);
    if (!cur || cur.status !== t.from) return null;
    const next = { ...cur, ...t.patch };
    h.items.set(id, next);
    return next;
  },
}));

const page = await import('./+page.server');

function base(over: Partial<BacklogRecord> = {}): BacklogRecord {
  return {
    id: 'b1', kind: 'video', url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', canonicalUrl: 'youtube:aaaaaaaaaaa',
    provider: 'youtube', title: 'A video', siteName: 'YouTube', thumbnailUrl: null, note: null, forEmail: null,
    addedByEmail: 'kid@example.test', status: 'new', doneByEmail: null, doneAt: null, taskId: null,
    createdAt: new Date('2026-10-10T00:00:00Z'), updatedAt: new Date('2026-10-10T00:00:00Z'), ...over,
  };
}

const form = (id: string) => {
  const body = new FormData();
  body.set('id', id);
  return { request: new Request('http://x', { method: 'POST', body }), locals: {} } as never;
};

beforeEach(() => {
  h.caller = { email: 'owner@example.test', parent: true };
  h.items.clear();
});

describe('/home/backlog', () => {
  it('refuses anyone outside the family', async () => {
    h.caller = null;
    await expect(page.load({ locals: {}, setHeaders: () => {} } as never)).rejects.toMatchObject({ status: 403 });
    expect(await page.actions.done(form('b1'))).toMatchObject({ status: 403 });
  });

  it('loads the list with ids, never addresses', async () => {
    h.items.set('b1', base());
    const data = (await page.load({ locals: {}, setHeaders: () => {} } as never)) as { items: unknown[] };
    expect(data.items).toHaveLength(1);
    expect(JSON.stringify(data)).not.toContain('@example.test');
  });

  it('opens for a Family Circle member, who gets no "up" link to /home', async () => {
    h.caller = { email: 'kid@example.test', parent: false };
    h.items.set('b1', base());
    const data = (await page.load({ locals: {}, setHeaders: () => {} } as never)) as { owner: boolean; me: { parent: boolean } };
    expect(data).toMatchObject({ owner: false, me: { parent: false } });
    expect(await page.actions.done(form('b1'))).toEqual({ moved: 'b1' });
  });

  it('marks watched and back, and 409s a stale move', async () => {
    h.items.set('b1', base());
    expect(await page.actions.done(form('b1'))).toEqual({ moved: 'b1' });
    expect(h.items.get('b1')?.status).toBe('done');
    expect(await page.actions.dismiss(form('b1'))).toMatchObject({ status: 409 });
    expect(await page.actions.reopen(form('b1'))).toEqual({ moved: 'b1' });
    expect(await page.actions.done(form('nope'))).toMatchObject({ status: 404 });
  });
});

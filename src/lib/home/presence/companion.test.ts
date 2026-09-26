import { describe, it, expect, vi, beforeEach } from 'vitest';

// Settings and the trail writer are the only side effects; both are faked so
// no test here touches a database. `order` records the interleaving so the
// cursor can be shown to move only after its page's fixes are written.
const h = vi.hoisted(() => ({
  settings: new Map<string, unknown>(),
  order: [] as string[],
  recorded: [] as Array<{ fix: Record<string, unknown>; source: string; subject: string }>,
  failWrite: false,
}));

vi.mock('$lib/server/models/settings', () => ({
  getSetting: async (k: string) => (h.settings.has(k) ? h.settings.get(k) : null),
  setSetting: async (k: string, v: unknown) => {
    h.order.push(`set:${k}=${typeof v === 'string' ? v : 'users'}`);
    h.settings.set(k, v);
  },
}));

vi.mock('./observe', () => ({
  isPlausibleCoord: (lat: unknown, lon: unknown) =>
    typeof lat === 'number' && typeof lon === 'number' && !(lat === 0 && lon === 0),
  recordFix: async (fix: Record<string, unknown>, source: string, subject: string) => {
    if (h.failWrite) throw new Error('db down');
    h.order.push(`fix:${subject}`);
    h.recorded.push({ fix, source, subject });
    return { id: h.recorded.length };
  },
}));

import {
  COMPANION_CURSOR_KEY,
  COMPANION_USERS_KEY,
  fetchHousehold,
  ingestCompanion,
  notSharingSubjects,
  toIncomingFix,
  type HouseholdFix,
  type HouseholdPage,
} from './companion';
import type { HouseholdMember } from './members';

const TOKEN = 'test-household-token';

function member(subject: string, extra: Partial<HouseholdMember> = {}): HouseholdMember {
  return {
    subject,
    email: `${subject}@example.test`,
    displayName: subject,
    source: 'companion',
    haPersonEntity: null,
    whatsapp: null,
    alerts: {},
    ...extra,
  };
}

function fix(email: string, id: string, extra: Partial<HouseholdFix> = {}): HouseholdFix {
  return {
    email,
    id,
    recorded: '2026-09-26T08:00:00Z',
    lat: 51.0,
    lon: -1.0,
    accuracy: 10,
    speed: 1.5,
    moving: true,
    ...extra,
  };
}

function pageResponse(page: HouseholdPage, status = 200): Response {
  return new Response(JSON.stringify(page), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  h.settings.clear();
  h.order = [];
  h.recorded = [];
  h.failWrite = false;
  process.env.COMPANION_HOUSEHOLD_TOKEN = TOKEN;
  delete process.env.COMPANION_URL;
});

describe('toIncomingFix', () => {
  it('converts m/s to km/h and carries accuracy and time', () => {
    expect(toIncomingFix(fix('a@example.test', '1', { speed: 2 }))).toEqual({
      lat: 51.0,
      lon: -1.0,
      accuracyM: 10,
      at: '2026-09-26T08:00:00Z',
      speedKmh: 7.2,
    });
  });

  it('reads a negative or missing speed as unknown', () => {
    expect(toIncomingFix(fix('a@example.test', '1', { speed: -1 })).speedKmh).toBeNull();
    expect(toIncomingFix(fix('a@example.test', '1', { speed: null })).speedKmh).toBeNull();
  });
});

describe('fetchHousehold', () => {
  it('does not fetch at all when the token is unset', async () => {
    delete process.env.COMPANION_HOUSEHOLD_TOKEN;
    const f = vi.fn();
    expect(await fetchHousehold('', f as unknown as typeof fetch)).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it('sends the bearer token and the cursor to the default loopback URL', async () => {
    const f = vi.fn(async () => pageResponse({ cursor: 'c1', more: false, users: [], fixes: [] }));
    await fetchHousehold('c0', f as unknown as typeof fetch);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('http://127.0.0.1:5295/api/apple/household?');
    expect(url).toContain('since=c0');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('throws on a refused token rather than reading it as an empty page', async () => {
    const f = vi.fn(async () => new Response('no', { status: 401 }));
    await expect(fetchHousehold('', f as unknown as typeof fetch)).rejects.toThrow(/401/);
  });
});

describe('ingestCompanion', () => {
  it('returns null and fetches nothing when the token is unset', async () => {
    delete process.env.COMPANION_HOUSEHOLD_TOKEN;
    const f = vi.fn();
    expect(await ingestCompanion([member('a')], f as unknown as typeof fetch)).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it('pages until more=false, starting from the stored cursor', async () => {
    h.settings.set(COMPANION_CURSOR_KEY, 'start');
    const pages: HouseholdPage[] = [
      { cursor: 'p1', more: true, users: [], fixes: [fix('a@example.test', '1')] },
      { cursor: 'p2', more: false, users: [], fixes: [fix('A@Example.test', '2')] },
    ];
    const f = vi.fn(async () => pageResponse(pages.shift()!));
    const res = await ingestCompanion([member('a')], f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledTimes(2);
    expect((f.mock.calls[0] as unknown as [string])[0]).toContain('since=start');
    expect((f.mock.calls[1] as unknown as [string])[0]).toContain('since=p1');
    expect(res).toMatchObject({ pages: 2, written: 2, dropped: 0 });
    expect(h.recorded.every((r) => r.source === 'companion' && r.subject === 'a')).toBe(true);
    expect(h.settings.get(COMPANION_CURSOR_KEY)).toBe('p2');
  });

  it('stops at the page cap', async () => {
    const f = vi.fn(async () => pageResponse({ cursor: 'x', more: true, users: [], fixes: [] }));
    const res = await ingestCompanion([member('a')], f as unknown as typeof fetch, 3);
    expect(f).toHaveBeenCalledTimes(3);
    expect(res?.more).toBe(true);
  });

  it('persists the cursor only after the page fixes are written', async () => {
    const f = vi.fn(async () =>
      pageResponse({
        cursor: 'p1',
        more: false,
        users: [],
        fixes: [fix('a@example.test', '1'), fix('b@example.test', '2')],
      }),
    );
    await ingestCompanion([member('a'), member('b')], f as unknown as typeof fetch);
    const cursorAt = h.order.indexOf(`set:${COMPANION_CURSOR_KEY}=p1`);
    expect(cursorAt).toBeGreaterThan(h.order.lastIndexOf('fix:b'));
    expect(h.order.lastIndexOf('fix:b')).toBeGreaterThan(-1);
  });

  it('keeps the cursor where it was when a write fails, so the page is retried', async () => {
    h.settings.set(COMPANION_CURSOR_KEY, 'before');
    h.failWrite = true;
    const f = vi.fn(async () =>
      pageResponse({ cursor: 'p1', more: false, users: [], fixes: [fix('a@example.test', '1')] }),
    );
    const res = await ingestCompanion([member('a')], f as unknown as typeof fetch);
    expect(h.settings.get(COMPANION_CURSOR_KEY)).toBe('before');
    expect(res?.error).toMatch(/db down/);
  });

  it('drops fixes for unknown emails and for members not on the companion source', async () => {
    const f = vi.fn(async () =>
      pageResponse({
        cursor: 'p1',
        more: false,
        users: [],
        fixes: [
          fix('a@example.test', '1'),
          fix('stranger@example.test', '2'),
          fix('l@example.test', '3'),
          fix('n@example.test', '4'),
        ],
      }),
    );
    const res = await ingestCompanion(
      [member('a'), member('l', { source: 'life360' }), member('n', { source: 'none' })],
      f as unknown as typeof fetch,
    );
    expect(res).toMatchObject({ written: 1, dropped: 3 });
    expect(h.recorded.map((r) => r.subject)).toEqual(['a']);
    expect(h.settings.get(COMPANION_CURSOR_KEY)).toBe('p1');
  });

  it('counts an implausible fix as rejected without blocking the cursor', async () => {
    const f = vi.fn(async () =>
      pageResponse({ cursor: 'p1', more: false, users: [], fixes: [fix('a@example.test', '1', { lat: 0, lon: 0 })] }),
    );
    const res = await ingestCompanion([member('a')], f as unknown as typeof fetch);
    expect(res).toMatchObject({ written: 0, rejected: 1 });
    expect(h.settings.get(COMPANION_CURSOR_KEY)).toBe('p1');
  });

  it('stores the latest users list', async () => {
    const users = [{ email: 'a@example.test', name: 'A', sharing: false }];
    const f = vi.fn(async () => pageResponse({ cursor: 'p1', more: false, users, fixes: [] }));
    await ingestCompanion([member('a')], f as unknown as typeof fetch);
    expect(h.settings.get(COMPANION_USERS_KEY)).toEqual(users);
  });
});

describe('notSharingSubjects', () => {
  it('marks only companion members whose pilot user has sharing off', () => {
    const out = notSharingSubjects(
      [member('a'), member('b'), member('l', { source: 'life360' })],
      [
        { email: 'A@example.test', name: 'A', sharing: false },
        { email: 'b@example.test', name: 'B', sharing: true },
        { email: 'l@example.test', name: 'L', sharing: false },
      ],
    );
    expect([...out]).toEqual(['a']);
  });

  it('is empty when no users list has been stored yet', () => {
    expect(notSharingSubjects([member('a')], null).size).toBe(0);
  });
});

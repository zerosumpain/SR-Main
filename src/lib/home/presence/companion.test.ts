import { describe, it, expect, vi, beforeEach } from 'vitest';

// Settings and the trail writer are the only side effects; both are faked so
// no test here touches a database. `order` records the interleaving so the
// cursor can be shown to move only after its page's fixes are written.
const h = vi.hoisted(() => ({
  settings: new Map<string, unknown>(),
  order: [] as string[],
  recorded: [] as Array<{ fix: Record<string, unknown>; source: string; subject: string }>,
  failWrite: false,
  /** Fail the write with this 1-based index in the run, once. */
  failOnWrite: 0,
  writes: 0,
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
  latestTsBySource: async (source: string, subjects: string[]) => {
    const out = new Map<string, Date>();
    for (const r of h.recorded) {
      if (r.source !== source || !subjects.includes(r.subject)) continue;
      const ts = new Date(String(r.fix.at));
      const cur = out.get(r.subject);
      if (!cur || ts > cur) out.set(r.subject, ts);
    }
    return out;
  },
  recordFix: async (fix: Record<string, unknown>, source: string, subject: string) => {
    h.writes++;
    if (h.failWrite || h.writes === h.failOnWrite) throw new Error('db down');
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
  h.failOnWrite = 0;
  h.writes = 0;
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
      batteryPct: null,
    });
  });

  it('carries a whole-percent battery, and drops anything that cannot be one', () => {
    expect(toIncomingFix({ ...fix('a@example.test', '1'), battery: 64 }).batteryPct).toBe(64);
    for (const bad of [101, -1, 50.5, null, undefined]) {
      expect(toIncomingFix({ ...fix('a@example.test', '1'), battery: bad }).batteryPct).toBeNull();
    }
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
      { cursor: 'p1', more: true, users: [], fixes: [fix('a@example.test', '1', { recorded: '2026-09-26T08:00:00Z' })] },
      { cursor: 'p2', more: false, users: [], fixes: [fix('A@Example.test', '2', { recorded: '2026-09-26T08:01:00Z' })] },
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

  it('writes each fix once when a page is replayed after a partial failure', async () => {
    const page: HouseholdPage = {
      cursor: 'p1',
      more: false,
      users: [],
      fixes: [
        fix('a@example.test', '1', { recorded: '2026-09-26T08:00:00Z' }),
        fix('a@example.test', '2', { recorded: '2026-09-26T08:01:00Z' }),
        fix('a@example.test', '3', { recorded: '2026-09-26T08:02:00Z' }),
      ],
    };
    const f = vi.fn(async () => pageResponse(page));
    h.failOnWrite = 2;
    const first = await ingestCompanion([member('a')], f as unknown as typeof fetch);
    expect(first?.error).toMatch(/db down/);
    expect(h.settings.get(COMPANION_CURSOR_KEY)).toBeUndefined();

    const second = await ingestCompanion([member('a')], f as unknown as typeof fetch);
    expect(second).toMatchObject({ written: 2, skipped: 1 });
    expect(h.recorded.map((r) => r.fix.at)).toEqual([
      '2026-09-26T08:00:00Z',
      '2026-09-26T08:01:00Z',
      '2026-09-26T08:02:00Z',
    ]);
    expect(h.settings.get(COMPANION_CURSOR_KEY)).toBe('p1');
  });

  it('skips a fix no newer than the last one written for that person', async () => {
    const f = vi.fn(async () =>
      pageResponse({
        cursor: 'p1',
        more: false,
        users: [],
        fixes: [
          fix('a@example.test', '1', { recorded: '2026-09-26T08:05:00Z' }),
          fix('a@example.test', '2', { recorded: '2026-09-26T08:04:00Z' }),
          fix('b@example.test', '3', { recorded: '2026-09-26T08:04:00Z' }),
        ],
      }),
    );
    const res = await ingestCompanion([member('a'), member('b')], f as unknown as typeof fetch);
    expect(res).toMatchObject({ written: 2, skipped: 1 });
    expect(h.recorded.map((r) => r.subject)).toEqual(['a', 'b']);
  });

  it('keeps one fix per person every five seconds from a close-tracking phone', async () => {
    const at = (sec: number) => new Date(Date.parse('2026-09-26T08:00:00Z') + sec * 1000).toISOString();
    const f = vi.fn(async () =>
      pageResponse({
        cursor: 'p1',
        more: false,
        users: [],
        // A fix a second for ten seconds, and another person's fix between.
        fixes: [
          ...Array.from({ length: 11 }, (_, i) => fix('a@example.test', `a${i}`, { recorded: at(i) })),
          fix('b@example.test', 'b0', { recorded: at(1) }),
        ],
      }),
    );
    const res = await ingestCompanion([member('a'), member('b')], f as unknown as typeof fetch);
    expect(res).toMatchObject({ written: 4, thinned: 8 });
    expect(h.recorded.filter((r) => r.subject === 'a')).toHaveLength(3); // 0 s, 5 s, 10 s
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

  it('counts a companion member absent from a read list as not sharing', () => {
    const out = notSharingSubjects(
      [member('a'), member('b'), member('n', { email: null }), member('l', { source: 'life360' })],
      [{ email: ' B@Example.test ', name: 'B', sharing: true }],
    );
    expect([...out].sort()).toEqual(['a', 'n']);
    // An empty list that WAS read is still an answer: nobody is sharing.
    expect([...notSharingSubjects([member('a')], [])]).toEqual(['a']);
  });

  it('fails closed with no users list: every companion member is not sharing', () => {
    const members = [member('a'), member('l', { source: 'life360' })];
    expect([...notSharingSubjects(members, null)]).toEqual(['a']);
    expect([...notSharingSubjects(members, undefined)]).toEqual(['a']);
  });
});

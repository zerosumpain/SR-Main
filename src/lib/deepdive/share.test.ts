import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// A tiny in-memory research_session: `eq`/`and` build row predicates over the
// column keys the schema mock hands out, so the queries in ./share run as written.
type Row = { id: string; topic: string; shareToken: string | null; shareTokenHash: string | null };
let rows: Row[] = [];

vi.mock('drizzle-orm', () => ({
  eq: (col: { key: keyof Row }, val: unknown) => (r: Row) => r[col.key] === val,
  and: (...ps: Array<(r: Row) => boolean>) => (r: Row) => ps.every((p) => p(r)),
}));
vi.mock('$lib/db/schema', () => ({
  researchSessions: {
    id: { key: 'id' },
    shareToken: { key: 'shareToken' },
    shareTokenHash: { key: 'shareTokenHash' },
  },
}));
vi.mock('$lib/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (p: (r: Row) => boolean) => ({ limit: async (n: number) => rows.filter(p).slice(0, n).map((r) => ({ ...r })) }),
      }),
    }),
    update: () => ({
      set: (patch: Partial<Row>) => ({
        where: async (p: (r: Row) => boolean) => {
          rows = rows.map((r) => (p(r) ? { ...r, ...patch } : r));
        },
      }),
    }),
  },
}));

const { findSharedSession, generateShareToken, hashShareToken, isShared, issueShare, revokeShare } = await import('./share');

const sha = (t: string) => createHash('sha256').update(t).digest('hex');
const LEGACY = '3f2a9c1e-6b7d-4e1f-9a2b-0c1d2e3f4a5b'; // randomUUID, as issued before hashing
const row = (id: string, patch: Partial<Row> = {}): Row => ({ id, topic: `topic ${id}`, shareToken: null, shareTokenHash: null, ...patch });

beforeEach(() => {
  rows = [];
});

describe('research share tokens', () => {
  it('hashes like decks and file shares: sha256 hex of the raw token', () => {
    expect(hashShareToken('abc')).toBe(sha('abc'));
    const t = generateShareToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateShareToken()).not.toBe(t);
  });

  it('issues a new link storing only its hash', async () => {
    rows = [row('s1')];
    const res = await issueShare(rows[0]);
    expect(res.status).toBe('issued');
    const token = (res as { token: string }).token;
    expect(rows[0]).toMatchObject({ shareToken: null, shareTokenHash: sha(token) });
    expect(JSON.stringify(rows)).not.toContain(token);
    expect((await findSharedSession(token))?.id).toBe('s1');
  });

  it('will not re-show a hashed link, and rotating replaces it', async () => {
    rows = [row('s1')];
    const first = (await issueShare(rows[0])) as { token: string };
    expect(await issueShare(rows[0])).toEqual({ status: 'exists' });

    const second = (await issueShare(rows[0], { rotate: true })) as { status: string; token: string };
    expect(second.status).toBe('issued');
    expect(second.token).not.toBe(first.token);
    expect(await findSharedSession(first.token)).toBeNull();
    expect((await findSharedSession(second.token))?.id).toBe('s1');
  });

  it('keeps a legacy plaintext link working and upgrades it on first use', async () => {
    rows = [row('old', { shareToken: LEGACY })];
    const found = await findSharedSession(LEGACY);
    expect(found?.id).toBe('old');
    expect(found).toMatchObject({ shareToken: null, shareTokenHash: sha(LEGACY) });
    expect(rows[0]).toMatchObject({ shareToken: null, shareTokenHash: sha(LEGACY) });
    // Same link, now matched by hash.
    expect((await findSharedSession(LEGACY))?.id).toBe('old');
  });

  it('re-issuing a legacy link returns the same token and upgrades it', async () => {
    rows = [row('old', { shareToken: LEGACY })];
    expect(await issueShare(rows[0])).toEqual({ status: 'issued', token: LEGACY });
    expect(rows[0]).toMatchObject({ shareToken: null, shareTokenHash: sha(LEGACY) });
    expect((await findSharedSession(LEGACY))?.id).toBe('old');
  });

  it('rotating a legacy link drops the plaintext', async () => {
    rows = [row('old', { shareToken: LEGACY })];
    const res = (await issueShare(rows[0], { rotate: true })) as { token: string };
    expect(res.token).not.toBe(LEGACY);
    expect(rows[0].shareToken).toBeNull();
    expect(await findSharedSession(LEGACY)).toBeNull();
  });

  it('a revoked link, legacy or hashed, opens nothing', async () => {
    rows = [row('a', { shareToken: LEGACY }), row('b')];
    const b = (await issueShare(rows[1])) as { token: string };
    await revokeShare('a');
    await revokeShare('b');
    expect(rows.every((r) => r.shareToken === null && r.shareTokenHash === null)).toBe(true);
    expect(await findSharedSession(LEGACY)).toBeNull();
    expect(await findSharedSession(b.token)).toBeNull();
  });

  it('does not treat a stored hash as a token, or accept short and empty tokens', async () => {
    rows = [row('s1', { shareTokenHash: sha('the-real-token-abcdefghijklmnop') })];
    expect(await findSharedSession(rows[0].shareTokenHash!)).toBeNull();
    expect(await findSharedSession('')).toBeNull();
    expect(await findSharedSession('short')).toBeNull();
    expect((await findSharedSession('the-real-token-abcdefghijklmnop'))?.id).toBe('s1');
  });

  it('isShared covers both columns', () => {
    expect(isShared({ shareToken: null, shareTokenHash: null })).toBe(false);
    expect(isShared({ shareToken: LEGACY, shareTokenHash: null })).toBe(true);
    expect(isShared({ shareToken: null, shareTokenHash: 'h' })).toBe(true);
  });
});

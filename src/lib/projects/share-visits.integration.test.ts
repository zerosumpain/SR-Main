/**
 * The share-link visitor rows against the disposable integration database:
 * a first page open adds a visitor and a data request never does, the
 * row cap, the counts that leave previewers out, browsers and networks
 * numbered in the order they came, and the rows going with their link. Rows
 * hang off throwaway links under one project key, removed after every case;
 * run only in the hermetic integration lane.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { projectShares, projectShareVisits } from '$lib/db/schema';
import { recordShareVisit, shareVisitStats, VISITOR_ROW_CAP } from './share-visits';
import type { ShareVisit } from './share-visitor';

const KEY = 'itest-share-visits';

async function cleanup(): Promise<void> {
  await db.delete(projectShares).where(eq(projectShares.projectKey, KEY));
}

beforeEach(cleanup);
afterEach(cleanup);

async function link(tokenHash: string): Promise<string> {
  const [row] = await db
    .insert(projectShares)
    .values({ projectKey: KEY, tokenHash: `${KEY}:${tokenHash}`, createdBy: 'itest' })
    .returning({ id: projectShares.id });
  return row.id;
}

const visit = (who: string, network: string, over: Partial<ShareVisit> = {}): ShareVisit => ({
  open: true,
  visitorHash: who.padEnd(32, '0'),
  networkHash: network ? network.padEnd(16, '0') : '',
  agent: 'Chrome · Windows',
  country: 'GB',
  ...over,
});

const rows = (shareId: string) =>
  db.select().from(projectShareVisits).where(eq(projectShareVisits.shareId, shareId));

describe('share visitor rows', () => {
  it('adds a visitor on a first page open, and only updates them after', async () => {
    const id = await link('a');
    await recordShareVisit(id, visit('aa', 'n1'));
    await recordShareVisit(id, visit('aa', 'n1', { open: false, agent: null }));
    await recordShareVisit(id, visit('aa', 'n1', { country: 'IE' }));
    // A data request from someone never seen opening a page adds no one.
    await recordShareVisit(id, visit('bb', 'n1', { open: false }));
    const [only, ...rest] = await rows(id);
    expect(rest).toHaveLength(0);
    expect(only).toMatchObject({ opens: 2, requests: 3, agent: 'Chrome · Windows', country: 'IE' });
    expect(only.lastSeen.getTime()).toBeGreaterThanOrEqual(only.firstSeen.getTime());
  });

  it('counts people, not previewers, and numbers browsers and networks in the order they came', async () => {
    const id = await link('b');
    await recordShareVisit(id, visit('pv', 'n9', { agent: 'Preview · WhatsApp', country: 'US' }));
    await recordShareVisit(id, visit('aa', 'n1'));
    await recordShareVisit(id, visit('bb', 'n2', { agent: 'Safari · iPhone', country: 'IE' }));
    // The first browser again, from a second network: one browser, a new network.
    await recordShareVisit(id, visit('aa', 'n3'));
    await recordShareVisit(id, visit('cc', '', { agent: 'Firefox · macOS', country: null }));
    const other = await link('c');

    // A use count of 0, so the headline is the people's own opens, the preview left out.
    const stats = await shareVisitStats(KEY, [
      { id, useCount: 0 },
      { id: other, useCount: 4 },
    ]);
    const s = stats.get(id)!;
    expect(s).toMatchObject({ opens: 4, browsers: 3, networks: 3, countries: ['GB', 'IE'], likelyForwarded: true, hidden: 0 });
    const seen = s.visitors.map((v) => `${v.browser ?? '-'}${v.network ?? '-'} ${v.agent}`);
    expect(seen).toEqual(['3- Firefox · macOS', '1C Chrome · Windows', '2B Safari · iPhone', '1A Chrome · Windows', '-- Preview · WhatsApp']);
    expect(stats.get(other)).toMatchObject({ opens: 4, browsers: 0, visitors: [] });
  });

  it('stops adding visitors at the cap but still counts the ones it has', async () => {
    const id = await link('d');
    await db.insert(projectShareVisits).values(
      Array.from({ length: VISITOR_ROW_CAP }, (_, i) => ({ shareId: id, visitorHash: `cap-${i}-`.padEnd(32, '0'), opens: 1, requests: 1 })),
    );
    await recordShareVisit(id, visit('new', 'n1'));
    await recordShareVisit(id, { ...visit('x', ''), visitorHash: 'cap-7-'.padEnd(32, '0') });
    const all = await rows(id);
    expect(all).toHaveLength(VISITOR_ROW_CAP);
    expect(all.find((r) => r.visitorHash === 'cap-7-'.padEnd(32, '0'))).toMatchObject({ opens: 2, requests: 2 });
    const s = (await shareVisitStats(KEY, [{ id, useCount: 0 }])).get(id)!;
    expect(s.visitors).toHaveLength(50);
    expect(s.hidden).toBe(VISITOR_ROW_CAP - 50);
  });

  it('goes with its link', async () => {
    const id = await link('e');
    await recordShareVisit(id, visit('aa', 'n1'));
    await db.delete(projectShares).where(eq(projectShares.id, id));
    expect(await rows(id)).toHaveLength(0);
  });
});

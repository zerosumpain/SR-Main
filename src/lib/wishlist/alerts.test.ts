import { describe, expect, it } from 'vitest';
import { eventFor, mergeOffer, summarise } from './alerts';
import { validateCompiled } from './compile';
import { isDue } from './due';
import type { Candidate, WishItem } from './types';

const NOW = new Date('2026-11-05T12:00:00Z');

function item(over: Partial<WishItem> = {}): WishItem {
  return {
    id: 'w_test', principalId: 'owner', kind: 'hunt', status: 'watching', title: 'Gaming PC', ask: 'a gaming pc',
    criteria: { maxPricePence: 110_000, nearMissPct: 10, constraints: [{ field: 'gpu', op: 'rank_gte', value: 'RTX 5060' }] },
    feeds: [{ source: 'hukd-tag', value: 'gaming-pc' }], urls: [], targetPricePence: null, forPerson: null, deadline: null,
    createdAt: NOW.toISOString(), lastCheckedAt: null, lastError: null, ...over,
  };
}

const cand = (pricePence: number, over: Partial<Candidate> = {}): Candidate & { pricePence: number } => ({
  source: 'hukd', title: 'PC RTX 5070 32GB DDR5', description: '', url: 'https://www.hotukdeals.com/deals/a-1', merchant: 'Amazon', inStock: null, ...over, pricePence,
});

describe('hunt alerts', () => {
  it('alerts once on a new match, then only when it gets cheaper', () => {
    const it0 = item();
    const first = mergeOffer(it0, null, cand(105_000), NOW);
    expect(eventFor(it0, null, first, NOW.toISOString(), NOW)?.kind).toBe('found');

    const stored = { ...first, alertedPence: 105_000 };
    const same = mergeOffer(it0, stored, cand(105_000), NOW);
    expect(eventFor(it0, stored, same, null, NOW)).toBeNull();

    const cheaper = mergeOffer(it0, stored, cand(99_000), NOW);
    expect(eventFor(it0, stored, cheaper, null, NOW)?.kind).toBe('cheaper');
  });

  it('stays quiet about a deal posted weeks ago on first sight', () => {
    const it0 = item();
    const o = mergeOffer(it0, null, cand(105_000), NOW);
    expect(eventFor(it0, null, o, '2026-10-01T00:00:00Z', NOW)).toBeNull();
  });

  it('folds many finds into one message, best first', () => {
    const it0 = item();
    const events = [cand(108_000, { url: 'u1' }), cand(99_000, { url: 'u2' }), cand(104_000, { url: 'u3' }), cand(101_000, { url: 'u4' })]
      .map((c) => mergeOffer(it0, null, c, NOW))
      .map((o) => eventFor(it0, null, o, null, NOW)!);
    const msg = summarise(it0, events)!;
    expect(msg.body.split('\n')[0]).toContain('£990');
    expect(msg.body).toContain('…and 1 more');
  });
});

describe('tracked alerts', () => {
  it('takes the first read as the baseline and alerts on a 5% drop', () => {
    const it0 = item({ kind: 'track', urls: ['https://www.pricerunner.com/pl/1-2/x'], criteria: { maxPricePence: null, nearMissPct: 10, constraints: [] } });
    const base = mergeOffer(it0, null, cand(10_000, { source: 'pricerunner' }), NOW);
    expect(eventFor(it0, null, base, null, NOW)).toBeNull();
    const down = mergeOffer(it0, base, cand(9_400, { source: 'pricerunner' }), NOW);
    expect(eventFor(it0, base, down, null, NOW)?.kind).toBe('drop');
    expect(down.history.map((h) => h.pence)).toEqual([10_000, 9_400]);
  });

  it('alerts on reaching the target', () => {
    const it0 = item({ kind: 'track', targetPricePence: 9_800, criteria: { maxPricePence: null, nearMissPct: 10, constraints: [] } });
    const base = mergeOffer(it0, null, cand(10_000), NOW);
    const at = mergeOffer(it0, base, cand(9_790), NOW);
    expect(eventFor(it0, base, at, null, NOW)?.kind).toBe('target');
  });
});

describe('compile validation', () => {
  it('keeps what fits the vocabulary and says what it dropped', () => {
    const c = validateCompiled(
      {
        kind: 'hunt', title: 'Gaming PC', maxPricePounds: 1100,
        constraints: [{ field: 'gpu', value: 'GeForce RTX 5060' }, { field: 'ram_gb', value: 16 }, { field: 'ram_type', value: ['ddr5'] }, { field: 'colour', value: 'red' }, { field: 'gpu', value: 'Voodoo 2' }],
        hukdTags: ['gaming-pc', '../etc'], pricerunnerCategories: ['223/Desktop-Computers'], searchQuery: 'prebuilt gaming pc rtx 5060 ddr5',
        deadline: '2026-12-20',
      },
      'gaming pc',
    );
    expect(c.criteria.maxPricePence).toBe(110_000);
    expect(c.criteria.constraints).toEqual([
      { field: 'gpu', op: 'rank_gte', value: 'RTX 5060' },
      { field: 'ram_gb', op: 'gte', value: 16 },
      { field: 'ram_type', op: 'in', value: ['DDR5'] },
    ]);
    expect(c.feeds.map((f) => f.source)).toEqual(['hukd-tag', 'pricerunner-cl', 'tavily']);
    expect(c.dropped.join(' ')).toMatch(/colour.*Voodoo.*\.\.\/etc/);
  });

  it('turns a track with no usable URL into a hunt, and never keeps a disallowed PriceRunner URL', () => {
    const c = validateCompiled({ kind: 'track', urls: ['https://www.pricerunner.com/results?q=x', 'http://insecure.example/p'] }, 'x');
    expect(c.kind).toBe('hunt');
  });
});

describe('due', () => {
  it('checks hunts six-hourly, hourly in Black Friday week, and never past the deadline', () => {
    const it0 = item({ lastCheckedAt: '2026-11-05T09:00:00Z' });
    expect(isDue(it0, NOW)).toBe(false);
    expect(isDue({ ...it0, lastCheckedAt: '2026-11-05T05:00:00Z' }, NOW)).toBe(true);
    expect(isDue({ ...it0, lastCheckedAt: '2026-11-25T10:30:00Z' }, new Date('2026-11-25T11:30:00Z'))).toBe(true);
    expect(isDue({ ...it0, deadline: '2026-11-01' }, NOW)).toBe(false);
  });
});

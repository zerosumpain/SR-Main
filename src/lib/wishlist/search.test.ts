import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/deepdive/web-search', () => ({ search: vi.fn() }));
import { SEARCHES_PER_DAY, searchesAllowed } from './due';
import { extractPriceMeta, isReadableResult, listingsFromPage, nextQueries, searchQueries } from './sources/search';
import { parseShopifyProducts, shopifyJsonUrl } from './sources/shopify';
import { searchTheWeb } from './sources/search.server';
import type { WishItem } from './types';

vi.mock('./sources/fetch.server', () => ({ fetchPageScripts: vi.fn() }));

const hunt = (over: Partial<WishItem> = {}): WishItem => ({
  id: 'w1', principalId: 'owner', kind: 'hunt', status: 'watching', title: 'Gaming PC', ask: 'gaming pc',
  criteria: { maxPricePence: 110_000, nearMissPct: 10, constraints: [] },
  feeds: [
    { source: 'hukd-tag', value: 'gaming-pc' },
    { source: 'search', value: 'q1' },
    { source: 'search', value: 'q2' },
    { source: 'search', value: 'q3' },
  ],
  urls: [], targetPricePence: null, forPerson: null, deadline: null,
  createdAt: '2026-11-01T00:00:00Z', lastCheckedAt: null, lastError: null,
  ...over,
});

/** A day of checks at these UTC times: the searches each was allowed. */
function day(times: string[], item = hunt()): number[] {
  return times.map((t) => {
    const now = new Date(`2026-11-03T${t}:00Z`);
    const n = searchesAllowed(item, now);
    const today = now.toISOString().slice(0, 10);
    const before = item.searches?.day === today ? item.searches.count : 0;
    item.searches = { day: today, count: before + n, cursor: 0 };
    return n;
  });
}

describe('web search allowance', () => {
  it('spends exactly five a day across a six-hourly hunt, never at once', () => {
    const spent = day(['03:00', '09:00', '15:00', '21:00']);
    expect(spent.reduce((a, b) => a + b)).toBe(SEARCHES_PER_DAY);
    expect(Math.max(...spent)).toBeLessThanOrEqual(2);
  });

  it('paces an hourly sale-season hunt instead of spending the five by breakfast', () => {
    const item = hunt();
    const spent = Array.from({ length: 24 }, (_, h) => {
      const now = new Date(`2026-11-22T${String(h).padStart(2, '0')}:00:00Z`);
      const n = searchesAllowed(item, now);
      item.searches = { day: '2026-11-22', count: (item.searches?.count ?? 0) + n, cursor: 0 };
      return n;
    });
    expect(spent.reduce((a, b) => a + b)).toBe(SEARCHES_PER_DAY);
    expect(spent.slice(0, 6).reduce((a, b) => a + b)).toBeLessThanOrEqual(2);
  });

  it('starts afresh on a new day', () => {
    const item = hunt({ searches: { day: '2026-11-02', count: 5, cursor: 5 } });
    expect(searchesAllowed(item, new Date('2026-11-02T23:00:00Z'))).toBe(0);
    expect(searchesAllowed(item, new Date('2026-11-03T03:00:00Z'))).toBeGreaterThan(0);
  });
});

describe('queries and results', () => {
  it('reads the legacy one-a-day PriceRunner feed as a query, and rotates', () => {
    expect(searchQueries([{ source: 'tavily', value: 'old' }, { source: 'search', value: 'new' }])).toEqual(['old', 'new']);
    expect(nextQueries({ searches: { day: 'd', count: 0, cursor: 2 } }, ['a', 'b', 'c'], 2)).toEqual(['c', 'a']);
  });

  it('opens only pages worth a scrape', () => {
    expect(isReadableResult('https://www.overclockers.co.uk/some-pc')).toBe(true);
    expect(isReadableResult('https://www.pricerunner.com/pl/1-2/Desktop/Some-PC')).toBe(true);
    expect(isReadableResult('https://www.pricerunner.com/results?q=pc')).toBe(false);
    expect(isReadableResult('https://www.currys.co.uk/products/x')).toBe(false);
    expect(isReadableResult('https://www.amazon.co.uk/dp/B0X')).toBe(false);
    expect(isReadableResult('http://shop.example/p')).toBe(false);
  });
});

// Shaped like LaptopsDirect's RTX 5060 page (2026-11-01): a CollectionPage whose
// ItemList holds Products with relative URLs.
const COLLECTION = JSON.stringify({
  '@type': 'CollectionPage',
  name: 'RTX 5060 PC Deals',
  mainEntity: {
    '@type': 'ItemList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, item: { '@type': 'Product', name: 'Medion ERAZER RTX 5060 32GB', url: '/medion-erazer/version.asp', offers: { '@type': 'Offer', price: 1089.97, priceCurrency: 'GBP' } } },
      { '@type': 'ListItem', position: 2, item: { '@type': 'Product', name: 'No price PC', url: '/x.asp' } },
      { '@type': 'ListItem', position: 3, item: { '@type': 'Product', name: 'Elsewhere PC', url: 'https://other.example/p', offers: { price: 900, priceCurrency: 'GBP' } } },
      { '@type': 'ListItem', position: 4, item: { '@type': 'Product', name: 'Dollar PC', url: '/usd', offers: { price: 900, priceCurrency: 'USD' } } },
    ],
  },
});

const PRODUCT = JSON.stringify({
  '@type': 'Product',
  name: 'CyberPowerPC RTX 5060',
  offers: {
    '@type': 'AggregateOffer', lowPrice: 949.99, priceCurrency: 'GBP',
    offers: [
      { price: 999, priceCurrency: 'GBP', seller: { name: 'Box' }, availability: 'https://schema.org/InStock' },
      { price: 949.99, priceCurrency: 'GBP', seller: { name: 'Very' }, availability: 'https://schema.org/InStock' },
    ],
  },
});

describe('listingsFromPage', () => {
  it('takes every priced product on a category page, on that site, in pounds', () => {
    const out = listingsFromPage({ payload: null, ld: ['{bad', COLLECTION] }, 'https://www.laptopsdirect.co.uk/ct/pcs/geforce-rtx-5060');
    expect(out).toEqual([
      expect.objectContaining({ title: 'Medion ERAZER RTX 5060 32GB', url: 'https://www.laptopsdirect.co.uk/medion-erazer/version.asp', pricePence: 108_997, merchant: 'laptopsdirect.co.uk', source: 'retailer' }),
    ]);
  });

  it('keeps a single product page’s sellers', () => {
    const [p] = listingsFromPage({ payload: null, ld: [PRODUCT] }, 'https://www.pricerunner.com/pl/1-2/Desktops/CyberPowerPC');
    expect(p).toMatchObject({ source: 'pricerunner', pricePence: 94_999, merchant: 'Very', url: 'https://www.pricerunner.com/pl/1-2/Desktops/CyberPowerPC' });
    expect(p.sellers?.map((s) => s.merchant)).toEqual(['Very', 'Box']);
  });

  it('reads nothing from a page without priced products', () => {
    expect(listingsFromPage({ payload: null, ld: ['{"@type":"Organization","name":"x"}'] }, 'https://shop.example/')).toEqual([]);
  });
});

describe('meta price tags', () => {
  it('reads Open Graph / product tags in either attribute order, and microdata', () => {
    expect(extractPriceMeta(`<meta content="1,339.00" property="og:price:amount"><meta property='og:price:currency' content='GBP'><meta property="og:title" content="ZeroLag RTX 5060">`))
      .toEqual({ amount: '1,339.00', currency: 'GBP', title: 'ZeroLag RTX 5060', description: null });
    expect(extractPriceMeta('<meta itemprop="price" content="1099.99" /><meta itemprop="priceCurrency" content="GBP">')).toEqual({ amount: '1099.99', currency: 'GBP', title: null, description: null });
    expect(extractPriceMeta('<meta name="description" content="x">')).toBeNull();
    // AWD-IT spells every space as an entity (2026-11-01).
    expect(extractPriceMeta('<meta property="og:title" content="AWD-IT&#x20;M120R&#x20;RTX&#x20;5060&#x20;Ti &amp; more"><meta property="og:description" content="16GB&#32;DDR5"><meta property="product:price:amount" content="1099.99"/>'))
      .toEqual({ amount: '1099.99', currency: null, title: 'AWD-IT M120R RTX 5060 Ti & more', description: '16GB DDR5' });
  });

  it('becomes one listing when the JSON-LD has none — in pounds only', () => {
    const meta = { amount: '1,339.00', currency: 'GBP', title: 'ZeroLag RTX 5060 16GB DDR5' };
    expect(listingsFromPage({ payload: null, ld: [], meta }, 'https://www.zerolaguk.com/products/zl')).toEqual([
      expect.objectContaining({ title: 'ZeroLag RTX 5060 16GB DDR5', pricePence: 133_900, url: 'https://www.zerolaguk.com/products/zl', merchant: 'zerolaguk.com' }),
    ]);
    expect(listingsFromPage({ payload: null, ld: [], meta: { ...meta, currency: 'USD' } }, 'https://shop.example/p')).toEqual([]);
    expect(listingsFromPage({ payload: null, ld: [], meta: { ...meta, currency: null } }, 'https://shop.example/p')).toEqual([]);
  });
});

describe('Shopify', () => {
  it('turns a collection or product URL into its JSON endpoint, and nothing else', () => {
    expect(shopifyJsonUrl('https://pcgamingcases.co.uk/collections/5060-ti-builds')).toBe('https://pcgamingcases.co.uk/collections/5060-ti-builds/products.json?limit=250');
    expect(shopifyJsonUrl('https://directcomputers.co.uk/collections/dcg-gaming-pcs/products/dcg-atlas')).toBe('https://directcomputers.co.uk/products/dcg-atlas.json');
    expect(shopifyJsonUrl('https://www.zerolaguk.com/products/zerolag-gaming-pc?variant=1')).toBe('https://www.zerolaguk.com/products/zerolag-gaming-pc.json');
    expect(shopifyJsonUrl('https://www.laptopsdirect.co.uk/ct/pcs/geforce-rtx-5060')).toBeNull();
  });

  // Shaped like pcgamingcases.co.uk and zerolaguk.com's JSON, 2026-11-01.
  it('prices each product at its cheapest variant, with the description as text', () => {
    const json = JSON.stringify({
      products: [
        { title: 'IONZ Gaming PC RTX 5060 Ti 32GB DDR5', handle: 'ionz-g1', body_html: '<h2>IONZ &amp; <b>RTX 5060 Ti</b></h2><script>x()</script>', variants: [{ price: '1379.95', available: true }] },
        { title: 'ZeroLag RTX 5060', handle: 'zerolag', body_html: '', variants: [{ price: '1395.00', available: false }, { price: '1339.00', available: false }] },
        { title: 'Bad handle', handle: '../x', variants: [{ price: '1' }] },
        { title: 'No price', handle: 'free', variants: [{ price: '0.00' }] },
      ],
    });
    expect(parseShopifyProducts(json, 'https://pcgamingcases.co.uk')).toEqual([
      expect.objectContaining({ title: 'IONZ Gaming PC RTX 5060 Ti 32GB DDR5', url: 'https://pcgamingcases.co.uk/products/ionz-g1', pricePence: 137_995, inStock: true, description: 'IONZ & RTX 5060 Ti' }),
      expect.objectContaining({ title: 'ZeroLag RTX 5060', pricePence: 133_900, inStock: false }),
    ]);
    expect(parseShopifyProducts(JSON.stringify({ product: { title: 'One', handle: 'one', variants: [{ price: '10' }] } }), 'https://s.example')).toHaveLength(1);
    expect(parseShopifyProducts('<html>', 'https://s.example')).toEqual([]);
  });
});

describe('searchTheWeb', () => {
  const ld = (name: string) => JSON.stringify({ '@type': 'Product', name, offers: { price: 999, priceCurrency: 'GBP' } });

  it('runs this check’s share, records it on the item, and skips unreadable results', async () => {
    const item = hunt();
    const search = vi.fn(async (q: string, _opts?: unknown) => ({
      query: q,
      results: [
        { title: '', url: `https://shop.example/${q}`, content: '', score: 1 },
        { title: '', url: 'https://www.currys.co.uk/x', content: '', score: 1 },
        { title: '', url: 'https://shop.example/blocked', content: '', score: 1 },
      ],
    }));
    const fetchPage = vi.fn(async (u: string) => {
      if (u.endsWith('blocked')) throw new Error('blocked (captcha)');
      return { payload: null, ld: [ld(u)], meta: null, via: 'direct' as const };
    });
    const now = new Date('2026-11-02T03:00:00Z');
    const run = await searchTheWeb(item, now, { search: search as never, fetchPage, fetchText: async () => null });
    expect(run.searched).toBe(2);
    expect(search.mock.calls.map((c) => c[0])).toEqual(['q1', 'q2']);
    expect(search.mock.calls[0][1]).toMatchObject({ purpose: 'wishlist' });
    expect(search.mock.calls[0][1]).not.toHaveProperty('includeDomains');
    expect(search.mock.calls[0][1]).toMatchObject({ maxResults: 20 });
    // Currys is never opened; `blocked` is opened once (by the first search) and fails quietly.
    expect(fetchPage.mock.calls.map((c) => c[0])).toEqual(['https://shop.example/q1', 'https://shop.example/blocked', 'https://shop.example/q2']);
    expect(run.candidates.map((c) => c.url)).toEqual(['https://shop.example/q1', 'https://shop.example/q2']);
    expect(run.errors).toEqual([]);
    expect(item.searches).toEqual({ day: '2026-11-02', count: 2, cursor: 2 });

    // The next check carries on the rotation.
    search.mockClear();
    await searchTheWeb(item, new Date('2026-11-02T09:00:00Z'), { search: search as never, fetchPage, fetchText: async () => null });
    expect(search.mock.calls[0]?.[0]).toBe('q3');
  });

  it('counts a failed search against the day and reports it', async () => {
    const item = hunt({ feeds: [{ source: 'search', value: 'q1' }] });
    const run = await searchTheWeb(item, new Date('2026-11-02T03:00:00Z'), {
      search: (async () => { throw new Error('402 plan'); }) as never,
      fetchPage: vi.fn(),
    });
    expect(run.errors[0]).toMatch(/search "q1": 402 plan/);
    expect(item.searches?.count).toBe(1);
  });

  it('reads a Shopify shop from its JSON when it prices in pounds, and lets only the top results use the scraper', async () => {
    const item = hunt({ feeds: [{ source: 'search', value: 'q1' }] });
    const urls = ['https://pcgamingcases.co.uk/collections/5060-ti-builds', ...Array.from({ length: 6 }, (_, i) => `https://shop${i}.example/p`)];
    const search = vi.fn(async () => ({ query: 'q1', results: urls.map((url) => ({ title: '', url, content: '', score: 1 })) }));
    const fetchText = vi.fn(async (u: string) => {
      if (u.endsWith('/cart.js')) return '{"currency":"GBP"}';
      if (u.includes('products.json')) return JSON.stringify({ products: [{ title: 'IONZ RTX 5060 Ti', handle: 'ionz', variants: [{ price: '1379.95', available: true }] }] });
      return null;
    });
    const fetchPage = vi.fn(async (_url: string, _opts: { residential?: boolean }) => ({ payload: null, ld: [], meta: null, via: 'direct' as const }));
    const run = await searchTheWeb(item, new Date('2026-11-02T03:00:00Z'), { search: search as never, fetchPage, fetchText });
    expect(run.candidates.map((c) => c.url)).toEqual(['https://pcgamingcases.co.uk/products/ionz']);
    // The Shopify result never needed its page; of the rest, results 2-4 may scrape, 5-7 may not.
    expect(fetchPage.mock.calls.map((c) => [c[0], c[1]])).toEqual(
      urls.slice(1).map((u, i) => [u, { residential: i + 1 < 4 }]),
    );
  });

  it('ignores a Shopify shop that prices in another currency', async () => {
    const item = hunt({ feeds: [{ source: 'search', value: 'q1' }] });
    const run = await searchTheWeb(item, new Date('2026-11-02T03:00:00Z'), {
      search: (async () => ({ query: 'q1', results: [{ title: '', url: 'https://us.example/products/pc', content: '', score: 1 }] })) as never,
      fetchText: async (u: string) => (u.endsWith('/cart.js') ? '{"currency":"USD"}' : JSON.stringify({ product: { title: 'PC', handle: 'pc', variants: [{ price: '999' }] } })),
      fetchPage: async () => ({ payload: null, ld: [], meta: null, via: 'direct' as const }),
    });
    expect(run.candidates).toEqual([]);
  });
});

import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/scraper/runner', () => ({ runScrape: vi.fn() }));
import { fetchPageScripts } from './sources/fetch.server';

const LD = '{"@type":"Product","name":"x"}';
const page = `<html><script type="application/ld+json">${LD}</script></html>`;

describe('fetchPageScripts', () => {
  it('uses the plain fetch when it gets the page', async () => {
    const scrape = vi.fn();
    const out = await fetchPageScripts('https://www.pricerunner.com/pl/1-2/x', {
      fetchFn: (async () => new Response(page, { status: 200 })) as typeof fetch,
      scrape,
    });
    expect(out).toEqual({ payload: null, ld: [LD], meta: null, via: 'direct' });
    expect(scrape).not.toHaveBeenCalled();
  });

  it('falls back to the residential scraper on the VPS 202, and retries a cookie-banner false alarm once', async () => {
    const scrape = vi
      .fn()
      .mockResolvedValueOnce({ success: false, pages: [], needsInteractive: true, challengeReason: 'cookie-consent' })
      .mockResolvedValueOnce({ success: true, pages: [{ url: 'u', fields: { payload: '{"a":1}', ld: [LD] } }] });
    const out = await fetchPageScripts('https://www.pricerunner.com/cl/223/Desktop-Computers', {
      fetchFn: (async () => new Response('', { status: 202 })) as typeof fetch,
      scrape,
    });
    expect(scrape).toHaveBeenCalledTimes(2);
    expect(out).toEqual({ payload: '{"a":1}', ld: [LD], meta: null, via: 'residential' });
  });

  it('says it was blocked when the retry is blocked too', async () => {
    const blocked = { success: false, pages: [], needsInteractive: true, challengeReason: 'captcha' };
    await expect(
      fetchPageScripts('https://www.pricerunner.com/cl/223/Desktop-Computers', {
        fetchFn: (async () => new Response('', { status: 403 })) as typeof fetch,
        scrape: vi.fn().mockResolvedValue(blocked),
      }),
    ).rejects.toThrow('blocked (captcha)');
  });

  it('reads a page whose only price is in its meta tags, without a scrape', async () => {
    const scrape = vi.fn();
    const html = '<html><head><meta property="product:price:amount" content="1099.99"/><meta property="product:price:currency" content="GBP"/><meta property="og:title" content="AWD-IT RTX 5060 Ti PC"/></head></html>';
    const out = await fetchPageScripts('https://www.awd-it.co.uk/pc.html', { fetchFn: (async () => new Response(html, { status: 200 })) as typeof fetch, scrape });
    expect(out.meta).toEqual({ amount: '1099.99', currency: 'GBP', title: 'AWD-IT RTX 5060 Ti PC', description: null });
    expect(scrape).not.toHaveBeenCalled();
  });

  it('gives up without a residential scrape when told to', async () => {
    const scrape = vi.fn();
    await expect(
      fetchPageScripts('https://shop.example/p', { fetchFn: (async () => new Response('', { status: 403 })) as typeof fetch, scrape }, { residential: false }),
    ).rejects.toThrow('directly');
    expect(scrape).not.toHaveBeenCalled();
  });
});

import { describe, expect, it } from 'vitest';
import { parseHukdFeed } from './sources/hukd';
import { isAllowedPricerunnerUrl, parseCategoryPayload, parseProductLd } from './sources/pricerunner';

// Trimmed from the real hotukdeals gaming-pc tag feed, 2026-10-31.
const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:media="http://search.yahoo.com/mrss/" xmlns:pepper="http://www.pepper.com/rss" version="2.0"><channel><title>hotukdeals</title>
<item><category><![CDATA[Electronics]]></category><pepper:merchant name="Amazon" price="£1,299"/><title><![CDATA[Gaming PC - Liquid Cooling, 650W PSU, 32GB DDR5 RAM, Nvidia RTX 5060 Ti, 1TB NVMe SSD, AMD Ryzen 7 9700X]]></title><description><![CDATA[<strong>£1,299 - Amazon</strong><br /><img src="https://images.hotukdeals.com/x.jpg"/><p>Best price for good pre build</p>]]></description><link>https://www.hotukdeals.com/deals/gaming-pc-5017478</link><pubDate>Thu, 29 Oct 2026 21:04:23 +0000</pubDate></item>
<item><pepper:merchant name="AWD-IT" price="£1,249.99"/><title><![CDATA[AWD-IT Erebus AMD Ryzen 7, NVIDIA RTX 5060 Ti 8GB, 32GB RAM & 1TB SSD]]></title><description><![CDATA[<strong>£1,249.99 - AWD-IT</strong>]]></description><link>https://www.hotukdeals.com/deals/awd-it-erebus-5015672</link><pubDate>Wed, 28 Oct 2026 01:34:31 +0000</pubDate></item>
<item><title><![CDATA[Elsewhere]]></title><description><![CDATA[£10]]></description><link>https://evil.example/deal</link><pubDate>Wed, 28 Oct 2026 01:34:31 +0000</pubDate></item>
</channel></rss>`;

describe('hotukdeals feed', () => {
  it('reads price and merchant from pepper:merchant and flattens the description', async () => {
    const out = await parseHukdFeed(FEED);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ source: 'hukd', merchant: 'Amazon', pricePence: 129_900, postedAt: '2026-10-29T21:04:23.000Z' });
    expect(out[0].description).toMatch(/^£1,299 - Amazon Best price/);
    expect(out[0].description).not.toContain('<');
    expect(out[1].pricePence).toBe(124_999);
  });

  it('drops an item whose link leaves hotukdeals', async () => {
    expect((await parseHukdFeed(FEED)).some((c) => c.url.includes('evil'))).toBe(false);
  });

  it('refuses a DOCTYPE', async () => {
    await expect(parseHukdFeed('<!DOCTYPE x><rss></rss>')).rejects.toThrow();
  });
});

describe('PriceRunner', () => {
  it('reads only what robots.txt allows', () => {
    expect(isAllowedPricerunnerUrl('https://www.pricerunner.com/pl/223-3481594445/Desktop-Computers/Stormforce-Recoil-Compare-Prices')).toBe(true);
    expect(isAllowedPricerunnerUrl('https://www.pricerunner.com/cl/223/Desktop-Computers')).toBe(true);
    expect(isAllowedPricerunnerUrl('https://www.pricerunner.com/results?q=rtx')).toBe(false);
    expect(isAllowedPricerunnerUrl('https://www.pricerunner.com/pl/223-1/x?p=2')).toBe(false);
    expect(isAllowedPricerunnerUrl('https://evil.example/pl/223-1/x')).toBe(false);
  });

  it('finds products anywhere in a category payload', () => {
    const payload = JSON.stringify({
      queries: [{ state: { data: { pages: [{ products: [
        { id: '1', name: 'Stormforce Recoil Ryzen 5 16GB 1TB RTX 5060 Gaming PC', url: '/pl/223-3481594445/Desktop-Computers/Stormforce-Recoil', description: 'AMD Ryzen 5, 16 GB RAM, GeForce RTX 5060', lowestPrice: { amount: '1099.00', currency: 'GBP' } },
        { id: '2', name: 'Euro thing', url: '/pl/223-2/x', lowestPrice: { amount: '5.00', currency: 'EUR' } },
      ] }] } } }],
    });
    const out = parseCategoryPayload(payload);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ source: 'pricerunner', pricePence: 109_900, url: 'https://www.pricerunner.com/pl/223-3481594445/Desktop-Computers/Stormforce-Recoil' });
  });

  it('reads every seller from a product page AggregateOffer', () => {
    const ld = JSON.stringify({
      '@context': 'https://schema.org', '@type': 'Product', name: 'Stormforce Recoil Ryzen 5 16GB 1TB RTX 5060 Gaming PC', description: 'AMD Ryzen 5, 16 GB RAM, GeForce RTX 5060',
      offers: { '@type': 'AggregateOffer', lowPrice: '999.00', highPrice: '1099.99', priceCurrency: 'GBP', offers: [
        { '@type': 'Offer', price: '1099.99', priceCurrency: 'GBP', availability: 'https://schema.org/InStock', seller: { name: 'Joybuy' } },
        { '@type': 'Offer', price: '999.00', priceCurrency: 'GBP', availability: 'https://schema.org/InStock', seller: { name: 'Argos' } },
        { '@type': 'Offer', price: '1049.00', priceCurrency: 'GBP', availability: 'https://schema.org/OutOfStock', seller: { name: 'Currys' } },
      ] },
    });
    const crumbs = JSON.stringify({ '@type': 'BreadcrumbList' });
    const p = parseProductLd([crumbs, ld]);
    expect(p?.lowPence).toBe(99_900);
    expect(p?.offers.map((o) => o.merchant)).toEqual(['Argos', 'Currys', 'Joybuy']);
    expect(p?.offers[1].inStock).toBe(false);
  });
});

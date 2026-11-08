import { describe, expect, it } from 'vitest';
import { isOcukCategory, parseOcukItemList } from './sources/ocuk';
import { isScanCategory, parseScanList, parseScanProduct } from './sources/scan';
import { parseRedditAtom } from './sources/reddit';
import { validateCompiled } from './compile';

// The first three products of the real Overclockers gaming-pcs ItemList, 2026-10-31.
const OCUK = JSON.stringify({
  "@context": "https://schema.org/",
  "@type": "ItemList",
  "itemListElement": [
    {
      "@type": "ListItem",
      "position": 1,
      "item": {
        "@type": "Product",
        "name": "OcUK Gaming Halo - Ryzen 9 9950X3D RTX 5090 Powered by MSI Pre-Built Gaming PC",
        "url": "https://www.overclockers.co.uk/ocuk-gaming-halo-ryzen-9-9950x3d-rtx-5090-powered-by-msi-pre-built-gaming-pc/FS-MSIHALO-EP.html",
        "description": "Pre-built gaming PC Powered by MSI, AMD Ryzen 9 9950X3D CPU, NVIDIA GeForce RTX 5090 GPU, 96GB DDR5 RAM, 4TB PCIe 5.0 SSD",
        "sku": "FS-MSIHALO-EP",
        "brand": {
          "@type": "Brand",
          "name": "OCUK"
        },
        "offers": {
          "@type": "Offer",
          "priceCurrency": "GBP",
          "price": 10499.99,
          "availability": "https://schema.org/InStock",
          "url": "https://www.overclockers.co.uk/ocuk-gaming-halo-ryzen-9-9950x3d-rtx-5090-powered-by-msi-pre-built-gaming-pc/FS-MSIHALO-EP.html"
        }
      }
    },
    {
      "@type": "ListItem",
      "position": 2,
      "item": {
        "@type": "Product",
        "name": "OcUK Gaming Mach 6 - Ryzen 9800X3D, RTX 5080 Pre-Built Gaming PC",
        "url": "https://www.overclockers.co.uk/ocuk-gaming-mach-6-ryzen-9800x3d-rtx-5080-pre-built-gaming-pc/FS-PB08-EP.html",
        "description": "1440p and 4K gaming PC, Perfect for cinematic games like God of War: Ragnarök, NVIDIA GeForce RTX 5080 GPU, Pre-built and ready to ship, 32GB RAM, Three years parts and labour warranty",
        "sku": "FS-PB08-EP",
        "brand": {
          "@type": "Brand",
          "name": "OCUK"
        },
        "aggregateRating": {
          "@type": "AggregateRating",
          "ratingValue": 5,
          "reviewCount": 21
        },
        "offers": {
          "@type": "Offer",
          "priceCurrency": "GBP",
          "price": 3199.99,
          "availability": "https://schema.org/InStock",
          "url": "https://www.overclockers.co.uk/ocuk-gaming-mach-6-ryzen-9800x3d-rtx-5080-pre-built-gaming-pc/FS-PB08-EP.html"
        }
      }
    },
    {
      "@type": "ListItem",
      "position": 3,
      "item": {
        "@type": "Product",
        "name": "OcUK Gaming Mach 1.1 - Ryzen 5600 RTX 5060 Pre-Built Gaming PC",
        "url": "https://www.overclockers.co.uk/ocuk-gaming-mach-1.1-ryzen-5600-rtx-5060-pre-built-gaming-pc/FS-PB14-EP.html",
        "description": "Value 1080p gaming PC, Perfect for high-octane games like Rocket League, NVIDIA GeForce RTX 5060 GPU, Pre-built and ready to ship, 16GB RAM, Three years parts and labour warranty",
        "sku": "FS-PB14-EP",
        "brand": {
          "@type": "Brand",
          "name": "OCUK"
        },
        "aggregateRating": {
          "@type": "AggregateRating",
          "ratingValue": 4.733333333333333,
          "reviewCount": 24
        },
        "offers": {
          "@type": "Offer",
          "priceCurrency": "GBP",
          "price": 1099.99,
          "availability": "https://schema.org/InStock",
          "url": "https://www.overclockers.co.uk/ocuk-gaming-mach-1.1-ryzen-5600-rtx-5060-pre-built-gaming-pc/FS-PB14-EP.html"
        }
      }
    }
  ]
});

describe('Overclockers', () => {
  it('reads every product in the category ItemList with price, stock and specs text', () => {
    const out = parseOcukItemList([JSON.stringify({ '@type': 'BreadcrumbList' }), OCUK]);
    expect(out).toHaveLength(3);
    expect(out[2]).toMatchObject({
      source: 'retailer',
      merchant: 'Overclockers UK',
      title: 'OcUK Gaming Mach 1.1 - Ryzen 5600 RTX 5060 Pre-Built Gaming PC',
      inStock: true,
    });
    expect(out[2].pricePence).toBeGreaterThan(0);
    expect(out[2].description).toContain('16GB RAM');
  });

  it('drops a product whose link leaves the shop', () => {
    const list = JSON.parse(OCUK);
    list.itemListElement[0].item.url = 'https://evil.example/x.html';
    expect(parseOcukItemList([JSON.stringify(list)])).toHaveLength(2);
  });

  it('only builds URLs from category-shaped paths under known roots', () => {
    expect(isOcukCategory('pc-systems/pcs-by-price/gaming-pcs-under-1000')).toBe(true);
    expect(isOcukCategory('search?q=x')).toBe(false);
    expect(isOcukCategory('../../etc')).toBe(false);
    expect(isOcukCategory('account/orders')).toBe(false);
  });
});

// One `li.product` inner HTML from Scan's NVIDIA list, trimmed, 2026-10-31.
const CARD = `<div><a href="/products/msi-nvidia-geforce-rtx-5060-ventus-2x-oc-8gb" class="image"><img src="x.jpg"></a><div class="wishlistheart" data-productcode="1" data-description="MSI NVIDIA GeForce RTX 5060 8GB VENTUS 2X OC" data-price="279.98"><button class="btn wishList"></button></div><span class="details"><span class="description"><a href="/products/msi-nvidia-geforce-rtx-5060-ventus-2x-oc-8gb"><span>MSI NVIDIA GeForce RTX 5060 VENTUS 2X OC 8GB GDDR7 Graphics Card, DLSS 4 &amp; more</span><span class="superList">x</span></a></span></span></div>`;

describe('Scan', () => {
  it('reads the link, the long title and the price from a product card', () => {
    expect(parseScanProduct(CARD)).toEqual({
      source: 'retailer',
      title: 'MSI NVIDIA GeForce RTX 5060 VENTUS 2X OC 8GB GDDR7 Graphics Card, DLSS 4 & more',
      description: '',
      url: 'https://www.scan.co.uk/products/msi-nvidia-geforce-rtx-5060-ventus-2x-oc-8gb',
      merchant: 'Scan',
      pricePence: 27_998,
      inStock: null,
    });
  });

  it('skips the 999999 placeholder Scan shows for no price', () => {
    expect(parseScanList([CARD, CARD.replace('279.98', '999999.00')])).toHaveLength(1);
  });

  it('allows only catalogued categories', () => {
    expect(isScanCategory('computer-hardware/gpu-nvidia/all')).toBe(true);
    expect(isScanCategory('computer-hardware/gpu-nvidia/all/../x')).toBe(false);
  });
});

const entry = (title: string, link: string) =>
  `<entry><author><name>/u/someone</name></author><content type="html">&lt;p&gt;Body text&lt;/p&gt;</content><link href="${link}" /><updated>2026-10-31T09:00:00+00:00</updated><title>${title}</title></entry>`;
const ATOM = `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>newest submissions : buildapcsalesuk</title>${[
  entry('ASUS PRIME RX9070 XT OC - £659.99 on Amazon UK', 'https://www.reddit.com/r/buildapcsalesuk/comments/1/a/'),
  entry('5070ti for £999 vs 9070 xt for £750. Which should I pick?', 'https://www.reddit.com/r/buildapcsalesuk/comments/2/b/'),
  entry('[WTB] Budget RTX 3050 6GB £100', 'https://www.reddit.com/r/buildapcsalesuk/comments/3/c/'),
  entry('Where to buy parts for PC UK', 'https://www.reddit.com/r/buildapcsalesuk/comments/4/d/'),
  entry('RTX 5070 - £450', 'https://evil.example/x'),
].join('')}</feed>`;

describe('Reddit', () => {
  it('keeps only offers: a priced title, not a question or a want-to-buy, on reddit.com', async () => {
    const out = await parseRedditAtom(ATOM);
    expect(out.map((c) => c.title)).toEqual(['ASUS PRIME RX9070 XT OC - £659.99 on Amazon UK']);
    expect(out[0]).toMatchObject({ source: 'reddit', pricePence: 65_999, postedAt: '2026-10-31T09:00:00.000Z', description: 'Body text' });
  });

  it('refuses a DOCTYPE', async () => {
    await expect(parseRedditAtom('<!DOCTYPE x><feed></feed>')).rejects.toThrow();
  });
});

describe('compile: the new sources', () => {
  it('keeps catalogued feeds and drops the rest, saying so', () => {
    const c = validateCompiled(
      {
        kind: 'hunt',
        overclockersCategories: ['/pc-systems/pcs-by-price/gaming-pcs-under-1000/', 'search?q=x'],
        scanCategories: ['computer-hardware/gpu-nvidia/all', 'made/up/all'],
        subreddits: ['r/buildapcsalesuk', 'wallstreetbets'],
      },
      'a gaming PC',
    );
    expect(c.feeds).toEqual([
      { source: 'ocuk-cat', value: 'pc-systems/pcs-by-price/gaming-pcs-under-1000' },
      { source: 'scan-cat', value: 'computer-hardware/gpu-nvidia/all' },
      { source: 'reddit', value: 'buildapcsalesuk' },
    ]);
    expect(c.dropped).toEqual(['Overclockers category "search?q=x"', 'Scan category "made/up/all"', 'subreddit "wallstreetbets"']);
  });
});

describe('compile: long values', () => {
  it('keeps a product link whole', () => {
    const url = 'https://www.pricerunner.com/pl/223-3481594445/Desktop-Computers/Stormforce-Recoil-Compare-Prices';
    expect(validateCompiled({ kind: 'track', urls: [url] }, url).urls).toEqual([url]);
  });
});

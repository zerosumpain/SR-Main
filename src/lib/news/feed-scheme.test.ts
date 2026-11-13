import { describe, expect, it, vi } from 'vitest';

// Every shipped feed pins an origin today, which already rules out non-web
// schemes. This covers the next source added without one: its links are still
// rendered as hrefs, so the parser must refuse anything but http(s) on its own.
vi.mock('$lib/constants/news-sources', async (importOriginal) => {
  const real = await importOriginal<typeof import('$lib/constants/news-sources')>();
  return {
    ...real,
    newsSourceDef: (id: Parameters<typeof real.newsSourceDef>[0]) => {
      const { origin: _origin, pathPattern: _pattern, ...def } = real.newsSourceDef(id);
      return def;
    },
  };
});

const { parseFeed } = await import('./feed');

function rss(link: string) {
  return `<rss><channel><item><title>T</title><link>${link}</link>
    <pubDate>${new Date().toUTCString()}</pubDate></item></channel></rss>`;
}

describe('feed reader — link schemes without a pinned origin', () => {
  it('drops javascript: and data: links and keeps web links', async () => {
    expect(await parseFeed('ars-technica', rss('javascript:alert(1)//x/story'))).toEqual([]);
    expect(await parseFeed('ars-technica', rss('data:text/plain,x/story'))).toEqual([]);
    expect(await parseFeed('ars-technica', rss('https://example.com/a/story'))).toHaveLength(1);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchFeedSource, feedStoryId, getFeedStory, isFeedStoryId, parseFeed } from './feed';
import { newsSourceDef } from '$lib/constants/news-sources';

function rss(
  slug = 'a-science-story',
  date = new Date().toUTCString(),
  link = `https://arstechnica.com/science/2026/09/${slug}/`,
) {
  return `<rss xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:slash="http://purl.org/rss/1.0/modules/slash/"><channel><item>
    <title>Science &amp; technology</title><link>${link}</link><pubDate>${date}</pubDate>
    <dc:creator><![CDATA[A Writer]]></dc:creator><description><![CDATA[A <b>new</b> discovery.]]></description>
    <category>Science</category><slash:comments>12</slash:comments>
    </item></channel></rss>`;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('feed reader — RSS', () => {
  it('normalizes entities, CDATA, tags and real comments without inventing votes', async () => {
    expect((await parseFeed('ars-technica', rss()))[0]).toMatchObject({
      source: 'ars-technica',
      id: 'a-science-story',
      key: 'ars-technica:a-science-story',
      title: 'Science & technology',
      author: 'A Writer',
      summary: 'A new discovery.',
      score: 0,
      commentCount: 12,
      tags: ['Science'],
      discussionUrl: 'https://arstechnica.com/science/2026/09/a-science-story/#comments',
    });
  });

  it('rejects malformed documents, unsafe links, invalid dates and traversal ids', async () => {
    await expect(parseFeed('ars-technica', '<html/>')).rejects.toThrow();
    await expect(parseFeed('ars-technica', '<!DOCTYPE rss><rss/>')).rejects.toThrow();
    expect(await parseFeed('ars-technica', rss('story', 'invalid'))).toEqual([]);
    expect(
      await parseFeed('ars-technica', rss('story', new Date().toUTCString(), 'https://evil.example/story/')),
    ).toEqual([]);
    for (const id of ['../secret', 'https://evil.example', 'story?x=1', 'a'.repeat(241)]) {
      expect(isFeedStoryId(id)).toBe(false);
    }
  });

  it('keeps Best inside 24 hours and uses an exact article lookup for saved links', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-05T12:00:00Z'));
    const fetch = vi.fn(async () => new Response(rss('old-story', '2026-09-01T12:00:00Z')));
    vi.stubGlobal('fetch', fetch);
    expect(await fetchFeedSource('ars-technica', 'best', 25)).toEqual([]);
    expect(await getFeedStory('ars-technica', 'old-story')).toMatchObject({ id: 'old-story' });
    expect(fetch).toHaveBeenLastCalledWith(
      'https://arstechnica.com/feed/?name=old-story',
      expect.any(Object),
    );
    await expect(getFeedStory('ars-technica', 'different-story')).rejects.toThrow('not found');
    fetch.mockClear();
    await expect(getFeedStory('ars-technica', '../bad')).rejects.toThrow('Invalid');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('deduplicates paged feeds and respects the requested limit', async () => {
    const item = rss().match(/<item>[\s\S]*<\/item>/)![0];
    const page = `<rss xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:slash="http://purl.org/rss/1.0/modules/slash/"><channel>${Array.from(
      { length: 20 },
      (_, i) => item.replaceAll('a-science-story', `story-${i}`),
    ).join('')}</channel></rss>`;
    const fetch = vi.fn(async () => new Response(page));
    vi.stubGlobal('fetch', fetch);
    expect(await fetchFeedSource('ars-technica', 'new', 25)).toHaveLength(20);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenLastCalledWith(
      'https://arstechnica.com/feed/?paged=2',
      expect.any(Object),
    );
  });
});

// Atom is not a dialect of RSS — the article URL is an attribute rather than
// element text, and the date element has a different name. Asking for the wrong
// one yields an empty string rather than an error, so every entry would be
// silently dropped with no error to notice. That is what these pin down.
describe('feed reader — Atom', () => {
  const atom = (
    slug = 'thousands-more-young-people',
    updated = '2026-09-15T22:30:03+01:00',
    href = `https://www.gov.uk/government/news/${slug}`,
  ) => `<feed xmlns="http://www.w3.org/2005/Atom"><entry>
      <id>tag:www.gov.uk,2005:/government/news/${slug}</id>
      <updated>${updated}</updated>
      <link rel="alternate" type="text/html" href="${href}"/>
      <title>Help with life&apos;s biggest challenges</title>
      <summary type="html">42 new hubs to open across England.</summary>
    </entry></feed>`;

  it('reads an entry, taking the link from href and the date from updated', async () => {
    const [story] = await parseFeed('govuk', atom());
    expect(story).toMatchObject({
      source: 'govuk',
      id: 'thousands-more-young-people',
      key: 'govuk:thousands-more-young-people',
      title: "Help with life's biggest challenges",
      url: 'https://www.gov.uk/government/news/thousands-more-young-people',
      summary: '42 new hubs to open across England.',
      score: 0,
      commentCount: 0,
    });
    expect(Date.parse(story.publishedAt)).toBeGreaterThan(0);
  });

  it('has no comments thread, so the discussion link is the article itself', async () => {
    const [story] = await parseFeed('govuk', atom());
    expect(story.discussionUrl).toBe(story.url);
  });

  it('drops an entry whose link leaves the declared origin', async () => {
    expect(
      await parseFeed('govuk', atom('slug', '2026-09-15T10:00:00Z', 'https://evil.example/slug')),
    ).toEqual([]);
  });

  it('drops an entry with an unparseable date rather than dating it to 1970', async () => {
    expect(await parseFeed('govuk', atom('slug', 'not-a-date'))).toEqual([]);
  });

  it('still rejects a document that is neither RSS nor Atom', async () => {
    await expect(parseFeed('govuk', '<html/>')).rejects.toThrow();
  });

  it('reads the ONS RSS release calendar, which has no author or comments', async () => {
    const xml = `<rss><channel><item>
      <title>Earnings and employment from PAYE RTI, UK: September 2026</title>
      <link>https://www.ons.gov.uk/releases/earningsandemploymentseptember2026</link>
      <description>Monthly estimates of payrolled employees.</description>
      <pubDate>Tue, 15 Sep 2026 06:00:00 +0000</pubDate>
    </item></channel></rss>`;
    expect((await parseFeed('ons', xml))[0]).toMatchObject({
      source: 'ons',
      id: 'earningsandemploymentseptember2026',
      author: null,
      commentCount: 0,
      score: 0,
    });
  });
});

describe('feedStoryId', () => {
  it('uses the declared path pattern when a source has one', () => {
    const def = newsSourceDef('ars-technica');
    expect(feedStoryId(def, new URL('https://arstechnica.com/science/2026/09/a-slug/'))).toBe('a-slug');
    // A section index is not an article, and the pattern is what says so.
    expect(feedStoryId(def, new URL('https://arstechnica.com/science/'))).toBeNull();
  });

  it('falls back to the last path segment when no pattern is declared', () => {
    const bare = { ...newsSourceDef('ars-technica'), pathPattern: undefined };
    expect(feedStoryId(bare, new URL('https://www.gov.uk/government/news/some-slug'))).toBe('some-slug');
    expect(feedStoryId(bare, new URL('https://www.ons.gov.uk/releases/a-release'))).toBe('a-release');
    expect(feedStoryId(bare, new URL('https://www.gov.uk/'))).toBeNull();
  });
});

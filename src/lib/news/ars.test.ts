import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchArs, getArsStory, isArsStoryId, parseArsFeed } from './ars';

function feed(slug = 'a-science-story', date = new Date().toUTCString(), link = `https://arstechnica.com/science/2026/09/${slug}/`) {
  return `<rss xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:slash="http://purl.org/rss/1.0/modules/slash/"><channel><item>
    <title>Science &amp; technology</title><link>${link}</link><pubDate>${date}</pubDate>
    <dc:creator><![CDATA[A Writer]]></dc:creator><description><![CDATA[A <b>new</b> discovery.]]></description>
    <category>Science</category><slash:comments>12</slash:comments>
    </item></channel></rss>`;
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Ars RSS', () => {
  it('normalizes entities, CDATA, tags and real comments without inventing votes', () => {
    expect(parseArsFeed(feed())[0]).toMatchObject({
      source: 'ars-technica', id: 'a-science-story', key: 'ars-technica:a-science-story',
      title: 'Science & technology', author: 'A Writer', summary: 'A new discovery.',
      score: 0, commentCount: 12, tags: ['Science'],
      discussionUrl: 'https://arstechnica.com/science/2026/09/a-science-story/#comments',
    });
  });
  it('rejects malformed documents, unsafe links, invalid dates and traversal ids', () => {
    expect(() => parseArsFeed('<html/>')).toThrow();
    expect(() => parseArsFeed('<!DOCTYPE rss><rss/>')).toThrow();
    expect(parseArsFeed(feed('story', 'invalid'))).toEqual([]);
    expect(parseArsFeed(feed('story', new Date().toUTCString(), 'https://evil.example/story/'))).toEqual([]);
    for (const id of ['../secret', 'https://evil.example', 'story?x=1', 'a'.repeat(241)]) expect(isArsStoryId(id)).toBe(false);
  });
  it('keeps Best inside 24 hours and uses an exact article lookup for saved links', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-05T12:00:00Z'));
    const fetch = vi.fn(async () => new Response(feed('old-story', '2026-09-01T12:00:00Z')));
    vi.stubGlobal('fetch', fetch);
    expect(await fetchArs('best', 25)).toEqual([]);
    expect(await getArsStory('old-story')).toMatchObject({ id: 'old-story' });
    expect(fetch).toHaveBeenLastCalledWith('https://arstechnica.com/feed/?name=old-story', expect.any(Object));
    await expect(getArsStory('different-story')).rejects.toThrow('not found');
    fetch.mockClear();
    await expect(getArsStory('../bad')).rejects.toThrow('Invalid');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('deduplicates paged feeds and respects the requested limit', async () => {
    const item = feed().match(/<item>[\s\S]*<\/item>/)![0];
    const page = `<rss xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:slash="http://purl.org/rss/1.0/modules/slash/"><channel>${Array.from({length: 20}, (_, i) => item.replaceAll('a-science-story', `story-${i}`)).join('')}</channel></rss>`;
    const fetch = vi.fn(async () => new Response(page));
    vi.stubGlobal('fetch', fetch);
    expect(await fetchArs('new', 25)).toHaveLength(20);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenLastCalledWith('https://arstechnica.com/feed/?paged=2', expect.any(Object));
  });
});

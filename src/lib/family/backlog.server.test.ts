import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/db', () => ({ db: {} }));

const { describeLink, followShortLink, prepareLink } = await import('./backlog.server');

type Reply = { status?: number; body?: string; finalUrl?: string; contentType?: string } | Error;

/** A guardedPublicFetch stand-in answering by URL prefix, recording what was asked. */
function fetcher(replies: Record<string, Reply>) {
  const asked: string[] = [];
  const fn = async (url: string, opts: { readBody?: (s: number, h: Headers) => boolean } = {}) => {
    asked.push(url);
    const key = Object.keys(replies).find((k) => url.startsWith(k));
    const r = key ? replies[key] : new Error('ssrf_blocked');
    if (r instanceof Error) throw r;
    const status = r.status ?? 200;
    const headers = new Headers({ 'content-type': r.contentType ?? 'text/html' });
    const read = !opts.readBody || opts.readBody(status, headers);
    return {
      status, ok: status >= 200 && status < 300, headers,
      body: new TextEncoder().encode(read ? r.body ?? '' : '').buffer as ArrayBuffer,
      finalUrl: r.finalUrl ?? url, truncated: false,
    };
  };
  return { fn: fn as never, asked };
}

describe('followShortLink', () => {
  it('follows a TikTok short link and leaves others alone', async () => {
    const f = fetcher({ 'https://vm.tiktok.com/': { finalUrl: 'https://www.tiktok.com/@a/video/123?_r=1' } });
    expect((await followShortLink(new URL('https://vm.tiktok.com/ZNabc/'), f.fn)).toString()).toBe('https://www.tiktok.com/@a/video/123?_r=1');
    expect((await followShortLink(new URL('https://example.com/'), f.fn)).toString()).toBe('https://example.com/');
    expect(f.asked).toEqual(['https://vm.tiktok.com/ZNabc/']);
  });

  it('keeps the short link when following it is refused', async () => {
    const f = fetcher({});
    expect((await followShortLink(new URL('https://vm.tiktok.com/ZNabc/'), f.fn)).toString()).toBe('https://vm.tiktok.com/ZNabc/');
  });

  it('prepares a short link as the cleaned video it leads to', async () => {
    const f = fetcher({ 'https://vm.tiktok.com/': { finalUrl: 'https://www.tiktok.com/@a/video/12345?_r=1' } });
    expect(await prepareLink(new URL('https://vm.tiktok.com/ZNabc/'), f.fn)).toMatchObject({
      url: 'https://www.tiktok.com/@a/video/12345', key: 'tiktok:12345',
    });
  });
});

describe('describeLink', () => {
  it('uses oEmbed alone when it has a title and picture', async () => {
    const f = fetcher({
      'https://www.youtube.com/oembed': {
        contentType: 'application/json',
        body: JSON.stringify({ title: 'Volcanoes', provider_name: 'YouTube', thumbnail_url: 'https://i.ytimg.com/vi/x/hq.jpg' }),
      },
    });
    expect(await describeLink('https://www.youtube.com/watch?v=abcdefghijk', f.fn)).toEqual({
      title: 'Volcanoes', siteName: 'YouTube', thumbnailUrl: 'https://i.ytimg.com/vi/x/hq.jpg',
    });
    expect(f.asked).toHaveLength(1);
  });

  it('falls back to the page for anything else', async () => {
    const f = fetcher({ 'https://example.com/': { body: '<meta property="og:title" content="Day out"><meta property="og:image" content="https://example.com/a.jpg">' } });
    expect(await describeLink('https://example.com/trip', f.fn)).toEqual({ title: 'Day out', siteName: null, thumbnailUrl: 'https://example.com/a.jpg' });
  });

  it('never reads a TikTok page, whose title is the same for every video', async () => {
    const f = fetcher({ 'https://www.tiktok.com/': { body: '<title>TikTok - Make Your Day</title>' } });
    expect(await describeLink('https://www.tiktok.com/@/video/12345', f.fn)).toEqual({ title: null, siteName: null, thumbnailUrl: null });
    expect(f.asked).toEqual([`https://www.tiktok.com/oembed?url=${encodeURIComponent('https://www.tiktok.com/@/video/12345')}`]);
  });

  it('answers nothing, never throws, when every fetch fails or is not HTML', async () => {
    expect(await describeLink('https://example.com/trip', fetcher({}).fn)).toEqual({ title: null, siteName: null, thumbnailUrl: null });
    const pdf = fetcher({ 'https://example.com/': { contentType: 'application/pdf', body: '%PDF' } });
    expect(await describeLink('https://example.com/a.pdf', pdf.fn)).toEqual({ title: null, siteName: null, thumbnailUrl: null });
  });
});

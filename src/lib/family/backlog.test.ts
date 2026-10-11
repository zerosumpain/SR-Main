import { describe, expect, it } from 'vitest';
import {
  canonicalKey,
  cleanUrl,
  decodeEntities,
  findUrl,
  isShortLink,
  kindOf,
  listsOf,
  oembedUrl,
  parseOembed,
  parsePageMeta,
  parseShare,
  providerOf,
  toWire,
  transition,
  type BacklogRecord,
} from './backlog';

const u = (s: string) => new URL(s);

function item(over: Partial<BacklogRecord> = {}): BacklogRecord {
  return {
    id: 'b1', kind: 'video', url: 'https://www.youtube.com/watch?v=abcdefghijk', canonicalUrl: 'youtube:abcdefghijk',
    provider: 'youtube', title: 'A video', siteName: 'YouTube', thumbnailUrl: null, note: null, forEmail: null,
    addedByEmail: 'kid@example.test', status: 'new', doneByEmail: null, doneAt: null,
    createdAt: new Date('2026-10-01T00:00:00Z'), updatedAt: new Date('2026-10-01T00:00:00Z'), ...over,
  };
}

describe('links', () => {
  it('finds the link in a TikTok share caption', () => {
    expect(findUrl('Check out this video! https://vm.tiktok.com/ZNabc123/ #fyp')).toBe('https://vm.tiktok.com/ZNabc123/');
    expect(findUrl('see (https://example.com/a).')).toBe('https://example.com/a');
    expect(findUrl('no link here')).toBeNull();
  });

  it('knows the provider and kind', () => {
    expect(providerOf(u('https://youtu.be/abcdefghijk'))).toBe('youtube');
    expect(providerOf(u('https://m.youtube.com/watch?v=abcdefghijk'))).toBe('youtube');
    expect(providerOf(u('https://www.tiktok.com/@a/video/1'))).toBe('tiktok');
    expect(providerOf(u('https://notyoutube.com/x'))).toBe('web');
    expect(kindOf(u('https://www.instagram.com/reel/Cxyz/'))).toBe('video');
    expect(kindOf(u('https://www.instagram.com/p/Cxyz/'))).toBe('page');
    expect(kindOf(u('https://www.bbc.co.uk/news'))).toBe('page');
  });

  it('spots TikTok short links', () => {
    expect(isShortLink(u('https://vm.tiktok.com/ZNabc/'))).toBe(true);
    expect(isShortLink(u('https://www.tiktok.com/t/ZTabc/'))).toBe(true);
    expect(isShortLink(u('https://www.tiktok.com/@a/video/1'))).toBe(false);
  });

  it('takes the sharer off a YouTube link and reduces it to the video', () => {
    expect(cleanUrl(u('https://youtu.be/abcdefghijk?si=SHARER&t=30'))).toBe('https://www.youtube.com/watch?v=abcdefghijk');
    expect(cleanUrl(u('https://m.youtube.com/watch?v=abcdefghijk&feature=share&pp=x'))).toBe('https://www.youtube.com/watch?v=abcdefghijk');
    expect(cleanUrl(u('https://youtube.com/shorts/abcdefghijk?si=x'))).toBe('https://www.youtube.com/shorts/abcdefghijk');
  });

  it('drops every query from TikTok and Instagram, and tracking from other pages', () => {
    expect(cleanUrl(u('https://www.tiktok.com/@a/video/123?_r=1&_t=ZN-abc&is_from_webapp=1'))).toBe('https://www.tiktok.com/@a/video/123');
    expect(cleanUrl(u('https://www.instagram.com/reel/Cxyz/?igsh=abc'))).toBe('https://www.instagram.com/reel/Cxyz/');
    expect(cleanUrl(u('https://example.com/a?utm_source=x&id=7&fbclid=y#top'))).toBe('https://example.com/a?id=7');
    expect(cleanUrl(u('https://example.com/a?utm_medium=x'))).toBe('https://example.com/a');
  });

  it('keys the same thing shared two ways the same', () => {
    const a = canonicalKey(cleanUrl(u('https://youtu.be/abcdefghijk?si=1')));
    const b = canonicalKey(cleanUrl(u('https://www.youtube.com/shorts/abcdefghijk')));
    expect(a).toBe('youtube:abcdefghijk');
    expect(b).toBe(a);
    expect(canonicalKey('https://www.example.com/a/')).toBe(canonicalKey('http://example.com/a'));
  });
});

describe('parseShare', () => {
  it('reads a link from url, or from text with the rest as a title hint', () => {
    const a = parseShare({ url: 'https://example.com/x', note: ' half term? ' });
    expect(a.ok && a.value.kind === 'link' && a.value.note).toBe('half term?');
    const b = parseShare({ text: 'Funny cat https://vm.tiktok.com/ZNabc/' });
    expect(b.ok && b.value.kind === 'link' && b.value.hint).toBe('Funny cat');
  });

  it('turns text with no link into an idea', () => {
    const r = parseShare({ text: '  Go to Whitby  ' });
    expect(r).toMatchObject({ ok: true, value: { kind: 'idea', title: 'Go to Whitby' } });
  });

  it('refuses nothing, non-web links, long notes and odd types', () => {
    expect(parseShare({})).toMatchObject({ ok: false, status: 400 });
    expect(parseShare(null)).toMatchObject({ ok: false });
    expect(parseShare({ url: 'file:///etc/passwd' })).toMatchObject({ ok: false, error: 'Only web links can be shared.' });
    expect(parseShare({ url: 'javascript:alert(1)' })).toMatchObject({ ok: false });
    expect(parseShare({ text: 'x', note: 'n'.repeat(501) })).toMatchObject({ ok: false });
    expect(parseShare({ text: 'x', forId: 7 })).toMatchObject({ ok: false });
    expect(parseShare({ url: 7 })).toMatchObject({ ok: false });
  });
});

describe('metadata', () => {
  it('asks YouTube about the watch link, even for a Short', () => {
    expect(oembedUrl('https://www.youtube.com/shorts/abcdefghijk')).toBe(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent('https://www.youtube.com/watch?v=abcdefghijk')}`,
    );
    expect(oembedUrl('https://www.tiktok.com/@a/video/1')).toContain('https://www.tiktok.com/oembed?url=');
    expect(oembedUrl('https://example.com/')).toBeNull();
  });

  it('reads oEmbed, naming a captionless TikTok after its author', () => {
    expect(parseOembed({ title: 'Cats &amp; dogs', provider_name: 'YouTube', thumbnail_url: 'https://i.ytimg.com/vi/x/hq.jpg' }, 'youtube'))
      .toEqual({ title: 'Cats & dogs', siteName: 'YouTube', thumbnailUrl: 'https://i.ytimg.com/vi/x/hq.jpg' });
    expect(parseOembed({ title: '', author_name: '@sam', provider_name: 'TikTok' }, 'tiktok').title).toBe('TikTok from @sam');
    expect(parseOembed({ thumbnail_url: 'http://insecure.example/x.jpg' }, 'web').thumbnailUrl).toBeNull();
    expect(parseOembed('nope', 'web')).toEqual({ title: null, siteName: null, thumbnailUrl: null });
  });

  it('reads Open Graph tags in any attribute order, with a relative picture made absolute', () => {
    const html = `<html><head><title>Fallback</title>
      <meta content="Big &#8211; day out" property="og:title">
      <meta property='og:site_name' content='Visit Whitby'>
      <meta property="og:image" content="/img/abbey.jpg"></head></html>`;
    expect(parsePageMeta(html, 'https://www.example.com/page')).toEqual({
      title: 'Big – day out', siteName: 'Visit Whitby', thumbnailUrl: 'https://www.example.com/img/abbey.jpg',
    });
    expect(parsePageMeta('<title> Just a title </title>', 'https://e.com/').title).toBe('Just a title');
  });

  it('decodes entities', () => {
    expect(decodeEntities('a &amp; b &#x27;c&#39; &quot;d&quot; &bogus;')).toBe(`a & b 'c' "d" &bogus;`);
  });
});

describe('transition', () => {
  const kid = { email: 'kid@example.test', parent: false };
  const other = { email: 'other@example.test', parent: false };
  const parent = { email: 'owner@example.test', parent: true };
  const now = new Date('2026-10-11T12:00:00Z');

  it('lets anyone mark done or not for us, and reopen', () => {
    expect(transition(item(), 'done', other, now)).toMatchObject({ ok: true, value: { from: 'new', patch: { status: 'done', doneByEmail: other.email } } });
    expect(transition(item(), 'dismiss', other, now)).toMatchObject({ ok: true, value: { patch: { status: 'dismissed' } } });
    expect(transition(item({ status: 'done' }), 'reopen', other, now)).toMatchObject({ ok: true, value: { patch: { status: 'new', doneByEmail: null } } });
    expect(transition(item({ status: 'done' }), 'done', other, now)).toMatchObject({ ok: false, status: 409 });
    expect(transition(item(), 'reopen', other, now)).toMatchObject({ ok: false, status: 409 });
  });

  it('lets only the sharer or a parent delete', () => {
    expect(transition(item(), 'delete', other, now)).toMatchObject({ ok: false, status: 403 });
    expect(transition(item(), 'delete', kid, now)).toMatchObject({ ok: true });
    expect(transition(item(), 'delete', parent, now)).toMatchObject({ ok: true });
  });
});

describe('lists and wire', () => {
  it('orders the list newest first and keeps finished things for 30 days', () => {
    const now = new Date('2026-10-11T00:00:00Z');
    const lists = listsOf(
      [
        item({ id: 'old', createdAt: new Date('2026-09-01T00:00:00Z') }),
        item({ id: 'newer', createdAt: new Date('2026-10-10T00:00:00Z') }),
        item({ id: 'watched', status: 'done', doneAt: new Date('2026-10-05T00:00:00Z') }),
        item({ id: 'long-ago', status: 'done', doneAt: new Date('2026-08-01T00:00:00Z') }),
        item({ id: 'gone', status: 'deleted' }),
      ],
      now,
    );
    expect(lists.items.map((i) => i.id)).toEqual(['newer', 'old']);
    expect(lists.finished.map((i) => i.id)).toEqual(['watched']);
  });

  it('never sends an address', () => {
    const w = toWire(item({ forEmail: 'owner@example.test', doneByEmail: 'kid@example.test' }), (e) => `f_${e.split('@')[0]}`);
    expect(JSON.stringify(w)).not.toContain('@example.test');
    expect(w).toMatchObject({ forId: 'f_owner', addedById: 'f_kid', doneById: 'f_kid' });
  });
});

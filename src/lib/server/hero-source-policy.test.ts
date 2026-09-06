import { describe, expect, it } from 'vitest';
import { isHeroSource, mediaRange } from './hero-source-policy';

describe('hero source boundary', () => {
  const source = { name: 'siteherobackground/clip.mp4', mimeType: 'video/mp4', sizeBytes: 100, permissions: { read: true } };
  it('accepts an MP4 directly in the intended folder', () => {
    expect(isHeroSource(source)).toBe(true);
    expect(isHeroSource({ ...source, name: 'SiteHeroBackground/CLIP.MP4' })).toBe(true);
  });
  it.each([
    { name: 'private/clip.mp4' }, { name: 'siteherobackground-other/clip.mp4' },
    { name: 'siteherobackground/nested/clip.mp4' }, { name: 'siteherobackground/../clip.mp4' },
    { name: 'siteherobackground/clip.mp4.html' }, { mimeType: 'text/html' },
    { sizeBytes: 0 }, { sizeBytes: 50 * 1024 * 1024 + 1 }, { permissions: { read: false } },
  ])('rejects sources outside the publication policy: %j', change => {
    expect(isHeroSource({ ...source, ...change })).toBe(false);
  });
});

describe('hero media ranges', () => {
  it.each([
    [null, { start: 0, end: 99 }], ['bytes=0-1', { start: 0, end: 1 }],
    ['bytes=90-', { start: 90, end: 99 }], ['bytes=-10', { start: 90, end: 99 }],
    ['bytes=90-999', { start: 90, end: 99 }], ['bytes=-999', { start: 0, end: 99 }],
  ])('serves bounded byte range %s', (header, expected) => { expect(mediaRange(header, 100)).toEqual(expected); });
  it.each(['bytes=100-', 'bytes=5-4', 'bytes=-0', 'bytes=-', 'bytes=0-1,4-5', 'bytes=NaN-', 'items=0-1'])('rejects %s', header => {
    expect(mediaRange(header, 100)).toBeNull();
  });
});

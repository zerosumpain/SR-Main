import { describe, expect, it } from 'vitest';
import { parseVideoSrc } from './video';

describe('parseVideoSrc', () => {
  it('accepts site-relative mp4/webm files only', () => {
    expect(parseVideoSrc('/api/blog/images/deck-media/up-abc123.mp4')).toEqual({
      kind: 'file',
      src: '/api/blog/images/deck-media/up-abc123.mp4',
    });
    expect(parseVideoSrc('/videos/clip.webm')?.kind).toBe('file');
    expect(parseVideoSrc('//evil.example/clip.mp4')).toBeNull();
    expect(parseVideoSrc('/clip.mov')).toBeNull();
  });

  it('parses the YouTube URL shapes', () => {
    expect(parseVideoSrc('https://www.youtube.com/watch?v=YE7VzlLtp-4')).toEqual({ kind: 'youtube', id: 'YE7VzlLtp-4' });
    expect(parseVideoSrc('https://youtu.be/YE7VzlLtp-4')).toEqual({ kind: 'youtube', id: 'YE7VzlLtp-4' });
    expect(parseVideoSrc('https://www.youtube-nocookie.com/embed/YE7VzlLtp-4')).toEqual({ kind: 'youtube', id: 'YE7VzlLtp-4' });
  });

  it('parses Vimeo URLs', () => {
    expect(parseVideoSrc('https://vimeo.com/76979871')).toEqual({ kind: 'vimeo', id: '76979871' });
    expect(parseVideoSrc('https://player.vimeo.com/video/76979871')).toEqual({ kind: 'vimeo', id: '76979871' });
  });

  it('rejects everything else', () => {
    expect(parseVideoSrc('https://example.com/video.mp4')).toBeNull();
    expect(parseVideoSrc('http://youtube.com/watch?v=YE7VzlLtp-4')).toBeNull(); // http
    expect(parseVideoSrc('javascript:alert(1)')).toBeNull();
    expect(parseVideoSrc('')).toBeNull();
  });
});

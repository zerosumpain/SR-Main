import { describe, expect, it } from 'vitest';
import { downloadHeaders, isInlineSafeMime } from './file-serving';

const png = { mimeType: 'image/png', sizeBytes: 10, filename: 'shot.png' };

describe('downloadHeaders', () => {
  it('always carries the headers that neutralise a scriptable payload', () => {
    const h = downloadHeaders(png);
    expect(h['content-security-policy']).toBe('sandbox');
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['cache-control']).toBe('private, no-store');
    expect(h['referrer-policy']).toBe('no-referrer');
  });

  it('honours an inline request for a raster image', () => {
    expect(downloadHeaders({ ...png, inline: true })['content-disposition'])
      .toBe('inline; filename="shot.png"');
  });

  it('defaults to attachment when inline is not asked for', () => {
    expect(downloadHeaders(png)['content-disposition']).toBe('attachment; filename="shot.png"');
  });

  // The regression that matters: these are the types that execute as a
  // top-level document, and the stored MIME comes from the uploader.
  it.each([
    ['image/svg+xml', 'drawing.svg'],
    ['text/html', 'page.html'],
    ['application/xhtml+xml', 'page.xhtml'],
    ['text/xml', 'feed.xml'],
    ['application/pdf', 'doc.pdf'],
  ])('refuses to serve %s inline even when asked', (mimeType, filename) => {
    const h = downloadHeaders({ mimeType, sizeBytes: 10, filename, inline: true });
    expect(h['content-disposition']).toBe(`attachment; filename="${filename}"`);
    expect(h['content-type']).toBe(mimeType);
  });

  it('ignores charset parameters and case when matching the allow-list', () => {
    expect(isInlineSafeMime('IMAGE/PNG; charset=binary')).toBe(true);
    expect(isInlineSafeMime('image/svg+xml; charset=utf-8')).toBe(false);
  });

  it('falls back to octet-stream for a missing type', () => {
    const h = downloadHeaders({ mimeType: null, sizeBytes: 3, filename: 'x', inline: true });
    expect(h['content-type']).toBe('application/octet-stream');
    expect(h['content-disposition']).toBe('attachment; filename="x"');
  });

  it('strips characters that would break out of the filename token', () => {
    const h = downloadHeaders({
      ...png,
      filename: 'evil".gpx\r\nSet-Cookie: a=b',
    });
    expect(h['content-disposition']).toBe('attachment; filename="evil.gpxSet-Cookie: a=b"');
    expect(h['content-disposition']).not.toContain('\n');
    expect(h['content-disposition']).not.toContain('"evil"');
  });
});

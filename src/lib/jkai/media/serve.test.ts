import { describe, expect, it } from 'vitest';
import { servingHeaders } from './serve';

describe('servingHeaders — nothing that can run is served inline', () => {
  it('renders raster images, audio, video and PDF inline with their own type', () => {
    for (const m of ['image/png', 'image/jpeg', 'audio/ogg; codecs=opus', 'video/mp4', 'application/pdf']) {
      expect(servingHeaders(m, 'x')).toEqual({ type: m, disposition: 'inline' });
    }
  });

  it('downloads HTML, XML and SVG as plain text or bytes, never as themselves', () => {
    expect(servingHeaders('text/html', 'text')).toEqual({ type: 'text/plain; charset=utf-8', disposition: 'attachment' });
    expect(servingHeaders('application/xml', 'text')).toEqual({ type: 'text/plain; charset=utf-8', disposition: 'attachment' });
    expect(servingHeaders('image/svg+xml', 'image')).toEqual({ type: 'application/octet-stream', disposition: 'attachment' });
    expect(servingHeaders('TEXT/HTML; charset=utf-8', 'text').disposition).toBe('attachment');
  });

  it('downloads office documents as bytes', () => {
    expect(servingHeaders('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'document')).toEqual({
      type: 'application/octet-stream',
      disposition: 'attachment',
    });
  });
});

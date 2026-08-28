import { describe, expect, it } from 'vitest';
import { GPX_MIME_TYPE, routeExportName, validateRouteExport } from './route-exports';
import { hashShareToken, shareDownloadUrl } from './file-shares';
import { routeMessage } from './workflows/site-tools/tools/route-export';

const GPX = '<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk/></gpx>';

describe('route exports', () => {
  it('places a safe GPX basename in the virtual drive/routes folder', () => {
    expect(routeExportName({ basename: '2026-08-16-running-loop-8.9mi.gpx' }))
      .toBe('drive/routes/2026-08-16-running-loop-8.9mi.gpx');
    expect(GPX_MIME_TYPE).toBe('application/gpx+xml');
  });

  it.each(['../secrets.gpx', 'nested/route.gpx', 'route.xml', '.gpx'])('rejects unsafe or non-GPX filenames: %s', (basename) => {
    expect(() => routeExportName({ basename })).toThrow();
  });

  it('accepts only a complete GPX 1.1 payload', () => {
    expect(() => validateRouteExport({
      gpx: GPX,
      basename: '2026-08-16-running-loop-8.9mi.gpx',
      activity: 'running',
      distanceMiles: 8.9,
    })).not.toThrow();
    expect(() => validateRouteExport({
      gpx: '<gpx version="1.0"></gpx>',
      basename: 'route.gpx',
      activity: 'running',
      distanceMiles: 1,
    })).toThrow('GPX 1.1');
  });

  it('makes opaque, file-scoped download links and WhatsApp payloads', () => {
    const token = 'a'.repeat(43);
    const url = shareDownloadUrl(token);
    // New exports go to the general share endpoint, not the legacy GPX one.
    expect(url).toContain(`/api/file-shares/${token}/download`);
    expect(url).not.toContain('/api/route-exports/');
    expect(hashShareToken(token)).not.toContain(token);
    expect(routeMessage('running', 8.9, url)).toBe(`Running route ready — 8.9 mi. Download GPX: ${url}`);
  });
});

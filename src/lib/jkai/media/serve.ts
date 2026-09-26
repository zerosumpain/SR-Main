/**
 * How a stored file is served. Only media a browser renders without running
 * anything — raster images, audio, video, PDF — goes inline with its own type.
 * Everything else (HTML, XML, SVG, JSON, office files, plain text) is a
 * DOWNLOAD, typed as plain text or octet-stream, under a sandbox CSP: served
 * inline from this origin, an uploaded HTML page would run with the viewer's
 * session, and once members upload that viewer can be someone else. A
 * `+server.ts` response gets none of the page CSP, so it is set here.
 */
export function servingHeaders(mimeType: string, kind: string): { type: string; disposition: 'inline' | 'attachment' } {
  const base = mimeType.split(';', 1)[0].trim().toLowerCase();
  const safeInline =
    (base.startsWith('image/') && base !== 'image/svg+xml') ||
    base.startsWith('audio/') ||
    base.startsWith('video/') ||
    base === 'application/pdf';
  if (safeInline) return { type: mimeType, disposition: 'inline' };
  return { type: kind === 'text' ? 'text/plain; charset=utf-8' : 'application/octet-stream', disposition: 'attachment' };
}

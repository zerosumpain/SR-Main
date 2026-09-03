/**
 * Browser boundary for agent-generated applications.
 *
 * Generated code is untrusted even when its build was initiated by the owner.
 * CSP sandbox without `allow-same-origin` gives the document an opaque origin,
 * so it cannot act with the authority of strangeramblings.com. Keep this
 * policy on both preview and published generated HTML.
 */
export const GENERATED_CONTENT_CSP = [
  'sandbox allow-scripts allow-modals allow-downloads',
  "default-src 'self' https: data: blob:",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https: blob:",
  "style-src 'self' 'unsafe-inline' https:",
  "img-src 'self' https: data: blob:",
  "font-src 'self' https: data:",
  "media-src 'self' https: data: blob:",
  "connect-src 'self' https: wss:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'self'",
].join('; ');

/** Only response metadata that cannot set credentials or relax isolation. */
const SAFE_UPSTREAM_RESPONSE_HEADERS = new Set([
  'accept-ranges',
  'cache-control',
  'content-disposition',
  'content-language',
  'content-range',
  'content-type',
  'etag',
  'last-modified',
]);

export function safeGeneratedResponseHeaders(source?: Headers): Headers {
  const headers = new Headers();
  if (source) {
    for (const [name, value] of source) {
      if (SAFE_UPSTREAM_RESPONSE_HEADERS.has(name.toLowerCase())) headers.set(name, value);
    }
  }
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=(), usb=()');
  headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
  // Sandboxed documents have an opaque origin. Public generated assets and API
  // responses may be read by that origin, but credentials are never forwarded.
  headers.set('Access-Control-Allow-Origin', '*');
  const contentType = headers.get('content-type') ?? '';
  if (contentType.toLowerCase().includes('text/html')) {
    headers.set('Content-Security-Policy', GENERATED_CONTENT_CSP);
    headers.set('Cache-Control', 'no-store');
  }
  return headers;
}

/** Explicit request-header allowlist for the generated-app upstream. */
export function safeGeneratedRequestHeaders(source: Headers): Headers {
  const headers = new Headers();
  for (const name of [
    'accept',
    'accept-language',
    'content-type',
    'if-modified-since',
    'if-none-match',
    'range',
    'user-agent',
  ]) {
    const value = source.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

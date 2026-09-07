/**
 * Browser boundary for applications served out of `data/jkai-projects`.
 *
 * That directory holds two populations, and they get different boundaries —
 * the same split `$lib/projects/visibility` already draws for the /projects
 * index, for the same reason.
 */
const BUNDLE_CSP_DIRECTIVES = [
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
];

/**
 * Agent-generated applications.
 *
 * Generated code is untrusted even when its build was initiated by the owner.
 * CSP sandbox without `allow-same-origin` gives the document an opaque origin,
 * so it cannot act with the authority of strangeramblings.com. Keep this
 * policy on both preview and published generated HTML.
 */
export const GENERATED_CONTENT_CSP = [
  'sandbox allow-scripts allow-modals allow-downloads',
  ...BUNDLE_CSP_DIRECTIVES,
].join('; ');

/**
 * Hand-built bundles the owner wrote and published from his own repositories —
 * the `STATIC_PROJECT_KEYS` half of /projects (scs-earnings, terminal-descent,
 * archetype…). Same hardening, no sandbox.
 *
 * The sandbox is not free, and on first-party content it buys nothing while
 * costing the page its origin. An opaque origin means the browser treats every
 * subresource the document asks for as cross-site, so:
 *
 *  - a Vite bundle's own `<script type="module" crossorigin>` and
 *    `<link crossorigin>` are fetched WITHOUT cookies. On a PRIVATE project the
 *    visibility gate then 404s the app's own JS and CSS and the page hangs on
 *    its boot splash for ever — for the signed-in owner too, because the
 *    session cookie is withheld by exactly the same rule. That is what took
 *    scs-earnings down between 2026-09-04 and 2026-09-07.
 *  - every same-origin `fetch('/api/...')` becomes a cross-origin request, so
 *    terminal-descent's global leaderboard silently fell back to local scores.
 *
 * See `$lib/server/preview-ticket` for the other half of this story: a
 * GENERATED app cannot be handed its origin back, so the studio proxy mints a
 * capability instead. A bundle written by hand does not need that dance — it is
 * first-party code and always was.
 */
export const FIRST_PARTY_BUNDLE_CSP = BUNDLE_CSP_DIRECTIVES.join('; ');

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

export function safeGeneratedResponseHeaders(
  source?: Headers,
  options?: { firstParty?: boolean },
): Headers {
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
    headers.set(
      'Content-Security-Policy',
      options?.firstParty ? FIRST_PARTY_BUNDLE_CSP : GENERATED_CONTENT_CSP,
    );
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

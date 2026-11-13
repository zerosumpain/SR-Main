import { createHash } from 'node:crypto';

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
 * the `STATIC_PROJECT_KEYS` half of /projects (scs-earnings, marbler,
 * archetype…). Same hardening, no sandbox, and a policy cut to what each
 * bundle actually loads.
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
 *
 * Keeping the origin is exactly why the policy has to be tight: these pages run
 * with the owner's session, so a DOM injection or a compromised CDN inside one
 * of them would too. The generated policy's `https:` / `'unsafe-inline'` /
 * `'unsafe-eval'` would let either execute. So a first-party bundle gets:
 *
 *  - scripts from its own files only — no third-party script host at all;
 *  - inline `<script>` blocks and `on*=` attributes allowed by the hash of the
 *    exact text in the file it was served from (`inlineScriptHashes`), never by
 *    `'unsafe-inline'`. Hashes are derived at serve time, so redeploying a
 *    bundle by hand cannot leave its CSP behind;
 *  - eval only where the bundle needs it (`BUNDLE_PROFILES`), and the narrow
 *    `'wasm-unsafe-eval'` where WebAssembly is all it needs;
 *  - network, images and fonts from `'self'` plus the hosts the profile names.
 *
 * A static key with no profile gets the strictest policy. Publishing a new
 * bundle under a static key means checking its console for CSP violations and
 * adding the profile it needs here.
 */
export interface BundleProfile {
  /**
   * `'js'`: the bundle compiles code at runtime (`new Function` — PixiJS v8
   * builds its shader uniform sync this way and refuses to start without it).
   * `'wasm'`: WebAssembly only (physics engines, mesh decoders).
   */
  eval?: 'js' | 'wasm';
  /** Loads its type from Google Fonts (stylesheet + font files). */
  googleFonts?: boolean;
  /** Extra origins the page calls with fetch/XHR/WebSocket. */
  connect?: readonly string[];
}

export const BUNDLE_PROFILES: Readonly<Record<string, BundleProfile>> = {
  // Balance lab: three.js + meshopt decoder (wasm); its optional bring-your-own
  // key mode calls OpenRouter straight from the browser.
  archetype: { eval: 'wasm', googleFonts: true, connect: ['https://openrouter.ai'] },
  'scs-earnings': { googleFonts: true },
  pulse: { googleFonts: true },
  'field-study-8': {},
  'field-study-9': { googleFonts: true },
  // PixiJS v8 refuses to start its renderer without eval (it would need the
  // bundle to import `pixi.js/unsafe-eval` instead); marbler also runs a wasm
  // physics worker. Hometowns carries the same Pixi build.
  marbler: { eval: 'js', googleFonts: true },
  hometowns: { eval: 'js' },
};

const GOOGLE_FONTS_STYLES = 'https://fonts.googleapis.com';
const GOOGLE_FONTS_FILES = 'https://fonts.gstatic.com';

/** Script types a browser executes, and so the ones script-src governs. */
const EXECUTABLE_SCRIPT_TYPE =
  /^(|module|importmap|speculationrules|(text|application)\/(x-)?(java|ecma)script)$/i;

function sha256Source(text: string): string {
  return `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;
}

/**
 * CSP hash sources for every inline script block and inline event-handler
 * attribute in `html`, plus `'unsafe-hashes'` when there are handlers (CSP only
 * honours a hash for an `on*=` attribute alongside that keyword). Over-matching
 * is harmless — a hash only admits that exact text — so a plain scan is enough.
 *
 * The browser hashes what its parser produced, not the raw bytes: newlines
 * are normalised to LF before anything else, and attribute values are
 * entity-decoded. Both are mirrored here or the hash would never match.
 */
export function inlineScriptHashes(html: string): string[] {
  const doc = html.replace(/\r\n?/g, '\n');
  const sources = new Set<string>();
  for (const m of doc.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const attrs = m[1];
    if (/\ssrc\s*=/i.test(attrs)) continue;
    const type = /\stype\s*=\s*["']?([^"'\s>]*)/i.exec(attrs)?.[1] ?? '';
    if (!EXECUTABLE_SCRIPT_TYPE.test(type.trim())) continue;
    if (m[2].length) sources.add(sha256Source(m[2]));
  }
  // Handlers live in markup, so scan with every script body removed: a data
  // block (`type="text/plain"`, JSON) can be megabytes of text that happens to
  // contain `on…=`, and each false hit would grow the header.
  const markup = doc.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '');
  let handlers = false;
  for (const m of markup.matchAll(/\son[a-z]+\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    handlers = true;
    sources.add(sha256Source(decodeAttributeEntities(m[1] ?? m[2] ?? '')));
  }
  return handlers ? ["'unsafe-hashes'", ...sources] : [...sources];
}

const NAMED_ENTITIES: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };

function decodeAttributeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|quot|apos|lt|gt);/gi, (whole, ref: string) => {
    const lower = ref.toLowerCase();
    if (lower.startsWith('#x')) return String.fromCodePoint(parseInt(lower.slice(2), 16));
    if (lower.startsWith('#')) return String.fromCodePoint(parseInt(lower.slice(1), 10));
    return NAMED_ENTITIES[lower] ?? whole;
  });
}

/**
 * The policy for one first-party bundle document. `html` is the document being
 * served, so its own inline scripts can be admitted by hash.
 */
export function firstPartyBundleCsp(slug: string, html = ''): string {
  const profile = BUNDLE_PROFILES[slug] ?? {};
  const fonts = profile.googleFonts === true;
  const script = ["'self'", ...inlineScriptHashes(html)];
  if (profile.eval === 'js') script.push("'unsafe-eval'", "'wasm-unsafe-eval'");
  if (profile.eval === 'wasm') script.push("'wasm-unsafe-eval'");
  return [
    "default-src 'self'",
    `script-src ${script.join(' ')}`,
    `style-src 'self' 'unsafe-inline'${fonts ? ` ${GOOGLE_FONTS_STYLES}` : ''}`,
    "img-src 'self' data: blob:",
    `font-src 'self' data:${fonts ? ` ${GOOGLE_FONTS_FILES}` : ''}`,
    "media-src 'self' data: blob:",
    ["connect-src 'self'", ...(profile.connect ?? [])].join(' '),
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    "frame-ancestors 'self'",
  ].join('; ');
}

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
  options?: { firstParty?: boolean; slug?: string; html?: string },
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
  const isHtml = (headers.get('content-type') ?? '').toLowerCase().includes('text/html');
  if (options?.firstParty) {
    if (isHtml) headers.set('Content-Security-Policy', firstPartyBundleCsp(options.slug ?? '', options.html));
  } else {
    // Every untrusted response carries the sandbox, not just text/html. An SVG,
    // XML or untyped file opened directly is a document too, and its <script>
    // would otherwise run with the site's origin. On a subresource (JS, CSS,
    // an <img>) the header is inert, so this costs the generated app nothing.
    headers.set('Content-Security-Policy', GENERATED_CONTENT_CSP);
  }
  if (isHtml) headers.set('Cache-Control', 'no-store');
  return headers;
}

/**
 * Types a browser will render as a scriptable document when navigated to
 * directly. Used to decide when a first-party claim needs checking at all.
 */
export function rendersAsDocument(contentType: string): boolean {
  const type = contentType.toLowerCase().split(';')[0].trim();
  return type === 'text/html' || type === 'image/svg+xml' || type === 'application/xhtml+xml' ||
    type === 'text/xml' || type === 'application/xml' || type.endsWith('+xml');
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

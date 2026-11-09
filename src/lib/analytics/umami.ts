/**
 * Pure helpers behind `UmamiTracker.svelte`: what may leave the browser, and
 * how a click is classified. No DOM, no globals — so it is unit-tested, and
 * vendored verbatim beside the tracker in SR-Health and SR-Drive.
 *
 * Why redaction exists at all: Umami stores every URL it is sent. Before this,
 * its database held capability URLs — install links, blog previews, shared
 * policy analyses, password-reset `?token=` values — i.e. working keys to
 * private things, in a store nobody treats as secret. Redaction keeps the
 * SHAPE of the URL (so `/install/:token` still counts as one page) and drops
 * the key.
 */

/** Query keys whose VALUE is a credential or a personal identifier. */
const SECRET_QUERY_KEYS = new Set([
  'token',
  't',
  's',
  'code',
  'key',
  'secret',
  'sig',
  'signature',
  'password',
  'pw',
  'invite',
  'auth',
  'state',
  'ticket',
  'access_token',
  'id_token',
  'refresh_token',
  'email',
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** An ordinary lowercase post or page slug: words joined by hyphens. */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;
const OPAQUE = /^[A-Za-z0-9_-]{20,}$/;

/** `:id` for a UUID, `:token` for any long opaque segment, else unchanged. */
export function redactSegment(segment: string): string {
  if (UUID.test(segment)) return ':id';
  if (OPAQUE.test(segment) && !SLUG.test(segment)) return ':token';
  return segment;
}

function redactParams(params: URLSearchParams): void {
  for (const key of [...new Set(params.keys())]) {
    if (SECRET_QUERY_KEYS.has(key.toLowerCase())) params.set(key, ':redacted');
  }
}

/**
 * Redact one URL as the tracker reports it (absolute, or a bare path).
 * Anchors (`#h-intro`, `#pn-casebook`) are kept — they say which section was
 * opened. A hash that carries `key=value` state (`#s=<share>`) is redacted
 * like a query string.
 */
export function redactUrl(raw: string | undefined | null): string | undefined {
  if (!raw) return raw ?? undefined;
  let url: URL;
  const relative = raw.startsWith('/');
  try {
    url = new URL(raw, 'https://placeholder.invalid');
  } catch {
    return raw;
  }
  url.pathname = url.pathname
    .split('/')
    .map((seg) => {
      try {
        return redactSegment(decodeURIComponent(seg));
      } catch {
        return redactSegment(seg);
      }
    })
    .join('/');
  redactParams(url.searchParams);
  if (url.hash.includes('=')) {
    const hashParams = new URLSearchParams(url.hash.slice(1));
    redactParams(hashParams);
    url.hash = hashParams.toString().replaceAll('%3Aredacted', ':redacted');
  }
  const out = url.toString().replaceAll('%3Aredacted', ':redacted').replaceAll('%3Aid', ':id').replaceAll('%3Atoken', ':token');
  return relative ? out.slice('https://placeholder.invalid'.length) : out;
}

/** The parts of a tracker payload that carry a URL. */
export type UmamiPayload = { url?: string; referrer?: string; [k: string]: unknown };

/** `data-before-send` hook: redact, never cancel. */
export function redactPayload<T extends UmamiPayload>(payload: T): T {
  if (!payload || typeof payload !== 'object') return payload;
  return { ...payload, url: redactUrl(payload.url), referrer: redactUrl(payload.referrer) };
}

const DOWNLOAD_EXT = /\.(pdf|zip|csv|xlsx?|docx?|pptx?|json|gpx|fit|mp3|mp4|mov|png|jpe?g|svg|webp|heic|ipa|dmg)$/i;

export type LinkClick =
  | { event: 'outbound-link'; data: { host: string; url: string } }
  | { event: 'download'; data: { file: string; ext: string } };

/**
 * Classify a clicked link. Outbound = a different host from the page's (and
 * www. is the same site). Download = a `download` attribute, a Drive file
 * route, or a file extension. Anything else is ordinary navigation, which the
 * pageview already records.
 */
export function classifyLink(href: string, pageHost: string, hasDownloadAttr: boolean): LinkClick | null {
  let url: URL;
  try {
    url = new URL(href, `https://${pageHost}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    if (url.protocol === 'mailto:' || url.protocol === 'tel:') {
      // Never the address itself: only that a contact link was used.
      return { event: 'outbound-link', data: { host: url.protocol.slice(0, -1), url: url.protocol } };
    }
    return null;
  }
  const bare = (h: string) => h.replace(/^www\./, '');
  if (bare(url.hostname) !== bare(pageHost)) {
    const clean = redactUrl(`${url.origin}${url.pathname}`) ?? url.origin;
    return { event: 'outbound-link', data: { host: url.hostname, url: clean.slice(0, 500) } };
  }
  const ext = url.pathname.match(DOWNLOAD_EXT)?.[1]?.toLowerCase();
  if (hasDownloadAttr || ext || /^\/api\/(drive\/)?files?\//.test(url.pathname)) {
    return { event: 'download', data: { file: redactUrl(url.pathname)?.slice(0, 300) ?? '', ext: ext ?? 'file' } };
  }
  return null;
}

/**
 * Pages an anonymous visit may be replayed on. Share-link pages are reachable
 * without signing in but are private by nature, so this is an allow-list, not
 * "everything a stranger can open".
 */
export function isReplayablePath(pathname: string): boolean {
  if (pathname === '/' || pathname === '/projects' || pathname === '/blog') return true;
  if (/^\/(welcome|rambler|privacy|terms|login)\/?$/.test(pathname)) return true;
  // A published post, never a preview.
  return /^\/blog\/(?!preview\/)[^/]+\/?$/.test(pathname);
}

/** What the server tells the tracker about the viewer: never an email. */
export type AnalyticsIdentity = { id: string; role: 'owner' | 'member' | 'guest' };

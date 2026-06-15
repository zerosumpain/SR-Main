/**
 * Pure helpers for extracting preview images from source artefact URLs.
 * No network calls — safe to use in unit tests without mocking.
 */

// ---------------------------------------------------------------------------
// SSRF guard
// ---------------------------------------------------------------------------

// Matches private/loopback/link-local IPv4 addresses.
// Covers: 127.0.0.0/8, 10.0.0.0/8, 192.168.0.0/16, 172.16.0.0/12,
//         169.254.0.0/16, and 0.0.0.0.
const PRIVATE_IP_RE =
  /^(127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|0\.0\.0\.0)$/;

/**
 * Returns true only if `raw` is a safe public http/https URL.
 * Rejects private/loopback IPs, *.local hostnames, localhost,
 * and any non-http(s) scheme.
 */
export function isSafeFetchUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;

  const host = parsed.hostname.toLowerCase();

  if (host === 'localhost') return false;
  if (host.endsWith('.local')) return false;
  if (host === '::1') return false;
  if (host === '[::1]') return false;

  // Strip brackets from IPv6 for the regex
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  if (bare === '::1') return false;

  if (PRIVATE_IP_RE.test(host)) return false;

  return true;
}

// ---------------------------------------------------------------------------
// HTML preview image extraction
// ---------------------------------------------------------------------------

/**
 * Extracts a single tag attribute value from raw HTML text.
 * Handles both attribute orders and both quote styles.
 * Returns the attribute value string or null.
 *
 * Strategy: build a regex that matches the full <meta …> or <link …> tag
 * and captures the target attribute value regardless of attribute order.
 */
function extractMetaContent(
  html: string,
  keyAttr: string,   // e.g. 'property'
  keyValue: string,  // e.g. 'og:image'
  valueAttr: string, // e.g. 'content'
): string | null {
  // Match either order: key first OR value first, both single & double quotes.
  const q = `["']`;

  // key=keyValue ... valueAttr=VALUE
  const fwd = new RegExp(
    `<(?:meta|link)[^>]*${keyAttr}=${q}${escapeRegex(keyValue)}${q}[^>]*${valueAttr}=${q}([^"']+)${q}`,
    'i',
  );
  // value first ... key=keyValue
  const rev = new RegExp(
    `<(?:meta|link)[^>]*${valueAttr}=${q}([^"']+)${q}[^>]*${keyAttr}=${q}${escapeRegex(keyValue)}${q}`,
    'i',
  );

  const m = fwd.exec(html) ?? rev.exec(html);
  return m ? m[1].trim() : null;
}

function extractLinkHref(html: string, relValue: string): string | null {
  const q = `["']`;
  const fwd = new RegExp(
    `<link[^>]*rel=${q}${escapeRegex(relValue)}${q}[^>]*href=${q}([^"']+)${q}`,
    'i',
  );
  const rev = new RegExp(
    `<link[^>]*href=${q}([^"']+)${q}[^>]*rel=${q}${escapeRegex(relValue)}${q}`,
    'i',
  );
  const m = fwd.exec(html) ?? rev.exec(html);
  return m ? m[1].trim() : null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function resolveUrl(candidate: string, baseUrl: string): string | null {
  try {
    const resolved = new URL(candidate, baseUrl);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return null;
    return resolved.href;
  } catch {
    return null;
  }
}

/**
 * Parses `html` for a preview image URL, in priority order:
 *   1. `<meta property="og:image" content="…">`
 *   2. `<meta name="twitter:image" content="…">` or `twitter:image:src`
 *   3. `<link rel="image_src" href="…">`
 *
 * Relative URLs are resolved against `baseUrl`.
 * Returns an absolute http/https URL or null.
 * No network calls are made.
 */
export function extractPreviewImage(html: string, baseUrl: string): string | null {
  // 1. og:image
  const og = extractMetaContent(html, 'property', 'og:image', 'content');
  if (og) return resolveUrl(og, baseUrl);

  // 2. twitter:image (name="twitter:image" or name="twitter:image:src")
  const tw =
    extractMetaContent(html, 'name', 'twitter:image', 'content') ??
    extractMetaContent(html, 'name', 'twitter:image:src', 'content');
  if (tw) return resolveUrl(tw, baseUrl);

  // 3. link rel="image_src"
  const ls = extractLinkHref(html, 'image_src');
  if (ls) return resolveUrl(ls, baseUrl);

  return null;
}

// ---------------------------------------------------------------------------
// Favicon fallback
// ---------------------------------------------------------------------------

/**
 * Returns the Google favicon service URL for the given page URL's hostname.
 * Never makes a network call.
 */
export function faviconFor(url: string): string {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    hostname = url;
  }
  return `https://www.google.com/s2/favicons?domain=${hostname}&sz=128`;
}

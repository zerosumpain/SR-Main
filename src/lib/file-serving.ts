// Response headers for every endpoint that streams stored bytes back to a
// browser — the drive download, the route-export capability link, and anything
// added later.
//
// Why this is shared rather than written out at each call site: the two
// endpoints that exist today had DIFFERENT header sets, and the weaker of the
// two was the one reachable with a stored, attacker-influenced MIME type. A
// security header that only some responses carry is the failure mode; one
// helper means they cannot drift apart again.
//
// The threat is specific. `POST /api/files/upload` stores `file.type` verbatim
// — the browser-supplied MIME, which the uploader controls — and the drive is
// not fed only by hand: workflow scrapes and jkai tools write into it too. The
// download endpoint then echoed that value back with `content-disposition:
// inline` whenever `?inline=1` was set. Fetch such a URL as a TOP-LEVEL
// DOCUMENT with a `text/html` or `image/svg+xml` type and it executes on
// strangeramblings.com, carrying the owner's session.
//
// (Worth being precise about the part that was never vulnerable: the drive grid
// renders thumbnails via `<img src=...?inline=1>`, and browsers do not run
// scripts in an SVG loaded through `<img>`. The grid was safe. Direct
// navigation to the same URL was not.)

/**
 * Types that may be rendered in place. Deliberately an explicit allow-list of
 * raster formats rather than an `image/*` prefix test: `image/svg+xml` matches
 * that prefix and is a scriptable document format.
 *
 * `?inline=1` is used in exactly one place today — the drive grid's `<img>`
 * thumbnails (src/routes/drive/+page.svelte) — and `content-disposition` has no
 * effect on `<img>` at all. So excluding SVG here costs nothing visible: an SVG
 * thumbnail still renders, it just also carries an attachment disposition for
 * anyone who navigates to it directly.
 */
const INLINE_SAFE_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/x-icon',
  'image/vnd.microsoft.icon',
]);

export function isInlineSafeMime(mimeType: string | null | undefined): boolean {
  return INLINE_SAFE_MIME.has(String(mimeType ?? '').toLowerCase().split(';')[0].trim());
}

export interface DownloadHeaderInput {
  mimeType: string | null | undefined;
  sizeBytes: number;
  /** Already reduced to a basename by the caller. */
  filename: string;
  /** What the caller WANTS. Downgraded to attachment unless the type is safe. */
  inline?: boolean;
}

/**
 * The header set every stored-bytes response must carry.
 *
 * - `content-security-policy: sandbox` is the real control. Applied to a
 *   response loaded as a document it drops the bytes into a unique opaque
 *   origin with scripting off, so even a `text/html` or SVG file cannot reach
 *   the session or the site origin. It is ignored for subresource loads, so
 *   `<img>` thumbnails are unaffected.
 * - `x-content-type-options: nosniff` stops the browser from disregarding the
 *   declared type and guessing something scriptable from the bytes.
 * - `cache-control: private, no-store` keeps Cloudflare and shared caches from
 *   retaining a copy of something owner-gated or capability-gated.
 */
export function downloadHeaders(input: DownloadHeaderInput): Record<string, string> {
  const inline = input.inline === true && isInlineSafeMime(input.mimeType);
  // A quote would end the filename token early and let the rest be read as
  // further disposition parameters; a newline would split the header.
  const filename = input.filename.replace(/["\\\r\n]/g, '');
  return {
    'content-type': input.mimeType || 'application/octet-stream',
    'content-length': String(input.sizeBytes),
    'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${filename}"`,
    'cache-control': 'private, no-store',
    'content-security-policy': 'sandbox',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  };
}

// $lib/server/ssrf-guard.ts
//
// SSRF guard for outbound fetches made on behalf of the model / nightly loop
// (`apis` toolset `api_call`, self-improvement live probes). Parses a URL,
// forces http/https, and refuses any host that is — or resolves to — a
// private / loopback / link-local / CGNAT address. Both literal-IP hosts and
// DNS-resolved addresses are checked (defence against a public name that
// points at an internal service).
//
// Precedent: the private-IP classifier in `$lib/jkai/extract/url.ts`. This
// module widens it with the CGNAT range (100.64.0.0/10) and exposes the
// single pinned entry point `assertPublicUrl` that Task 4 imports.

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** True if `ip` (a v4 or v6 literal) is in a private / loopback / link-local / CGNAT range. */
export function isBlockedIP(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0) return true; // 0.0.0.0/8 "this host"
    if (a === 10) return true; // 10/8 private
    if (a === 127) return true; // 127/8 loopback
    if (a === 169 && b === 254) return true; // 169.254/16 link-local
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 private
    if (a === 192 && b === 168) return true; // 192.168/16 private
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  if (v === 6) {
    // Strip any zone id (fe80::1%eth0) and lowercase.
    const lower = ip.toLowerCase().split('%')[0];
    if (lower === '::1' || lower === '::') return true; // loopback / unspecified
    if (lower.startsWith('::ffff:')) {
      // IPv4-mapped. NOTE the embedded address arrives in EITHER form:
      // a literal typed as `::ffff:127.0.0.1` keeps its dotted quad, but
      // `new URL()` normalises the hostname to hextets (`::ffff:7f00:1`) — and
      // that is the form every caller actually passes, since they read
      // `url.hostname`. Unwrapping only the dotted form left
      // `http://[::ffff:127.0.0.1]/` reaching loopback through every
      // SSRF-guarded path on the site (`isIP('7f00:1')` is 0, so the recursive
      // call fell through to "not blocked").
      const tail = lower.slice('::ffff:'.length);
      if (isIP(tail) === 4) return isBlockedIP(tail);
      const hextets = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(tail);
      if (hextets) {
        const hi = parseInt(hextets[1], 16);
        const lo = parseInt(hextets[2], 16);
        return isBlockedIP([hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join('.'));
      }
      // Some other mapped/translated shape we do not model — refuse rather
      // than fall through to "public".
      return true;
    }
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // fc00::/7 ULA
    // fe80::/10 link-local — first hextet fe80..febf.
    if (/^fe[89ab]/.test(lower)) return true;
    return false;
  }
  return false;
}

/**
 * Validate an outbound URL. Resolves to the parsed `URL` when it is safe to
 * fetch, otherwise throws `Error('ssrf_blocked: <reason>')`.
 *
 * - Only `http:` / `https:` are allowed.
 * - Literal private/loopback/link-local/CGNAT IPs are refused.
 * - Hostnames are DNS-resolved and refused if ANY resolved address is private.
 * - `localhost` and private DNS namespaces (`.internal`, `.local`, `.lan`,
 *   `.home`, `.intranet`, Tailscale `.ts.net`) are refused.
 *
 * Pass `{ allowInternal: true }` to skip the private-range checks entirely
 * (still enforces http/https) — used only by trusted internal callers.
 */
export async function assertPublicUrl(
  url: string,
  opts: { allowInternal?: boolean } = {},
): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`ssrf_blocked: not a valid URL (${url})`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`ssrf_blocked: only http/https URLs are allowed (got ${parsed.protocol})`);
  }
  if (opts.allowInternal) return parsed;

  // WHATWG URL keeps IPv6 literals bracketed in `.hostname` ([::1]) — strip
  // them so isIP()/DNS see the bare address.
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  const lower = host.toLowerCase();

  // Literal IP host — check directly, no DNS.
  if (isIP(host)) {
    if (isBlockedIP(host)) {
      throw new Error(`ssrf_blocked: refusing to fetch private IP ${host}`);
    }
    return parsed;
  }

  if (lower === 'localhost' || lower.endsWith('.localhost')) {
    throw new Error(`ssrf_blocked: refusing to fetch localhost (${host})`);
  }
  if (/\.(internal|local|lan|home|intranet)$/i.test(lower) || lower.endsWith('.ts.net')) {
    throw new Error(`ssrf_blocked: refusing to fetch private namespace (${host})`);
  }

  // Resolve the hostname and reject if any address is private.
  let records: Array<{ address: string; family: number }>;
  try {
    records = await lookup(host, { all: true });
  } catch {
    throw new Error(`ssrf_blocked: DNS lookup failed for ${host}`);
  }
  if (records.length === 0) {
    throw new Error(`ssrf_blocked: no DNS records for ${host}`);
  }
  for (const { address } of records) {
    if (isBlockedIP(address)) {
      throw new Error(`ssrf_blocked: ${host} resolves to private IP ${address}`);
    }
  }
  return parsed;
}

/**
 * Validate an outbound URL AND return the exact public IP the caller should
 * connect to. Callers must pin the socket to `address` (e.g. via an undici
 * dispatcher `lookup`) so a DNS rebind between validation and connect cannot
 * redirect the request to an internal host — the classic SSRF-guard TOCTOU.
 *
 * Throws `Error('ssrf_blocked: ...')` on any unsafe URL/host, same as
 * `assertPublicUrl`.
 */
export async function resolvePinnedUrl(
  url: string,
): Promise<{ url: URL; address: string; family: 4 | 6 }> {
  const parsed = await assertPublicUrl(url);
  const host = parsed.hostname.replace(/^\[|\]$/g, '');

  const literal = isIP(host);
  if (literal) return { url: parsed, address: host, family: literal as 4 | 6 };

  // Re-resolve and pick a still-public address to pin. assertPublicUrl already
  // rejected private results; this final re-check guards the pinned address.
  const records = await lookup(host, { all: true });
  for (const rec of records) {
    if (!isBlockedIP(rec.address)) {
      return { url: parsed, address: rec.address, family: (rec.family === 6 ? 6 : 4) as 4 | 6 };
    }
  }
  throw new Error(`ssrf_blocked: ${host} has no public address to pin`);
}

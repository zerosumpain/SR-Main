// src/lib/secrets/host-match.ts
//
// The host allow-list predicate, and NOTHING else.
//
// It lives in its own file purely so the browser can import it. `registry.ts`
// is server-only (node:crypto + the DB) and says so at the top, so the admin
// register used to carry a hand-written copy of this rule to decide which
// credentials to offer for a service's host. The copy drifted — it treated
// `*.example.com` as matching the apex `example.com`, which the real predicate
// refuses, so the register listed credentials under "bound to this host" that
// the server then refused at call time.
//
// One definition, imported by both sides. `registry.ts` re-exports these so
// server callers keep their existing import path.
//
// This is display-side convenience only: the decision that matters is still
// `assertBindingAllows` at call time, on every request and every redirect hop.

/** Strip the FQDN trailing dot and lower-case. `new URL()` has already punycoded. */
export function normaliseHost(host: string): string {
  return String(host ?? '').toLowerCase().replace(/\.+$/, '');
}

/**
 * Does `host` match an allow-list entry? Entries are either an exact host or a
 * `*.example.com` wildcard, which matches sub-domains ONLY (not the apex — an
 * owner who wants both lists both). A bare `*` is never accepted, so a secret
 * can never be host-unbound.
 */
export function hostMatchesPattern(host: string, pattern: string): boolean {
  const h = normaliseHost(host);
  const p = normaliseHost(String(pattern ?? '').trim());
  if (!h || !p || p === '*') return false;
  if (p.startsWith('*.')) {
    const suffix = p.slice(1); // '.example.com'
    // Dot-boundary suffix match: 'api.example.com' yes, 'notexample.com' no.
    return h.endsWith(suffix) && h.length > suffix.length;
  }
  return h === p;
}

export function hostAllowed(host: string, allowedHosts: string[]): boolean {
  return (allowedHosts ?? []).some((p) => hostMatchesPattern(host, p));
}

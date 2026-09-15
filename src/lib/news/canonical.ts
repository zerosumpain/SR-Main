// One key per article, so the same story on two wires is one row on the desk.
//
// PURE — no network, no DB, no `$lib` imports. The dedupe rule is the kind of
// thing that is wrong in ways only a table of examples catches, so it has to be
// testable without any of the machinery around it.
//
// The scheme is deliberately DROPPED rather than normalised. `http://` and
// `https://` versions of the same article are the same article, and a grouping
// key that says otherwise splits exactly the story two wires are most likely to
// have picked up from different places.

/**
 * Query parameters that identify where a click came from, never which article
 * it went to. Conservative on purpose: a parameter wrongly stripped MERGES two
 * different stories into one row, which is a worse failure than leaving a
 * duplicate on the desk, so anything ambiguous (`s`, `p`, `id`) stays.
 */
const TRACKING_PARAMS = new Set([
  '__twitter_impression',
  '_hsenc',
  '_hsmi',
  'at_campaign',
  'at_medium',
  'cmp',
  'cmpid',
  'dclid',
  'fbclid',
  'gclid',
  'guccounter',
  'guce_referrer',
  'guce_referrer_sig',
  'igshid',
  'mc_cid',
  'mc_eid',
  'msclkid',
  'ref',
  'ref_src',
  'referrer',
  'twclid',
  'yclid',
]);

function isTracking(name: string): boolean {
  const key = name.toLowerCase();
  return key.startsWith('utm_') || TRACKING_PARAMS.has(key);
}

/**
 * A stable grouping key for an article URL: `host/path?sorted-query`.
 *
 * Returns the input untouched when it will not parse — an unparseable URL is
 * still a fine group key for itself, and throwing here would take down a gather
 * over one malformed link.
 */
export function canonicalUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return raw.trim();
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return raw.trim();

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  // Trailing slashes are a publisher's CMS preference, not part of the article.
  // The root path keeps its slash so a bare domain is not reduced to the host.
  const path = parsed.pathname.replace(/\/+$/, '') || '/';

  const kept = [...parsed.searchParams.entries()]
    .filter(([name]) => !isTracking(name))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const query = kept.map(([name, value]) => `${name}=${value}`).join('&');

  return query ? `${host}${path}?${query}` : `${host}${path}`;
}

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { SEEDED_APIS } from './seed-apis';

// `ApiAuth` is declared TWICE — once in ./types for what a seed may say, and
// once inside $lib/workflows/site-tools/tools/apis.ts for what `resolveApiAuth`
// actually implements. Nothing links them, so a seed can name an auth kind the
// caller silently drops: the request goes out with no credential and comes back
// 401 with no diagnostic pointing at the mismatch.
//
// This nearly shipped. The Mapbox seed originally declared a `query-env` kind
// added only to the first union, which would have made every `api_call` against
// the catalogued entry fail with "No Token" and nothing to explain it.
const APIS_SOURCE = readFileSync('src/lib/workflows/site-tools/tools/apis.ts', 'utf8');

/** The kinds `resolveApiAuth` branches on, read from its source. */
function implementedKinds(): Set<string> {
  const resolver = APIS_SOURCE.slice(APIS_SOURCE.indexOf('async function resolveApiAuth'));
  const body = resolver.slice(0, resolver.indexOf('\nconst REDIRECT_STATUSES'));
  return new Set([...body.matchAll(/auth\.kind === '([a-z-]+)'/g)].map((m) => m[1]));
}

describe('seeded API auth', () => {
  it('only names auth kinds the caller actually implements', () => {
    const implemented = implementedKinds();
    // A sanity check on the parse itself — if this ever reads zero kinds the
    // assertion below would pass vacuously and guard nothing.
    expect(implemented.size).toBeGreaterThanOrEqual(3);

    for (const api of SEEDED_APIS) {
      const kind = api.auth?.kind ?? 'none';
      if (kind === 'none') continue;
      expect(implemented, `${api.name} declares auth kind "${kind}"`).toContain(kind);
    }
  });

  it('gives Mapbox the registry handle the client resolves', () => {
    const mapbox = SEEDED_APIS.find((a) => a.name === 'Mapbox');
    expect(mapbox).toBeDefined();
    expect(mapbox?.auth).toEqual({ kind: 'secret', handle: 'mapbox-api' });
    expect(mapbox?.baseUrl).toBe('https://api.mapbox.com');
  });

  it('points the catalogue at Search Box, not the POI-less geocoding endpoint', () => {
    // The example requests are what the model copies. Sending it to
    // /search/geocode/v6 would have it looking up landmarks against an endpoint
    // that has none.
    const mapbox = SEEDED_APIS.find((a) => a.name === 'Mapbox');
    const urls = (mapbox?.exampleRequests ?? []).map((r) => r.url).join(' ');
    expect(urls).toContain('/search/searchbox/v1/forward');
    expect(urls).not.toContain('/search/geocode/v6');
  });
});

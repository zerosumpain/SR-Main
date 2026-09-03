import type { RequestHandler } from './$types';
import { guardedPublicFetch } from '$lib/server/safe-fetch';
import { assertPublicRequestBudget } from '$lib/server/public-request-guard';

// Allowlist of safe domains to proxy — prevents abuse as an open proxy
const ALLOWED_DOMAINS = [
  'api.open-meteo.com',
  'restcountries.com',
  'api.frankfurter.app',
  'api.coindesk.com',
  'api.coingecko.com',
  'api.genderize.io',
  'api.nationalize.io',
  'api.agify.io',
  'earthquake.usgs.gov',
  'data.nasa.gov',
  'api.nasa.gov',
  'api.spacexdata.com',
  'api.exchangerate-api.com',
  'api.openweathermap.org',
  'api.publicapis.org',
  'catfact.ninja',
  'dog.ceo',
  'pokeapi.co',
  'swapi.dev',
  'api.dictionaryapi.dev',
  'api.quotable.io',
  'zenquotes.io',
  'official-joke-api.appspot.com',
  'collectionapi.metmuseum.org',
  'openlibrary.org',
  'en.wikipedia.org',
  'www.thecocktaildb.com',
  'www.themealdb.com',
  'api.thecatapi.com',
  'api.thedogapi.com',
  'newsdata.io',
  'hn.algolia.com',
  'hacker-news.firebaseio.com',
  'jsonplaceholder.typicode.com',
  'api.github.com',
  'api.chucknorris.io',
  'api.adviceslip.com',
  'worldtimeapi.org',
  'api.sunrise-sunset.org',
  'geocoding-api.open-meteo.com',
  'archive-api.open-meteo.com',
  'air-quality-api.open-meteo.com',
  'flood-api.open-meteo.com',
  'marine-api.open-meteo.com',
];

function isDomainAllowed(hostname: string): boolean {
  return ALLOWED_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d));
}

export const GET: RequestHandler = async (event) => {
  const { params, url: reqUrl } = event;
  assertPublicRequestBudget(event, {
    scope: 'jkai-cors', perClient: { capacity: 30, refillPerSecond: 30 / 60 },
    global: { capacity: 180, refillPerSecond: 180 / 60 },
  });
  const targetUrl = params.url;
  if (!targetUrl) {
    return new Response(JSON.stringify({ error: 'No URL provided' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Reconstruct full URL including query string
  let fullUrl: string;
  try {
    // The URL might be encoded or plain
    const decoded = decodeURIComponent(targetUrl);
    const parsed = new URL(decoded.startsWith('http') ? decoded : `https://${decoded}`);

    if (!isDomainAllowed(parsed.hostname)) {
      return new Response(JSON.stringify({ error: `Domain not allowed: ${parsed.hostname}` }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Preserve query params from the original request
    const originalParams = reqUrl.searchParams;
    for (const [key, value] of originalParams) {
      parsed.searchParams.set(key, value);
    }

    fullUrl = parsed.toString();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid URL' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const resp = await guardedPublicFetch(fullUrl, {
      timeoutMs: 8_000,
      maxBytes: 2 * 1024 * 1024,
      maxRedirects: 3,
      allowUrl: (candidate) => isDomainAllowed(candidate.hostname),
      headers: {
        'User-Agent': 'JKAI-Proxy/1.0',
        'Accept': 'application/json, text/plain, */*',
      },
    });

    return new Response(resp.body, {
      status: resp.status,
      headers: {
        'Content-Type': resp.headers.get('content-type') || 'application/octet-stream',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: `Proxy fetch failed: ${err}` }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

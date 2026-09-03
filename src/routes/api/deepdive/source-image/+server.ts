import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { extractPreviewImage, faviconFor } from '$lib/deepdive/og-image';
import { assertPublicUrl } from '$lib/server/ssrf-guard';
import { guardedPublicFetch } from '$lib/server/safe-fetch';

// ---------------------------------------------------------------------------
// In-memory cache — module-level, survives across requests in the same process.
// ---------------------------------------------------------------------------

interface CacheEntry {
  image: string;
  type: 'og' | 'favicon';
  ts: number;
}

const CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const FETCH_TIMEOUT_MS = 5_000;
const MAX_BODY_BYTES = 512 * 1024; // 512 KB

const USER_AGENT =
  'Mozilla/5.0 (compatible; StrangeRamblings/1.0; +https://strangeramblings.com)';

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const GET: RequestHandler = async ({ url }) => {
  const rawUrl = url.searchParams.get('url');

  if (!rawUrl) {
    return json({ error: 'Missing url parameter' }, { status: 400 });
  }

  try {
    await assertPublicUrl(rawUrl);
  } catch {
    return json({ error: 'Invalid or unsafe URL' }, { status: 400 });
  }

  // Cache hit?
  const cached = CACHE.get(rawUrl);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return json({ image: cached.image, type: cached.type });
  }

  // Cache miss — fetch, extract, fallback to favicon.
  const result = await fetchPreview(rawUrl);
  CACHE.set(rawUrl, { ...result, ts: Date.now() });

  return json({ image: result.image, type: result.type });
};

async function fetchPreview(pageUrl: string): Promise<{ image: string; type: 'og' | 'favicon' }> {
  try {
    const res = await guardedPublicFetch(pageUrl, {
      timeoutMs: FETCH_TIMEOUT_MS,
      maxBytes: MAX_BODY_BYTES,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
      },
    });

    if (!res.ok) {
      return { image: faviconFor(pageUrl), type: 'favicon' };
    }

    const html = new TextDecoder().decode(res.body);

    const image = extractPreviewImage(html, res.finalUrl);
    if (image) {
      return { image, type: 'og' };
    }

    return { image: faviconFor(pageUrl), type: 'favicon' };
  } catch {
    return { image: faviconFor(pageUrl), type: 'favicon' };
  }
}

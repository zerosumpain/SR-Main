import type { RequestHandler } from './$types';

/**
 * Decks (generated presentations) were retired on 2026-10-02. Old player,
 * share, print and editor links answer 410 Gone rather than 404 so a reader
 * holding a shared link learns the content was withdrawn, not mistyped.
 * The deck tables stay declared until their data is reviewed for removal.
 */
const gone: RequestHandler = () =>
  new Response('Decks have been retired from this site. This presentation is no longer available.\n', {
    status: 410,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'X-Robots-Tag': 'noindex',
    },
  });

export const GET = gone;
export const fallback = gone;

import { json, type RequestHandler } from '@sveltejs/kit';
import { callVerb, closeSession, isOnHomeserv } from '$lib/workflows/browser/session';

/**
 * homeserv's browser endpoint — the residential-IP half of the browser tools.
 *
 * Mirrors `/api/scraper/run`: production (a datacentre IP) proxies here over
 * Tailscale rather than driving a browser itself, because the bot-walls that
 * make a real browser worth having are exactly what a datacentre IP trips.
 *
 * Refuses to serve anywhere but homeserv, so a misconfigured BROWSER_SERVICE_URL
 * cannot quietly turn the VPS into the browser host.
 */
export const POST: RequestHandler = async ({ request }) => {
  if (!isOnHomeserv() && process.env.BROWSER_ALLOW_NON_HOMESERV !== '1') {
    return json(
      { ok: false, error: 'this endpoint only serves on homeserv (residential IP)' },
      { status: 503 },
    );
  }

  let body: { verb?: string; args?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid JSON body' }, { status: 400 });
  }

  const verb = (body.verb ?? '').trim();
  if (!verb) return json({ ok: false, error: 'verb is required' }, { status: 400 });

  try {
    if (verb === 'close') {
      await closeSession();
      return json({ ok: true, closed: true });
    }
    return json(await callVerb(verb, body.args ?? {}));
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : 'browser call failed' });
  }
};

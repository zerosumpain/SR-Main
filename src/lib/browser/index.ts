import { callVerb, closeSession, isOnHomeserv } from './session';

/**
 * Run a browser verb wherever the residential IP is.
 *
 * On homeserv: drive the local daemon. Anywhere else (production): proxy to
 * homeserv over Tailscale via BROWSER_SERVICE_URL, exactly as the scraper does
 * with SCRAPER_SERVICE_URL.
 *
 * Fails SOFT. A browser is a nice-to-have on a chat turn, so an unreachable
 * homeserv returns a result the model can read and work around, never an
 * exception that kills the turn. That is the same contract the reach probe gave
 * chat, applied one layer down.
 */

const PROXY_TIMEOUT_MS = 90_000;

export interface BrowserResult {
  ok: boolean;
  error?: string;
  [k: string]: unknown;
}

export async function runBrowserVerb(
  verb: string,
  args: Record<string, unknown> = {},
): Promise<BrowserResult> {
  if (isOnHomeserv() || process.env.BROWSER_ALLOW_NON_HOMESERV === '1') {
    try {
      if (verb === 'close') {
        await closeSession();
        return { ok: true, closed: true };
      }
      return (await callVerb(verb, args)) as BrowserResult;
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'browser call failed' };
    }
  }

  const url = process.env.BROWSER_SERVICE_URL;
  if (!url) {
    return {
      ok: false,
      error:
        'browsing runs on homeserv (residential IP) and BROWSER_SERVICE_URL is not configured here, so there is no browser to drive. Say so rather than pretending to have looked.',
    };
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.SCRAPER_SERVICE_TOKEN
          ? { Authorization: `Bearer ${process.env.SCRAPER_SERVICE_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({ verb, args }),
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
    });
    if (!res.ok) {
      return { ok: false, error: `browser service returned ${res.status}` };
    }
    return (await res.json()) as BrowserResult;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error';
    return {
      ok: false,
      error: `the browser on homeserv is unreachable (${msg}). It is the only host with a residential IP, so browsing is unavailable until it is back — say so rather than guessing at what a page says.`,
    };
  }
}

/**
 * interactive-remote.ts
 *
 * VPS-side helpers for driving an interactive VNC session on homeserv when
 * a stealth-scrape run hits a CAPTCHA / bot-wall / cookie-consent screen.
 *
 * The VNC session itself (headed Chromium + Xvfb + noVNC) runs on homeserv
 * so the browser talks to the target site from a residential IP. The VPS
 * only orchestrates: it spawns the remote session, writes a
 * `workflow_interactions` row pointing at homeserv's VNC port (so the
 * canvas UI shows the awaiting badge + noVNC modal), polls for the user to
 * resolve it, then stops the remote session so the profile directory is
 * free for the retry scrape.
 *
 * When this code itself is running ON homeserv (i.e. the canvas and the
 * scraper are colocated), `SCRAPER_SERVICE_URL` is unset and the helpers
 * transparently use the local interactive-session API.
 */

import type { InteractiveStartResult } from './interactive';

export interface RemoteInteractiveStartResult extends InteractiveStartResult {
  /** Host that owns this session — always "homeserv" today, but surfaced so
   *  the caller can hand it to the UI layer if we ever have multiple
   *  residential-IP hosts. */
  host: string;
}

function baseUrlFromServiceUrl(): string | null {
  const svc = process.env.SCRAPER_SERVICE_URL;
  if (!svc) return null;
  try {
    const u = new URL(svc);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

function authHeaders(): Record<string, string> {
  const token = process.env.SCRAPER_SERVICE_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Start a headed Chromium session on the scraper host (homeserv) bound to
 * the given profile + url. Transparently local when run on homeserv;
 * otherwise proxies to homeserv's `/api/scraper/interactive`.
 */
export async function startRemoteInteractiveSession(
  profile: string,
  url: string,
): Promise<RemoteInteractiveStartResult> {
  const baseUrl = baseUrlFromServiceUrl();
  if (!baseUrl) {
    // Local path — running on homeserv.
    const { startInteractiveSession } = await import('./interactive');
    const result = await startInteractiveSession(profile, url);
    return { ...result, host: 'homeserv' };
  }
  const res = await fetch(`${baseUrl}/api/scraper/interactive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ profile, url }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `interactive start proxy returned HTTP ${res.status}: ${text.slice(0, 300)}`,
    );
  }
  const body = (await res.json()) as InteractiveStartResult;
  return { ...body, host: 'homeserv' };
}

/**
 * Tear down a remote interactive session after the human has resolved the
 * CAPTCHA. Idempotent — safe to call even if the session is already gone.
 */
export async function stopRemoteInteractiveSession(sessionId: string): Promise<void> {
  const baseUrl = baseUrlFromServiceUrl();
  if (!baseUrl) {
    const { stopInteractiveSession } = await import('./interactive');
    await stopInteractiveSession(sessionId).catch(() => { /* idempotent */ });
    return;
  }
  await fetch(`${baseUrl}/api/scraper/interactive/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  }).catch(() => { /* idempotent */ });
}

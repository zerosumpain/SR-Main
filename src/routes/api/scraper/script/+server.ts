/**
 * GET    /api/scraper/script?profile=<p>  → { profile, code, meta } or { profile, code: null }
 * DELETE /api/scraper/script?profile=<p>  → { cleared: boolean }
 * POST   /api/scraper/script              → executes script-scrape dispatch
 *                                            on homeserv (run script if saved,
 *                                            else author one). Body shape in
 *                                            ScriptDispatchRequest below.
 *
 * Drives the StealthScrapePanel's "Script status" section, AND serves as the
 * VPS→homeserv proxy endpoint for script-scrape execution (so the warm
 * Playwright session + ~/.openclaw/scraper-scripts files stay on homeserv).
 */
import { json, error, type RequestHandler } from '@sveltejs/kit';
import { readScript, deleteScript } from '$lib/workflows/scraper/script-store';
import { runScript } from '$lib/workflows/scraper/script-runner';
import { runScriptAuthor } from '$lib/workflows/scraper/script-author';
import { assertScraperServiceRequest } from '$lib/workflows/scraper/service-auth';

function resolveProfile(url: URL): string {
  const p = url.searchParams.get('profile');
  if (!p) throw error(400, 'profile query param required');
  return p;
}

export const GET: RequestHandler = async ({ url, request }) => {
  const profile = resolveProfile(url);
  const remote = await maybeProxyToHomeserv('GET', profile, request);
  if (remote) return remote;
  const r = await readScript(profile);
  if (!r) return json({ profile, code: null, meta: null });
  return json({ profile, code: r.code, meta: r.meta });
};

export const DELETE: RequestHandler = async ({ url, request }) => {
  const profile = resolveProfile(url);
  const remote = await maybeProxyToHomeserv('DELETE', profile, request);
  if (remote) return remote;
  const cleared = await deleteScript(profile);
  return json({ profile, cleared });
};

/** When the SvelteKit instance handling the request is NOT homeserv,
 *  forward GET/DELETE to homeserv so the panel sees authoritative state.
 *  Returns null when running on homeserv (caller proceeds to local read). */
async function maybeProxyToHomeserv(method: 'GET' | 'DELETE', profile: string, original: Request): Promise<Response | null> {
  const { hostname } = await import('os');
  if (process.env.SCRAPER_ALLOW_NON_HOMESERV || hostname() === 'homeserv') return null;
  const base = process.env.SCRAPER_SERVICE_URL;
  if (!base) return null;
  const proxyUrl = base.replace(/\/api\/scraper\/run\/?$/, '') + `/api/scraper/script?profile=${encodeURIComponent(profile)}`;
  const token = process.env.SCRAPER_SERVICE_TOKEN;
  try {
    const r = await fetch(proxyUrl, {
      method,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    return new Response(await r.text(), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return json({ profile, code: null, meta: null, proxyError: e instanceof Error ? e.message : String(e) });
  }
}

export interface ScriptDispatchRequest {
  profile: string;
  seedUrl: string;
  goal?: string;
  searchQuery?: string;
  vars?: Record<string, string>;
  varsHint?: string[];
  workflowRunId?: string;
}

export interface ScriptDispatchResponse {
  handled: boolean;
  via: 'script' | 'script-author' | null;
  success: boolean;
  items: Array<Record<string, unknown>>;
  error?: string;
  landedUrl?: string;
  /** Only present when via === 'script-author': the freshly authored code so
   *  the caller can echo it back to the user. */
  code?: string;
}

export const POST: RequestHandler = async ({ request }) => {
  // homeserv-only enforcement + bearer auth — same protection as
  // /api/scraper/run. The whole point is to keep stealth work on
  // residential IPs.
  assertScraperServiceRequest(request);
  const body = (await request.json().catch(() => ({}))) as ScriptDispatchRequest;
  if (!body.profile) throw error(400, 'profile is required');
  if (!body.seedUrl) throw error(400, 'seedUrl is required');

  const existing = await readScript(body.profile);
  if (existing) {
    const r = await runScript({
      profile: body.profile,
      searchQuery: body.searchQuery,
      vars: body.vars,
      workflowRunId: body.workflowRunId,
    });
    return json({
      handled: true,
      via: 'script',
      success: r.success,
      items: r.items,
      error: r.error,
      landedUrl: r.landedUrl,
    } satisfies ScriptDispatchResponse);
  }
  if (body.goal) {
    const a = await runScriptAuthor({
      profile: body.profile,
      seedUrl: body.seedUrl,
      goal: body.goal,
      searchQuery: body.searchQuery,
      varsHint: body.varsHint,
      workflowRunId: body.workflowRunId,
    });
    return json({
      handled: true,
      via: 'script-author',
      success: a.saved,
      items: a.sampleItems,
      error: a.error,
      code: a.code,
    } satisfies ScriptDispatchResponse);
  }
  return json({
    handled: false,
    via: null,
    success: false,
    items: [],
  } satisfies ScriptDispatchResponse);
};

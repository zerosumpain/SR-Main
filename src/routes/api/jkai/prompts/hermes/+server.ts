import { json, error, type RequestHandler } from '@sveltejs/kit';
import { hostname } from 'os';
import { env } from '$env/dynamic/private';
import {
  readHermesPromptsLocal,
  saveHermesPromptLocal,
  isHermesPromptFile,
} from '$lib/jkai/prompts/hermes-store';

/**
 * Service endpoint for the Hermes prompt stack — the other side of the proxy in
 * $lib/jkai/prompts/hermes-store.ts. Hermes and its ~/.hermes-jkai/*.md files
 * live on homeserv, so the VPS-hosted /jkai/prompts workbench reaches them
 * through here over Tailscale.
 *
 * Guard mirrors $lib/workflows/scraper/service-auth.ts:
 *  1. homeserv-only — a misconfigured proxy chain must not loop back to the VPS
 *     and start writing prompt files there.
 *  2. Bearer SCRAPER_SERVICE_TOKEN when set (same host, same trust boundary as
 *     the scraper service endpoints, so it reuses that token rather than
 *     minting a second secret to keep in sync).
 */
function assertHomeservService(request: Request): void {
  if (hostname() !== 'homeserv' && env.HERMES_PROMPTS_LOCAL !== '1') {
    throw error(503, `Hermes prompt endpoints are served from homeserv only (host='${hostname()}').`);
  }
  const expected = env.SCRAPER_SERVICE_TOKEN;
  if (expected) {
    const auth = request.headers.get('authorization') ?? '';
    const supplied = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (supplied !== expected) throw error(401, 'Invalid or missing service token');
  }
}

export const GET: RequestHandler = async ({ request }) => {
  assertHomeservService(request);
  return json({ files: readHermesPromptsLocal() });
};

export const PUT: RequestHandler = async ({ request }) => {
  assertHomeservService(request);
  const body = (await request.json().catch(() => ({}))) as { name?: string; content?: string };
  if (!body.name || !isHermesPromptFile(body.name)) throw error(400, 'unknown prompt file');
  if (typeof body.content !== 'string') throw error(400, 'content must be a string');
  saveHermesPromptLocal(body.name, body.content);
  return json({ success: true });
};

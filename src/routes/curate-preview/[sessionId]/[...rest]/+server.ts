// Reverse-proxy to a per-session dev server.
//
// curate spawns a Vite dev server per session on a port from the curate pool
// (5180-5199). On the prod VPS those ports are not exposed via Cloudflare —
// they only listen on localhost. This proxy makes them reachable through the
// public site at /curate-preview/<sessionId>/<rest>, leveraging the existing
// auth gate on the SvelteKit app.
//
// Caveats:
//  - HTTP only. Vite's HMR WebSocket is not proxied; the user reloads the
//    preview tab to see regenerated code. v1 trade-off.
//  - The proxy strips Host on the way to the dev server; otherwise Vite's
//    HMR client thinks it's behind the wrong origin.

import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { getSession } from '$lib/curate/session-store';

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  // The Host header is stripped by node:fetch — leave it.
]);

async function proxy(event: Parameters<RequestHandler>[0]): Promise<Response> {
  const sessionId = event.params.sessionId!;
  const rest = event.params.rest ?? '';
  const session = await getSession(sessionId);
  if (!session) throw error(404, 'Unknown curate session');
  if (!session.devServerPort) throw error(409, 'Session has no dev server running');

  const target = `http://localhost:${session.devServerPort}/${rest}${event.url.search}`;

  const headers = new Headers();
  for (const [k, v] of event.request.headers) {
    if (!HOP_BY_HOP.has(k.toLowerCase())) headers.set(k, v);
  }

  // Body: forward as-is for methods that allow one. Use the original Request
  // body which is already a ReadableStream-friendly handle.
  const init: RequestInit = {
    method: event.request.method,
    headers,
    redirect: 'manual',
  };
  if (!['GET', 'HEAD'].includes(event.request.method)) {
    init.body = event.request.body;
    // Required when streaming a request body via fetch in Node.
    (init as RequestInit & { duplex: 'half' }).duplex = 'half';
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw error(502, `Curate dev server unreachable: ${msg}`);
  }

  const respHeaders = new Headers();
  for (const [k, v] of upstream.headers) {
    if (!HOP_BY_HOP.has(k.toLowerCase())) respHeaders.set(k, v);
  }

  return new Response(upstream.body, { status: upstream.status, headers: respHeaders });
}

export const GET: RequestHandler = (event) => proxy(event);
export const POST: RequestHandler = (event) => proxy(event);
export const PUT: RequestHandler = (event) => proxy(event);
export const PATCH: RequestHandler = (event) => proxy(event);
export const DELETE: RequestHandler = (event) => proxy(event);
export const OPTIONS: RequestHandler = (event) => proxy(event);
export const HEAD: RequestHandler = (event) => proxy(event);

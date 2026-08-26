// MCP entry point — hands a tool call to this host's local dispatcher.
//
// It used to be a ROUTING proxy. The Hermes gateway connected to exactly one MCP
// server, but a chat could originate on either homeserv or the VPS, and a tool
// had to write to the right Postgres — so the gateway's plugin stamped
// `params._meta.chat_id` on every call and this file looked the chat's origin up
// in `hermes_chat_origin` to decide where to forward.
//
// Nothing writes that table now, so the lookup could only ever miss and fall
// through to the local dispatcher. The forwarding machinery below is kept
// because the hop to `/api/mcp/local` still needs it: either leg restarts on
// deploy, and without the retry-and-hold that window returned a hard error to
// the client — whose observed response is not a visible failure but silently
// falling back to its own shell.

import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';

/**
 * Where to dispatch host-local traffic.
 *
 * Two wrong answers already, both verified on prod:
 *  - a hardcoded `http://127.0.0.1:5173/api/mcp/local` is homeserv's port, so on
 *    the VPS (serves :4173, sets no override) every request through this proxy
 *    failed with `TypeError: fetch failed` -> `{"message":"Internal Error"}`;
 *  - resolving against the request ORIGIN yields `https://strangeramblings.com`
 *    on the VPS, so the call hairpins out through cloudflared and back, which is
 *    unreachable from the box — the proxy held 30s and then errored.
 *
 * So mirror how each host actually picks its own port: homeserv's unit sets
 * PORT=5173; the VPS runs scripts/server-with-ws.mjs, which defaults to 4173 and
 * is given no PORT; the dev server serves 5173. Correct on all three, with no
 * env change (the VPS `.env` is chattr +i) and no network round-trip.
 */
const LOCAL_DISPATCH_PORT = env.PORT ?? (import.meta.env.DEV ? '5173' : '4173');
const LOCAL_DISPATCH_URL =
  env.JKAI_MCP_LOCAL_URL ?? `http://127.0.0.1:${LOCAL_DISPATCH_PORT}/api/mcp/local`;


/**
 * Methods with no side effects — safe to replay even if the request might have
 * reached the target. Anything else (notably `tools/call`) is retried ONLY when
 * the connection never landed, so a write tool is never run twice.
 */
function methodIsSideEffectFree(raw: string): boolean {
  try {
    const v = JSON.parse(raw);
    const m = Array.isArray(v) ? v[0]?.method : v?.method;
    return (
      m === 'initialize' ||
      m === 'ping' ||
      m === 'tools/list' ||
      (typeof m === 'string' && m.startsWith('notifications/'))
    );
  } catch {
    return false;
  }
}

/** A fetch failure that means nothing was executed on the far side. */
function isConnectionLevel(err: unknown): boolean {
  const cause = (err as { cause?: { code?: string } })?.cause;
  const code = cause?.code ?? '';
  return (
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'EHOSTUNREACH' ||
    code === 'ENETUNREACH' ||
    code === 'EPIPE' ||
    code === 'ETIMEDOUT' ||
    code === 'UND_ERR_SOCKET'
  );
}

// A restart of either leg takes a few seconds; holding the request turns that
// into latency instead of an error.
const FORWARD_HOLD_MS = 30_000;

async function forwardRaw(targetUrl: string, headers: Headers, body: string): Promise<Response> {
  // Forward the bearer + content-type. Everything else (cookies, X-Forwarded-*, etc.)
  // is stripped — this is server-to-server over Tailscale.
  const fwdHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
  const auth = headers.get('Authorization');
  if (auth) fwdHeaders['Authorization'] = auth;

  const deadline = Date.now() + FORWARD_HOLD_MS;
  const replayable = methodIsSideEffectFree(body);
  let attempt = 0;
  let resp: Response;
  for (;;) {
    attempt++;
    try {
      resp = await fetch(targetUrl, { method: 'POST', headers: fwdHeaders, body });
      break;
    } catch (err) {
      const retryable = isConnectionLevel(err) || replayable;
      if (!retryable || Date.now() >= deadline) {
        console.error(`[mcp-proxy] forward to ${targetUrl} failed after ${attempt} attempt(s):`, err);
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: {
              code: -32001,
              message:
                'jkai site tools are temporarily unavailable (the target host is restarting). Do NOT work ' +
                'around this — do not read credentials from files or the environment, do not hand-roll an ' +
                'API call, and do not guess. Tell the user and stop.',
            },
          }),
          { status: 503, headers: { 'Content-Type': 'application/json' } },
        );
      }
      await new Promise((r) => setTimeout(r, Math.min(250 * 2 ** (attempt - 1), 2_000)));
    }
  }
  // Preserve status and content-type from the upstream so JSON-RPC error
  // shapes round-trip cleanly.
  const respBody = await resp.text();
  return new Response(respBody, {
    status: resp.status,
    headers: { 'Content-Type': resp.headers.get('content-type') ?? 'application/json' },
  });
}

export const GET: RequestHandler = () => {
  return new Response('Method Not Allowed', {
    status: 405,
    headers: { Allow: 'POST, DELETE' },
  });
};

export const DELETE: RequestHandler = () => {
  return new Response('Method Not Allowed', { status: 405 });
};

export const POST: RequestHandler = async ({ request }) => {
  // The Authorization header rides along, so auth still applies downstream.
  return forwardRaw(LOCAL_DISPATCH_URL, request.headers, await request.text());
};

// MCP routing proxy — decides whether a tool call dispatches locally or
// forwards to a remote SvelteKit host based on the chat's origin.
//
// Phase 3 of docs/superpowers/plans/2026-05-14-hermes-multi-origin-routing.md.
//
// Hermes runs on homeserv and connects to ONE MCP server at this URL. But a
// chat can originate from either:
//
//   - homeserv SvelteKit (port 5173 — direct /jkai access on the LAN /
//     Tailscale) — tools must write to homeserv Postgres
//   - VPS SvelteKit (strangeramblings.com — production /jkai users) — tools
//     must write to VPS Postgres
//
// Hermes's MCP client doesn't natively distinguish origins. We solve this by:
//   1. The `jkai_platform` plugin captures `chat_id` from the gateway's
//      session contextvar and injects it via MCP `params._meta.chat_id`
//      on every tool call (see Phase 2).
//   2. The `_meta.chat_id` value lands in this proxy's request body.
//   3. This proxy looks up the chat's origin in `hermes_chat_origin`
//      (upserted by the plugin on inbound) and forwards the JSON-RPC to
//      either `/api/mcp/local` here, or `<vps mcp_url>` on strangeramblings.com.
//
// For handshake traffic (initialize, ping, notifications/*) or any request
// without a `_meta.chat_id`, the proxy short-circuits to the local dispatcher —
// no forwarding overhead on the hot startup path. Note this is a ROUTING
// decision, not an auth one: `forwardRaw` passes the Authorization header
// through verbatim, and the dispatcher gates tools/list and tools/call on it.

import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { db } from '$lib/db';
import { hermesChatOrigin } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

// Where to dispatch host-local traffic. The env var wins; otherwise resolve
// against the INCOMING request's own origin rather than a hardcoded port. The
// previous default (`http://127.0.0.1:5173/api/mcp/local`) is homeserv's dev
// port, so on the VPS — which serves :4173 and does not set the env var — every
// request through this proxy failed with `TypeError: fetch failed` surfacing as
// `{"message":"Internal Error"}`. Verified on prod 2026-07-26.
function localDispatchUrl(requestUrl: URL): string {
  return env.JKAI_HERMES_MCP_LOCAL_URL ?? new URL('/api/mcp/local', requestUrl.origin).href;
}

// Per-process LRU cache for chat_id → origin lookups. The proxy lookup is
// keyed by primary key and runs once per tool call; cache because a chat
// can fire many tools in quick succession.
const ORIGIN_CACHE_MAX = 1000;
const ORIGIN_CACHE_TTL_MS = 5 * 60 * 1000;
type CacheEntry = { mcpUrl: string; expiresAt: number };
const originCache = new Map<string, CacheEntry>();

function readCache(chatId: string): string | null {
  const hit = originCache.get(chatId);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) {
    originCache.delete(chatId);
    return null;
  }
  // Refresh LRU position.
  originCache.delete(chatId);
  originCache.set(chatId, hit);
  return hit.mcpUrl;
}

function writeCache(chatId: string, mcpUrl: string): void {
  if (originCache.size >= ORIGIN_CACHE_MAX) {
    const oldest = originCache.keys().next().value;
    if (oldest !== undefined) originCache.delete(oldest);
  }
  originCache.set(chatId, { mcpUrl, expiresAt: Date.now() + ORIGIN_CACHE_TTL_MS });
}

async function lookupMcpUrl(chatId: string): Promise<string | null> {
  const cached = readCache(chatId);
  if (cached) return cached;
  const [row] = await db
    .select({ mcpUrl: hermesChatOrigin.mcpUrl })
    .from(hermesChatOrigin)
    .where(eq(hermesChatOrigin.chatId, chatId))
    .limit(1);
  if (!row) return null;
  writeCache(chatId, row.mcpUrl);
  return row.mcpUrl;
}

// Best-effort extraction of `params._meta.chat_id` from the raw body. We
// avoid throwing on malformed JSON — that case is the local dispatcher's
// problem to surface as a 400.
function extractChatId(raw: string): string | null {
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v)) {
      for (const entry of v) {
        const cid = entry?.params?._meta?.chat_id;
        if (typeof cid === 'string' && cid) return cid;
      }
      return null;
    }
    const cid = v?.params?._meta?.chat_id;
    return typeof cid === 'string' && cid ? cid : null;
  } catch {
    return null;
  }
}

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

// A restart of either leg (homeserv on deploy, the VPS on CI deploy) takes a few
// seconds. Without this, that window returned a hard error to Hermes — and the
// observed consequence is not a visible failure but jkai silently falling back to
// its own shell. Holding the request turns a restart into latency.
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

export const POST: RequestHandler = async ({ request, url }) => {
  const raw = await request.text();
  const chatId = extractChatId(raw);
  const LOCAL_DISPATCH_URL = localDispatchUrl(url);

  // No chat context (initialize, ping, tools/list, etc.) → straight to local.
  // The Authorization header rides along, so auth still applies downstream.
  if (!chatId) return forwardRaw(LOCAL_DISPATCH_URL, request.headers, raw);

  const mcpUrl = await lookupMcpUrl(chatId);
  if (!mcpUrl) {
    // chat_id present but unknown — likely a chat that started before the
    // plugin began recording origins, or a stale cache miss. Fall back to
    // local; this matches the pre-Phase-3 behaviour.
    return forwardRaw(LOCAL_DISPATCH_URL, request.headers, raw);
  }

  return forwardRaw(mcpUrl, request.headers, raw);
};

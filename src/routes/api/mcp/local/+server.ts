// MCP Streamable HTTP transport endpoint — host-local tool dispatch.
//
// This file used to live at `/api/mcp/+server.ts` and serve as the single
// MCP endpoint Hermes connects to. Phase 3 of the Hermes multi-origin
// routing work (docs/superpowers/plans/2026-05-14-hermes-multi-origin-routing.md)
// relocated the actual tool-dispatch code here so the path at `/api/mcp`
// could be repurposed as a routing proxy that decides — based on the
// chat_id Hermes injects via `params._meta` — whether to dispatch locally
// (here) or forward to the VPS-side equivalent.
//
// Hermes' MCP client (Python `mcp` SDK ≥ 1.24) speaks JSON-RPC 2.0 over the
// Streamable HTTP transport per the MCP spec (2025-03-26). The wire-format
// logic lives in $lib/mcp/jsonrpc; this file maps Request → dispatchJsonRpc.
//
// Auth model:
//   - initialize, ping, notifications/*                → unauthenticated
//   - tools/list, tools/call                           → Authorization: Bearer
//                                                        <SERVICE_BRIDGE_SECRET>
// tools/list was opened up historically and closed again 2026-07-25: this route
// bypasses the Auth.js gate as service-to-service traffic, so an open catalogue
// meant anyone who could POST here could enumerate every tool and its schema.
//
// Stateless: no Mcp-Session-Id, no session tracking, no server-initiated SSE.

import type { RequestHandler } from './$types';
import { dispatchJsonRpc, parseJsonRpcBody } from '$lib/mcp/jsonrpc';

export const GET: RequestHandler = () => {
  return new Response('Method Not Allowed', {
    status: 405,
    headers: { Allow: 'POST, DELETE' },
  });
};

export const DELETE: RequestHandler = () => {
  return new Response('Method Not Allowed', { status: 405 });
};

function extractBearer(authHeader: string | null): string {
  if (!authHeader) return '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

export const POST: RequestHandler = async ({ request }) => {
  const authBearer = extractBearer(request.headers.get('Authorization'));
  const raw = await request.text();
  const parsed = parseJsonRpcBody(raw);
  if (!parsed.ok) {
    return new Response(JSON.stringify(parsed.error), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (Array.isArray(parsed.value)) {
    const responses = [];
    for (const entry of parsed.value) {
      const result = await dispatchJsonRpc(entry, { authBearer });
      if (result.response) responses.push(result.response);
    }
    if (responses.length === 0) {
      return new Response(null, { status: 202 });
    }
    return new Response(JSON.stringify(responses), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const result = await dispatchJsonRpc(parsed.value, { authBearer });
  if (!result.response) {
    return new Response(null, { status: 202 });
  }
  return new Response(JSON.stringify(result.response), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

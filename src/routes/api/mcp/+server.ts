// MCP Streamable HTTP transport endpoint.
//
// Hermes' MCP client (Python `mcp` SDK ≥ 1.24) speaks JSON-RPC 2.0 over the
// Streamable HTTP transport per the MCP spec (2025-03-26). The previous
// hand-rolled GET/POST shape rejected Hermes' `initialize` probe with 403,
// because it required a Bridge-Token header that the MCP discovery flow
// quite reasonably doesn't send.
//
// The wire-format logic lives in $lib/mcp/jsonrpc; this file is the SvelteKit
// adapter that maps Request → dispatchJsonRpc(...) → Response.
//
// Auth model:
//   - initialize, tools/list, ping, notifications/*   → unauthenticated
//   - tools/call                                       → Authorization: Bearer
//                                                        <HERMES_BRIDGE_SECRET>
//                                                        (constant-time compare;
//                                                        scope binding happens at
//                                                        the tool layer)
//
// Stateless: we don't issue Mcp-Session-Id, don't track sessions, and don't
// open server-initiated SSE streams. Single POST → single response.

import type { RequestHandler } from './$types';
import { dispatchJsonRpc, parseJsonRpcBody } from '$lib/mcp/jsonrpc';

// Server-initiated SSE (the GET branch of the Streamable HTTP spec) is
// optional — clients MUST handle a 405 here and fall back to POST-only.
// Hermes' client does. Returning 405 keeps the surface honest about what
// we actually do.
export const GET: RequestHandler = () => {
  return new Response('Method Not Allowed', {
    status: 405,
    headers: { Allow: 'POST, DELETE' },
  });
};

// Stateless mode: there are no sessions to delete, but the spec says clients
// MAY send DELETE on shutdown; we acknowledge with 405 (per spec, this means
// "the server does not allow clients to terminate sessions" — accurate here
// since we don't have any to terminate).
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

  // The spec also permits a JSON-RPC batch (array) of requests/notifications.
  // Hermes' SDK does not currently batch the initialize handshake, and our
  // single-request path covers everything Hermes sends today. Handle batch
  // by dispatching each entry and concatenating responses; pure-notification
  // batches still collapse to 202.
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
    // Pure notification (no id) — spec requires 202 Accepted with no body.
    return new Response(null, { status: 202 });
  }
  return new Response(JSON.stringify(result.response), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

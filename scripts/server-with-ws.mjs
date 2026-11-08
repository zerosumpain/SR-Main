/**
 * Production adapter-node entry with graceful listener shutdown.
 *
 * Session input uses the normal SvelteKit POST endpoint and output uses SSE.
 * Do not add an `upgrade` listener here: HTTP upgrades bypass SvelteKit's
 * Auth.js/owner gate, and checking merely for the presence of a cookie is not
 * authentication. The obsolete WebSocket bridge was removed after that exact
 * bypass was verified against production.
 */
import http from 'node:http';
// Policy documents allow 10 MB plus multipart metadata. Keep an operator's
// explicit limit; adapter-node must read the default before its module loads.
process.env.BODY_SIZE_LIMIT ??= '12M';
const { handler } = await import('../build/handler.js');

const PORT = Number(process.env.PORT ?? 4173);
const HOST = process.env.HOST ?? '0.0.0.0';

/**
 * POST /oauth/token is the OpenID provider's server-to-server leg
 * ($lib/server/oidc/provider): Immich's server posts a form there with no
 * Origin header. SvelteKit's CSRF check 403s any form POST whose Origin is not
 * the site's own — missing included — and it runs before hooks.server.ts, so
 * the route cannot opt out. CSRF is a cookie problem, and this endpoint reads
 * no cookie (the client secret, sealed code and PKCE verifier are the
 * credentials), so on EXACTLY this method and path the site's own origin is
 * stamped on and cookies are removed. Every other request is untouched.
 */
function oidcTokenRequest(req) {
  if (req.method !== 'POST') return;
  const url = req.url ?? '';
  const q = url.indexOf('?');
  if ((q === -1 ? url : url.slice(0, q)) !== '/oauth/token') return;
  let origin = '';
  if (process.env.ORIGIN) {
    try { origin = new URL(process.env.ORIGIN).origin; } catch { origin = ''; }
  } else {
    // adapter-node's own rule when ORIGIN is unset.
    const proto = (process.env.PROTOCOL_HEADER && String(req.headers[process.env.PROTOCOL_HEADER.toLowerCase()] ?? '')) || 'https';
    const host = (process.env.HOST_HEADER && String(req.headers[process.env.HOST_HEADER.toLowerCase()] ?? '')) || req.headers.host;
    if (host && !proto.includes(':')) origin = `${proto}://${host}`;
  }
  if (!origin) return;
  req.headers.origin = origin;
  delete req.headers.cookie;
}

const server = http.createServer((req, res) => {
  oidcTokenRequest(req);
  return handler(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`Listening on http://${HOST}:${PORT}`);
});

/**
 * Stop accepting work on the way down.
 *
 * hooks.server.ts drains the workflow engine on SIGTERM and then calls
 * process.exit(0), but it holds no handle on this server — so nothing ever
 * closed the listening socket, and every restart severed whatever requests and
 * SSE streams were open. cloudflared sees that as the origin resetting the
 * connection and returns 502, which is why restarts showed up as gateway errors
 * rather than as a brief blip.
 *
 * Closing the listener refuses new connections immediately, so the supervisor
 * can bring the replacement up, while requests already being served run to
 * completion inside the drain window. `closeIdleConnections` is the other half:
 * without it, a pooled keep-alive connection that cloudflared is about to reuse
 * stays open just long enough to be picked, then dies mid-request.
 */
let closing = false;
function closeServer() {
  if (closing) return;
  closing = true;
  server.close(() => console.log('[server] listener closed'));
  server.closeIdleConnections?.();
}

process.on('SIGTERM', closeServer);
process.on('SIGINT', closeServer);

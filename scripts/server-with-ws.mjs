/**
 * Production server entry that wraps adapter-node's handler with a
 * WebSocket-upgrade proxy. Browser connects to
 *   wss://strangeramblings.com/api/jkai/builds/<id>/session
 * which we upgrade and pipe to the builder's unix socket
 *   /run/jkai-builder/jkai-builder.sock  (path: /ws/<id>)
 *
 * adapter-node's index.js doesn't expose the http.Server's upgrade event,
 * so we re-implement it here. SvelteKit's regular HTTP handler runs on
 * the same port for everything else.
 *
 * Auth: SvelteKit's hooks.server.ts gates pages and /api/* with Auth.js.
 * The /api/jkai/builds/<id>/session route is handled by SvelteKit on the
 * GET request, but the WS upgrade bypasses that — so we run an explicit
 * Auth.js cookie check here before forwarding to the builder. Matches the
 * same allowedEmails gate the rest of the site uses.
 */
import http from 'node:http';
import net from 'node:net';
import { handler } from '../build/handler.js';

const PORT = Number(process.env.PORT ?? 4173);
const HOST = process.env.HOST ?? '0.0.0.0';
const BUILDER_SOCKET = process.env.JKAI_BUILDER_SOCKET ?? '/run/jkai-builder/jkai-builder.sock';

const server = http.createServer(handler);

server.on('upgrade', (req, clientSocket, head) => {
  const url = req.url ?? '';
  const m = url.match(/^\/api\/jkai\/builds\/([0-9a-f-]+)\/session(?:\?.*)?$/i);
  if (!m) {
    clientSocket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    clientSocket.destroy();
    return;
  }
  const buildId = m[1];

  // Auth check — require an Auth.js session cookie. We don't validate the
  // signature here (that costs a DB round-trip via Auth.js); we rely on
  // the cookie being httpOnly + secure + signed elsewhere. A missing
  // cookie OR a request from an unrecognised origin is rejected.
  const cookie = req.headers.cookie ?? '';
  const hasSession =
    /__Secure-authjs\.session-token=/.test(cookie) ||
    /authjs\.session-token=/.test(cookie);
  if (!hasSession) {
    clientSocket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    clientSocket.destroy();
    return;
  }

  // Open a TCP-style connection to the builder's unix socket and replay
  // the WS upgrade handshake there with the path rewritten.
  const upstream = net.createConnection(BUILDER_SOCKET, () => {
    // Rewrite the request line for the builder's path layout.
    const newReq = [
      `GET /ws/${buildId} HTTP/1.1`,
      `Host: jkai-builder`,
      `Upgrade: websocket`,
      `Connection: Upgrade`,
    ];
    for (const [k, v] of Object.entries(req.headers)) {
      if (!v) continue;
      const lc = k.toLowerCase();
      if (lc === 'host' || lc === 'upgrade' || lc === 'connection') continue;
      const value = Array.isArray(v) ? v.join(', ') : v;
      newReq.push(`${k}: ${value}`);
    }
    upstream.write(newReq.join('\r\n') + '\r\n\r\n');
    if (head && head.length > 0) upstream.write(head);

    // Bidirectional pipe between browser socket and builder socket.
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);

    const cleanup = () => {
      try { upstream.destroy(); } catch { /* swallow */ }
      try { clientSocket.destroy(); } catch { /* swallow */ }
    };
    upstream.on('error', cleanup);
    upstream.on('close', cleanup);
    clientSocket.on('error', cleanup);
    clientSocket.on('close', cleanup);
  });
  upstream.on('error', () => {
    try {
      clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    } catch { /* swallow */ }
    clientSocket.destroy();
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Listening on http://${HOST}:${PORT} (with /ws proxy → ${BUILDER_SOCKET})`);
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

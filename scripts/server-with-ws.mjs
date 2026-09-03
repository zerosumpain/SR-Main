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
import { handler } from '../build/handler.js';

const PORT = Number(process.env.PORT ?? 4173);
const HOST = process.env.HOST ?? '0.0.0.0';
const server = http.createServer(handler);

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

/**
 * jkai-builder entry point. Binds a Unix domain socket and serves a tiny
 * HTTP API. Phase 1: only /health is exposed. Phase 2 onwards: orchestrator
 * sessions move here.
 *
 * Run via `node packages/jkai-builder/dist/start.js` (compiled by esbuild).
 */
import { startServer } from '../src/server';

// Socket path resolution, in order:
//   1. JKAI_BUILDER_SOCKET (explicit override — set by the systemd unit)
//   2. $XDG_RUNTIME_DIR/jkai-builder.sock (interactive shell + user services)
//   3. /run/jkai-builder/jkai-builder.sock (system service via RuntimeDirectory)
const xdg = process.env.XDG_RUNTIME_DIR;
const sock =
  process.env.JKAI_BUILDER_SOCKET ??
  (xdg ? `${xdg}/jkai-builder.sock` : '/run/jkai-builder/jkai-builder.sock');

startServer(sock).catch((err) => {
  console.error('[jkai-builder] failed to start:', err);
  process.exit(1);
});

/**
 * jkai-builder entry point. Binds a Unix domain socket and serves a tiny
 * HTTP API. Phase 1: only /health is exposed. Phase 2 onwards: orchestrator
 * sessions move here.
 *
 * Run via `node packages/jkai-builder/dist/start.js` (compiled by esbuild).
 */
import { startServer } from '../src/server';

const sock =
  process.env.JKAI_BUILDER_SOCKET ??
  `${process.env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid?.() ?? 1000}`}/jkai-builder.sock`;

startServer(sock).catch((err) => {
  console.error('[jkai-builder] failed to start:', err);
  process.exit(1);
});

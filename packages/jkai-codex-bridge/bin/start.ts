/**
 * jkai-codex-bridge — standalone entry point.
 *
 * Puts an OpenAI-compatible HTTP face on the Codex CLI so the site
 * can spend John's ChatGPT Pro subscription instead of per-token OpenRouter
 * credit. See ../README.md for why this is a separate process rather than an
 * import inside the SvelteKit app.
 *
 * Launch:
 *   1. Build once:  node packages/jkai-codex-bridge/build.mjs
 *   2. Log in once: codex login --device-auth
 *   3. Run:         node packages/jkai-codex-bridge/dist/start.js
 *
 * Env:
 *   CODEX_BRIDGE_PORT         listen port (default 5207)
 *   CODEX_BRIDGE_HOST         bind address (default 127.0.0.1 — see below)
 *   CODEX_BRIDGE_CONCURRENCY  max concurrent codex subprocesses (default 3)
 *   CODEX_BRIDGE_TIMEOUT_MS   per-request backstop (default 600000)
 *   CODEX_BRIDGE_WORKDIR      the agent's empty scratch dir
 */
import { createBridgeServer } from '../src/server';

const PORT = Number(process.env.CODEX_BRIDGE_PORT || 5207);

/**
 * Loopback by default and it should stay that way.
 *
 * This endpoint takes an arbitrary prompt and answers it against John's
 * subscription with no authentication of its own — the only credential in play
 * is the OAuth token this process holds. Bound to anything routable it is an
 * open, unauthenticated LLM that bills to his account and burns his weekly
 * quota. Both hosts that run it (homeserv and the VPS) already have the
 * consumer in the same process namespace, so loopback is sufficient.
 */
const HOST = process.env.CODEX_BRIDGE_HOST || '127.0.0.1';

const server = createBridgeServer();

server.listen(PORT, HOST, () => {
  console.log(`[codex-bridge] listening on http://${HOST}:${PORT}`);
  if (HOST !== '127.0.0.1' && HOST !== 'localhost') {
    console.warn(
      `[codex-bridge] WARNING: bound to ${HOST}, not loopback. This endpoint has no auth of its own — anyone who can reach it can spend the ChatGPT subscription.`,
    );
  }
});

const shutdown = (sig: string) => {
  console.log(`[codex-bridge] received ${sig} — closing`);
  server.close(() => process.exit(0));
  // Don't let an in-flight multi-minute Codex run hold the restart open.
  setTimeout(() => process.exit(0), 10_000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

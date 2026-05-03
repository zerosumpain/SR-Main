/**
 * jkai-builder entry point. Binds a Unix domain socket and serves a tiny
 * HTTP API. Phase 1: only /health is exposed. Phase 2 onwards: orchestrator
 * sessions move here.
 *
 * Run via `node packages/jkai-builder/dist/start.js` (compiled by esbuild).
 */
import { startServer } from '../src/server';
import { orchestrator } from '$lib/jkai/orchestrator';

// Socket path resolution, in order:
//   1. JKAI_BUILDER_SOCKET (explicit override — set by the systemd unit)
//   2. $XDG_RUNTIME_DIR/jkai-builder.sock (interactive shell + user services)
//   3. /run/jkai-builder/jkai-builder.sock (system service via RuntimeDirectory)
const xdg = process.env.XDG_RUNTIME_DIR;
const sock =
  process.env.JKAI_BUILDER_SOCKET ??
  (xdg ? `${xdg}/jkai-builder.sock` : '/run/jkai-builder/jkai-builder.sock');

async function main(): Promise<void> {
  // Bind the socket FIRST so the SvelteKit web app's RPC client doesn't
  // ECONNREFUSED while we recover. The orchestrator's recovery scan can
  // take a few hundred ms.
  await startServer(sock);

  // Phase 3: this process is now the authoritative owner of build state.
  // recoverOnStartup picks up `running`/`paused` rows whose previous owner
  // (the SvelteKit web app, pre-phase-3) died with the build still in
  // flight, and either resumes them or marks them failed if they're truly
  // abandoned.
  try {
    await orchestrator.recoverOnStartup();
    console.log('[jkai-builder] orchestrator recovery complete');
  } catch (err) {
    console.error('[jkai-builder] recovery failed:', err);
    // Don't exit — recovery failure shouldn't take down the RPC surface.
  }
}

main().catch((err) => {
  console.error('[jkai-builder] failed to start:', err);
  process.exit(1);
});

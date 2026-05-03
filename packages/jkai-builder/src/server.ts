/**
 * Unix-socket HTTP server for jkai-builder.
 *
 * Phase 1 surface — observation only:
 *   GET /health   → {ok, activeBuilds, pid, startedAt, uptimeMs}
 *
 * Phase 2+ will add session HTTP + WebSocket endpoints that the SvelteKit app
 * proxies into. Keeping the surface area minimal here so the deploy/restart
 * machinery can stabilise before any behaviour moves over.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { unlinkSync, existsSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { mkdir } from 'node:fs/promises';

const startedAt = new Date().toISOString();
const startedAtMs = Date.now();

interface HealthBody {
  ok: true;
  service: 'jkai-builder';
  pid: number;
  startedAt: string;
  uptimeMs: number;
  /** Phase 1: always 0. Phase 2 wires real session count. */
  activeBuilds: number;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function handle(req: IncomingMessage, res: ServerResponse): void {
  // Health probe — also doubles as the systemd watchdog target.
  if (req.method === 'GET' && (req.url === '/health' || req.url === '/')) {
    const body: HealthBody = {
      ok: true,
      service: 'jkai-builder',
      pid: process.pid,
      startedAt,
      uptimeMs: Date.now() - startedAtMs,
      activeBuilds: 0,
    };
    sendJson(res, 200, body);
    return;
  }

  sendJson(res, 404, { ok: false, error: 'not_found', method: req.method, url: req.url });
}

export async function startServer(socketPath: string): Promise<void> {
  // Ensure runtime dir exists. XDG_RUNTIME_DIR is created by systemd-logind
  // for user sessions, but be defensive in case the unit runs before linger
  // initialised it.
  await mkdir(dirname(socketPath), { recursive: true }).catch(() => {});

  // Stale socket from a previous unclean shutdown blocks bind() with EADDRINUSE.
  // Safe to unlink because we own this path (per-user).
  if (existsSync(socketPath)) {
    try { unlinkSync(socketPath); } catch (e) {
      console.warn(`[jkai-builder] could not remove stale socket ${socketPath}:`, (e as Error).message);
    }
  }

  const server = createServer(handle);

  server.on('error', (err) => {
    console.error('[jkai-builder] server error:', err);
    process.exit(1);
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(socketPath, (err?: Error) => err ? reject(err) : resolve());
  });

  // Owner-only — the SvelteKit app runs as the same user, no need to widen.
  try { chmodSync(socketPath, 0o600); } catch { /* non-fatal */ }

  console.log(`[jkai-builder] listening on ${socketPath} (pid=${process.pid})`);

  // Graceful shutdown — flush + unlink so the next start binds cleanly.
  const shutdown = (signal: string) => {
    console.log(`[jkai-builder] received ${signal}, shutting down`);
    server.close(() => {
      try { unlinkSync(socketPath); } catch { /* swallow */ }
      process.exit(0);
    });
    // Hard-stop after 5s if close() hangs on long-lived connections (Phase 2+
    // will have WS sockets that need explicit drain; for now, no clients).
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

/**
 * jkai WhatsApp worker — owns the WhatsApp session, off homeserv.
 *
 * WhatsApp does not need a residential IP, so it does not belong on homeserv.
 * It does not belong in the web app either: a deploy restarts that process, and
 * restarting it drops the socket. So it gets its own process, like the builder
 * and the Codex bridge.
 *
 * It serves a small HTTP contract — /health, /qr, /send, /typing, /send-media —
 * so the site delegates to it by pointing `WHATSAPP_BRIDGE_URL` at it and
 * changing nothing else.
 *
 * The unit sets JKAI_SERVICE_ROLE=whatsapp, which does two things
 * ($lib/workflows/service-role): this process runs the WhatsApp socket and NOT
 * the scheduler — two schedulers on one database fires every cron twice — and
 * it is never itself "delegated", so it cannot forward its sends to itself.
 */
import http from 'node:http';

// Set before any import that reads it, so the role is in force during module
// init rather than after it.
process.env.JKAI_SERVICE_ROLE = 'whatsapp';

// 3110, not 3100: on the VPS 3100 is held by a long-running `bun` process, and
// the first deploy of this worker crash-looped on EADDRINUSE because of it.
// Override with WA_WORKER_PORT — set it in the .env rather than the unit file,
// because ci-apply-sidecars.sh reinstalls units from the repo on every deploy
// and would revert a unit edit.
const DEFAULT_PORT = 3110;
const PORT = Number(process.env.WA_WORKER_PORT ?? DEFAULT_PORT);
const HOST = process.env.WA_WORKER_HOST ?? '127.0.0.1';

type Service = {
  getState(): { status: string; qrCode?: string | null; connectedNumber?: string | null };
  sendMessage(to: string, text: string): Promise<{ sent: boolean; messageId?: string; error?: string }>;
  sendAttachment?(to: string, att: unknown, caption?: string): Promise<{ sent: boolean; messageId?: string; error?: string }>;
  sendTyping?(to: string): Promise<void>;
};

async function main(): Promise<void> {
  const { getWhatsAppService } = await import('$lib/workflows/whatsapp/service');
  const wa = getWhatsAppService() as unknown as Service;

  // Importing the workflows barrel boots WhatsApp for this role. Give it a
  // moment, then surface the QR — the only part of this that needs a human.
  await import('$lib/workflows');

  let lastQr: string | null = null;
  const watchQr = setInterval(() => {
    const s = wa.getState();
    if (s.qrCode && s.qrCode !== lastQr) {
      lastQr = s.qrCode;
      console.log('\n[wa-worker] PAIRING REQUIRED — scan this in WhatsApp › Linked devices:');
      console.log(`[wa-worker] QR: ${s.qrCode}\n`);
    }
    if (s.status === 'connected' && lastQr) {
      lastQr = null;
      console.log(`[wa-worker] connected as ${s.connectedNumber ?? 'unknown'}`);
    }
  }, 1000);
  watchQr.unref?.();

  const json = (res: http.ServerResponse, code: number, body: unknown) => {
    const s = JSON.stringify(body);
    res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(s) });
    res.end(s);
  };
  const readBody = (req: http.IncomingMessage): Promise<Record<string, unknown>> =>
    new Promise((resolve) => {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); } });
    });

  const server = http.createServer(async (req, res) => {
    const path = (req.url ?? '').split('?')[0];
    try {
      if (req.method === 'GET' && path === '/health') {
        const s = wa.getState();
        // The shape the site's health probe already expects.
        return json(res, 200, { status: s.status, connectedNumber: s.connectedNumber ?? null, queueLength: 0 });
      }
      if (req.method === 'GET' && path === '/qr') {
        const s = wa.getState();
        return json(res, 200, { status: s.status, qr: s.qrCode ?? null });
      }
      if (req.method === 'POST' && path === '/send') {
        const b = await readBody(req);
        const chatId = String(b.chatId ?? '');
        const message = String(b.message ?? '');
        if (!chatId || !message) return json(res, 400, { error: 'chatId and message are required' });
        const r = await wa.sendMessage(chatId, message);
        if (!r.sent) return json(res, 502, { error: r.error ?? 'send failed' });
        return json(res, 200, { messageId: r.messageId ?? null });
      }
      if (req.method === 'POST' && path === '/typing') {
        const b = await readBody(req);
        await wa.sendTyping?.(String(b.chatId ?? ''));
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && path === '/send-media') {
        // Deliberately not implemented rather than silently accepting: the old
        // bridge took a `filePath` that never existed on its own filesystem, so
        // VPS-originated media sends have never worked. Failing loudly is the
        // improvement; making it work is its own change.
        return json(res, 501, {
          error: 'media sends are not implemented by the worker yet — send text, or attach via the site',
        });
      }
      return json(res, 404, { error: 'not found' });
    } catch (err) {
      return json(res, 500, { error: err instanceof Error ? err.message : 'worker error' });
    }
  });

  // Say what is wrong and what to do about it. Without this, a taken port
  // surfaces as an unhandled 'error' event — a raw Node stack trace, repeated
  // every five seconds by systemd's Restart=on-failure, with nothing naming the
  // actual problem. That is how the first deploy of this worker presented.
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `[wa-worker] port ${PORT} on ${HOST} is already in use, so the worker cannot start.\n` +
          `[wa-worker] Find the holder with:  sudo ss -lntp | grep :${PORT}\n` +
          `[wa-worker] Then set WA_WORKER_PORT to a free port in the app's .env (NOT the systemd\n` +
          `[wa-worker] unit — deploys reinstall units from the repo and would revert it).`,
      );
    } else {
      console.error(`[wa-worker] server error: ${err.message}`);
    }
    process.exit(1);
  });

  server.listen(PORT, HOST, () => {
    console.log(`[wa-worker] listening on ${HOST}:${PORT} (role=${process.env.JKAI_SERVICE_ROLE})`);
  });
}

main().catch((err) => {
  console.error('[wa-worker] failed to start:', err);
  process.exit(1);
});

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { createHash, timingSafeEqual } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { connect as connectTcp } from 'node:net';
import { createServer as createHttpServer, request as httpRequest } from 'node:http';

type Session = {
  context: BrowserContext;
  page: Page;
  lastTouched: number;
};

const CAP = 6;
const IDLE_MS = 5 * 60 * 1000;
const RENDER_TIMEOUT_MS = 15_000;
const PORT = Number(process.env.PORT ?? 3000);
const SERVICE_TOKEN = process.env.WEBFRAME_SERVICE_TOKEN ?? '';
const PROXY_PORT = 3128;

const sessions = new Map<string, Session>();
let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = await chromium.launch({
      headless: true,
      chromiumSandbox: true,
      proxy: { server: `http://127.0.0.1:${PROXY_PORT}` },
    });
  }
  return browser;
}

async function getOrCreateSession(id: string): Promise<Page> {
  const existing = sessions.get(id);
  if (existing) {
    existing.lastTouched = Date.now();
    return existing.page;
  }
  if (sessions.size >= CAP) {
    throw new Error('queue-full');
  }
  const b = await getBrowser();
  const context = await b.newContext({ viewport: { width: 1200, height: 800 } });
  // Validate the main document, every redirect, and every subresource. This
  // stops a public page from pivoting Chromium into loopback/RFC1918/metadata
  // endpoints after the app-side URL check has passed.
  await context.route('**/*', async (route) => {
    try {
      await assertPublicUrl(route.request().url());
      await route.continue();
    } catch {
      await route.abort('blockedbyclient');
    }
  });
  const page = await context.newPage();
  sessions.set(id, { context, page, lastTouched: Date.now() });
  return page;
}

async function reapIdleSessions() {
  const cutoff = Date.now() - IDLE_MS;
  for (const [id, s] of sessions) {
    if (s.lastTouched < cutoff) {
      try { await s.context.close(); } catch {}
      sessions.delete(id);
    }
  }
}
setInterval(() => { void reapIdleSessions(); }, 30_000);

const app = new Hono();

app.get('/health', (c) => c.json({ ok: true, activeSessions: sessions.size }));

app.use('*', async (c, next) => {
  if (!SERVICE_TOKEN) return c.text('service unavailable', 503);
  const auth = c.req.header('authorization') ?? '';
  const supplied = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const expectedHash = createHash('sha256').update(SERVICE_TOKEN).digest();
  const suppliedHash = createHash('sha256').update(supplied).digest();
  if (!supplied || !timingSafeEqual(expectedHash, suppliedHash)) return c.text('unauthorized', 401);
  await next();
});

app.get('/render', async (c) => {
  const target = c.req.query('url');
  const session = c.req.query('session');
  if (!target || !session) return c.text('url, session required', 400);
  if (!/^[a-f0-9]{64}$/.test(session)) return c.text('invalid session', 400);
  try { await assertPublicUrl(target); } catch { return c.text('invalid or unsafe url', 400); }
  try {
    const page = await getOrCreateSession(session);
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: RENDER_TIMEOUT_MS });
    const html = await page.content();
    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'queue-full') return c.text('queue-full', 503);
    return c.text('render-failed: ' + msg, 502);
  }
});

app.post('/event', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { session, kind, payload } = body as { session?: string; kind?: string; payload?: Record<string, unknown> };
  if (!session || !kind) return c.text('session, kind required', 400);
  const s = sessions.get(session);
  if (!s) return c.text('no-session', 404);
  s.lastTouched = Date.now();
  try {
    if (kind === 'click') {
      const x = Number(payload?.x ?? 0);
      const y = Number(payload?.y ?? 0);
      await s.page.mouse.click(x, y);
    } else if (kind === 'input') {
      const text = String(payload?.text ?? '');
      await s.page.keyboard.type(text);
    } else if (kind === 'key') {
      const key = String(payload?.key ?? '');
      if (key) await s.page.keyboard.press(key);
    } else if (kind === 'scroll') {
      const dy = Number(payload?.dy ?? 0);
      await s.page.evaluate((d) => window.scrollBy(0, d), dy);
    } else {
      return c.text('unknown kind: ' + kind, 400);
    }
    return c.json({ ok: true });
  } catch (err) {
    return c.text('event-failed: ' + (err instanceof Error ? err.message : String(err)), 502);
  }
});

app.get('/html', async (c) => {
  const session = c.req.query('session');
  if (!session) return c.text('session required', 400);
  const s = sessions.get(session);
  if (!s) return c.text('no-session', 404);
  s.lastTouched = Date.now();
  const html = await s.page.content();
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
});

app.post('/close', async (c) => {
  const { session } = (await c.req.json().catch(() => ({}))) as { session?: string };
  if (!session) return c.text('session required', 400);
  const s = sessions.get(session);
  if (s) {
    try { await s.context.close(); } catch {}
    sessions.delete(session);
  }
  return c.json({ ok: true });
});

serve({ fetch: app.fetch, port: PORT });
console.log(`[webframe] listening on :${PORT}`);

async function shutdown() {
  for (const [, s] of sessions) {
    try { await s.context.close(); } catch {}
  }
  sessions.clear();
  if (browser) await browser.close().catch(() => {});
  await new Promise<void>((resolve) => egressProxy.close(() => resolve()));
  process.exit(0);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

function blockedIp(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (isIP(address) === 6) {
    const ip = address.toLowerCase().split('%')[0];
    return ip === '::' || ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') ||
      /^fe[89ab]/.test(ip) || ip.startsWith('::ffff:');
  }
  return true;
}

async function resolvePublicHost(hostname: string): Promise<{ address: string; family: 4 | 6 }> {
  const normalized = hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (
    normalized === 'localhost' || normalized.endsWith('.localhost') ||
    /\.(internal|local|lan|home|intranet|ts\.net)$/.test(normalized)
  ) throw new Error('private hostname');
  if (isIP(normalized)) {
    if (blockedIp(normalized)) throw new Error('private address');
    return { address: normalized, family: isIP(normalized) as 4 | 6 };
  }
  const records = await lookup(normalized, { all: true });
  if (!records.length || records.some((record) => blockedIp(record.address))) {
    throw new Error('private DNS answer');
  }
  const selected = records[0];
  return { address: selected.address, family: selected.family as 4 | 6 };
}

async function assertPublicUrl(raw: string): Promise<void> {
  const parsed = new URL(raw);
  if (parsed.protocol === 'data:' || parsed.protocol === 'blob:') return;
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('scheme blocked');
  const port = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));
  if (port !== 80 && port !== 443) throw new Error('destination port blocked');
  await resolvePublicHost(parsed.hostname);
}

/**
 * Chromium's own resolver would otherwise reopen a DNS-rebinding window after
 * the route check. Force every browser connection through a tiny local proxy:
 * it resolves and validates each destination, then connects to that exact IP.
 */
const egressProxy = createHttpServer((request, response) => {
  void (async () => {
    const target = new URL(request.url ?? '');
    if (target.protocol !== 'http:') throw new Error('proxy scheme blocked');
    const port = Number(target.port || 80);
    if (port !== 80) throw new Error('proxy port blocked');
    const pinned = await resolvePublicHost(target.hostname);
    const upstream = httpRequest({
      hostname: pinned.address,
      family: pinned.family,
      port,
      method: request.method,
      path: target.pathname + target.search,
      headers: { ...request.headers, host: target.host },
      timeout: RENDER_TIMEOUT_MS,
    }, (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    });
    upstream.on('timeout', () => upstream.destroy(new Error('proxy timeout')));
    upstream.on('error', () => {
      if (!response.headersSent) response.writeHead(502);
      response.end();
    });
    request.pipe(upstream);
  })().catch(() => {
    response.writeHead(403);
    response.end();
  });
});

egressProxy.on('connect', (request, clientSocket, head) => {
  void (async () => {
    const authority = new URL(`http://${request.url ?? ''}`);
    const port = Number(authority.port || 443);
    if (port !== 443) throw new Error('tunnel port blocked');
    const pinned = await resolvePublicHost(authority.hostname);
    const upstream = connectTcp({ host: pinned.address, family: pinned.family, port });
    upstream.setTimeout(RENDER_TIMEOUT_MS, () => upstream.destroy(new Error('tunnel timeout')));
    upstream.once('connect', () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.once('error', () => clientSocket.destroy());
    clientSocket.once('error', () => upstream.destroy());
  })().catch(() => clientSocket.destroy());
});

egressProxy.listen(PROXY_PORT, '127.0.0.1');

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

type Session = {
  context: BrowserContext;
  page: Page;
  lastTouched: number;
};

const CAP = 6;
const IDLE_MS = 5 * 60 * 1000;
const RENDER_TIMEOUT_MS = 15_000;
const PORT = Number(process.env.PORT ?? 3000);

const sessions = new Map<string, Session>();
let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
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

app.get('/render', async (c) => {
  const target = c.req.query('url');
  const session = c.req.query('session');
  if (!target || !session) return c.text('url, session required', 400);
  try { new URL(target); } catch { return c.text('invalid url', 400); }
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
  process.exit(0);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

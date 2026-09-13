import { afterEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import { ExtractedAppError, getFromExtracted } from './extracted-app';

const servers: http.Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
  delete process.env.HEALTH_SERVICE_TOKEN;
});

function stub(handler: http.RequestListener): Promise<number> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    servers.push(server);
    server.listen(0, '127.0.0.1', () => resolve((server.address() as import('node:net').AddressInfo).port));
  });
}

describe('calling an extracted application', () => {
  it('sends the canonical Host, which is the whole reason this is not fetch', async () => {
    // The gateway 400s any Host but its own, and undici silently drops a Host
    // header — a fetch to 127.0.0.1 arrives as host: 127.0.0.1:<port>. If this
    // assertion ever fails, every service-lane call becomes a 400.
    process.env.HEALTH_SERVICE_TOKEN = 'x'.repeat(64);
    let seen: http.IncomingHttpHeaders | undefined;
    const port = await stub((req, res) => {
      seen = req.headers;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });

    await getFromExtracted('health', '/api/health/context', { port });
    expect(seen?.host).toBe('strangeramblings.com');
    expect(seen?.authorization).toBe(`Bearer ${'x'.repeat(64)}`);
  });

  it('returns the parsed body', async () => {
    process.env.HEALTH_SERVICE_TOKEN = 'x'.repeat(64);
    const port = await stub((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"strap":"Steady","days":[]}');
    });
    await expect(getFromExtracted('health', '/x', { port })).resolves.toEqual({
      strap: 'Steady',
      days: [],
    });
  });

  it('throws on a non-200 rather than returning a body the caller would render', async () => {
    process.env.HEALTH_SERVICE_TOKEN = 'x'.repeat(64);
    const port = await stub((_req, res) => {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end('{"error":"health series unavailable"}');
    });
    await expect(getFromExtracted('health', '/x', { port })).rejects.toThrow(/returned 503/);
  });

  it('throws when the lane is not configured, instead of calling unauthenticated', async () => {
    // An unauthenticated call only 401s. Failing here says why.
    const port = await stub((_req, res) => res.end('{}'));
    await expect(getFromExtracted('health', '/x', { port })).rejects.toThrow(
      /HEALTH_SERVICE_TOKEN is not set/,
    );
  });

  it('times out rather than holding a page render open', async () => {
    process.env.HEALTH_SERVICE_TOKEN = 'x'.repeat(64);
    const port = await stub(() => {
      /* never responds */
    });
    await expect(
      getFromExtracted('health', '/x', { port, timeoutMs: 60 }),
    ).rejects.toThrow(ExtractedAppError);
  });

  it('throws on a 200 that is not JSON', async () => {
    process.env.HEALTH_SERVICE_TOKEN = 'x'.repeat(64);
    const port = await stub((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<!doctype html><title>Sign in</title>');
    });
    await expect(getFromExtracted('health', '/x', { port })).rejects.toThrow(/did not return JSON/);
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPreviewGateway } from '../../scripts/development-preview-gateway.mjs';
import { signPreviewAccess, verifyPreviewAccess } from '../../scripts/development-preview-access.mjs';

const secret = 'test-only-preview-secret-with-at-least-32-characters';
const claim = () => ({ buildId: 'gateway-test', port: 5281, revision: 'a'.repeat(40), expires: Date.now() + 60000 });
let dir: string, gateway: http.Server, upstream: http.Server, port: number;
const listen = (server: http.Server) => new Promise<number>(resolve => server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port)));
const request = (path = '/', headers: Record<string, string> = {}, method = 'GET') => new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
  const req = http.request({ hostname: '127.0.0.1', port, path, method, headers: { host: 'preview-5281.example.test', ...headers } }, res => {
    let body = ''; res.on('data', c => body += c); res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body }));
  }); req.on('error', reject); req.end();
});
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sr-gateway-'));
  await writeFile(join(dir, 'gateway-test-preview.json'), JSON.stringify({ port: 5281, revision: 'a'.repeat(40) }));
  upstream = http.createServer((req, res) => { res.setHeader('set-cookie', 'production=poison; Domain=example.test'); res.end(JSON.stringify(req.headers)); });
  const upstreamPort = await listen(upstream);
  gateway = createPreviewGateway({ secret, receiptRoot: dir, domain: 'example.test', upstreamHost: '127.0.0.1', upstreamPort: () => upstreamPort });
  port = await listen(gateway);
});
afterAll(async () => { await Promise.all([gateway, upstream].map(server => new Promise<void>(resolve => server.close(() => resolve())))); await rm(dir, { recursive: true }); });
describe('production preview access boundary', () => {
  it('rejects altered, expired and malformed capabilities', () => {
    const token = signPreviewAccess(secret, claim());
    expect(verifyPreviewAccess(secret, token)).toMatchObject({ port: 5281 });
    expect(verifyPreviewAccess(secret, token + 'x')).toBeNull();
    expect(verifyPreviewAccess(secret, token, Date.now() + 120000)).toBeNull();
    expect(() => signPreviewAccess(secret, { ...claim(), buildId: '../batch' })).toThrow();
    expect(() => signPreviewAccess(secret, { ...claim(), port: 4173 })).toThrow();
  });
  it('denies anonymous requests and capabilities presented to another preview host', async () => {
    expect((await request()).status).toBe(401);
    const token = signPreviewAccess(secret, claim());
    expect((await request(`/?__sr_grant=${token}`, { host: 'preview-5282.example.test' })).status).toBe(401);
  });
  it('exchanges the grant for an HttpOnly host cookie and removes it from the URL', async () => {
    const result = await request(`/?__sr_grant=${signPreviewAccess(secret, claim())}`);
    expect(result.status).toBe(303); expect(result.headers.location).toBe('/');
    expect(result.headers['set-cookie']![0]).toContain('HttpOnly; Secure; SameSite=Strict; Path=/');
    expect(result.headers['referrer-policy']).toBe('no-referrer');
  });
  it('strips production credentials and candidate cookie writes at the boundary', async () => {
    const cookie = `__Host-sr-development=${signPreviewAccess(secret, claim())}; authjs.session-token=production-secret`;
    const result = await request('/some-route', { cookie, authorization: 'Bearer production-secret' });
    expect(result.status).toBe(200); const forwarded = JSON.parse(result.body);
    expect(forwarded.cookie).toBeUndefined(); expect(forwarded.authorization).toBeUndefined();
    expect(result.headers['set-cookie']).toBeUndefined(); expect(result.headers['cache-control']).toContain('no-store');
    expect((await request('/', { cookie, origin: 'https://example.test' }, 'POST')).status).toBe(403);
  });
  it('revokes access when the slot is closed or replaced with another revision', async () => {
    const cookie = `__Host-sr-development=${signPreviewAccess(secret, claim())}`;
    await writeFile(join(dir, 'gateway-test-preview.json'), '{}');
    expect((await request('/', { cookie })).status).toBe(401);
  });
});

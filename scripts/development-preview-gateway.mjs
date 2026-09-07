/** Trusted HTTPS-tunnel ingress. Only isolated candidate traffic passes this boundary. */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyPreviewAccess } from './development-preview-access.mjs';
const COOKIE = '__Host-sr-development';

export function createPreviewGateway({ secret, receiptRoot, domain, upstreamHost, upstreamPort = p => p }) {
  if (!secret || secret.length < 32 || !/^[a-z0-9.-]+$/.test(domain)) throw new Error('Preview gateway configuration is required');
  const hostPort = host => {
    for (let port = 5281; port <= 5288; port++) if (host === `preview-${port}.${domain}`) return port;
    return null;
  };
  const authorize = async (req, token) => {
    const claim = verifyPreviewAccess(secret, token);
    if (!claim || hostPort(req.headers.host) !== claim.port) return null;
    const receipt = JSON.parse(await readFile(join(receiptRoot, `${claim.buildId}-preview.json`), 'utf8').catch(() => '{}'));
    return receipt.revision === claim.revision && receipt.port === claim.port ? claim : null;
  };
  const cookieToken = req => (req.headers.cookie ?? '').split(';').map(v => v.trim()).find(v => v.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  const safeHeaders = req => {
    const headers = { ...req.headers, 'x-forwarded-proto': 'https', 'x-forwarded-host': req.headers.host };
    delete headers.cookie; delete headers.authorization; delete headers['proxy-authorization'];
    return headers;
  };
  const responseHeaders = reply => {
    const headers = { ...reply.headers, 'cache-control': 'private, no-store', 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex, nofollow' };
    // A proposed site cannot set cookies on the production parent domain.
    delete headers['set-cookie'];
    return headers;
  };
  const deny = res => { res.writeHead(401, { 'content-type': 'text/plain', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }); res.end('Open or refresh this preview from the owner Development workspace.'); };
  const server = http.createServer(async (req, res) => {
    try {
      if (!hostPort(req.headers.host) || !req.url?.startsWith('/') || req.url.startsWith('//')) return deny(res);
      const url = new URL(req.url, `https://${req.headers.host}`);
      const grant = url.searchParams.get('__sr_grant');
      if (grant) {
        const claim = req.method === 'GET' && await authorize(req, grant);
        if (!claim) return deny(res);
        res.writeHead(303, { location: '/', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer',
          'set-cookie': `${COOKIE}=${grant}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${Math.floor((claim.expires - Date.now()) / 1000)}` });
        return res.end();
      }
      const claim = await authorize(req, cookieToken(req));
      if (!claim) return deny(res);
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin !== `https://${req.headers.host}`) { res.writeHead(403); return res.end('Preview origin mismatch'); }
      const upstream = http.request({ hostname: upstreamHost, port: upstreamPort(claim.port), path: req.url, method: req.method, headers: safeHeaders(req) }, reply => {
        res.writeHead(reply.statusCode, responseHeaders(reply)); reply.pipe(res);
      });
      upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('Preview is starting; refresh shortly.'); });
      req.pipe(upstream);
    } catch { if (!res.headersSent) res.writeHead(502); res.end('Preview unavailable'); }
  });
  server.on('upgrade', async (req, socket, head) => {
    try {
      const claim = await authorize(req, cookieToken(req));
      if (!claim || req.headers.origin !== `https://${req.headers.host}`) { socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); return; }
      const upstream = http.request({ hostname: upstreamHost, port: upstreamPort(claim.port), path: req.url, headers: safeHeaders(req) });
      upstream.on('upgrade', (reply, remote, remainder) => {
        socket.write(`HTTP/1.1 ${reply.statusCode} ${reply.statusMessage}\r\n`);
        for (const [key, value] of Object.entries(responseHeaders(reply))) socket.write(`${key}: ${value}\r\n`);
        socket.write('\r\n'); if (remainder.length) socket.write(remainder); if (head.length) remote.write(head);
        socket.pipe(remote).pipe(socket); remote.on('error', () => socket.destroy()); socket.on('error', () => remote.destroy());
      });
      upstream.on('error', () => socket.destroy()); upstream.on('response', () => socket.destroy()); upstream.end();
    } catch { socket.destroy(); }
  });
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createPreviewGateway({ secret: process.env.BUILDER_PREVIEW_ACCESS_SECRET, receiptRoot: '/var/lib/development-broker', domain: process.env.BUILDER_PREVIEW_DOMAIN, upstreamHost: process.env.BUILDER_DOCKER_HOSTNAME ?? 'development-docker' }).listen(5289, '0.0.0.0');
}

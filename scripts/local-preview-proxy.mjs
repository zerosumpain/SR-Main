// Local preview only: authenticate against the isolated database, never production.
import http from 'node:http';
import { encode } from '/workspace/node_modules/@auth/core/jwt.js';

let session;
let secureSession;
let renewedAt = 0;
async function headers(req) {
  if (!session || Date.now() - renewedAt > 3600000) {
    session = await encode({
      secret: process.env.AUTH_SECRET,
      salt: 'authjs.session-token',
      token: { email: 'preview@example.test', name: 'Local preview', sub: 'local-preview' }
    });
    secureSession = await encode({ secret: process.env.AUTH_SECRET, salt: '__Secure-authjs.session-token', token: { email: 'preview@example.test', name: 'Local preview', sub: 'local-preview' } });
    renewedAt = Date.now();
  }
  const cookies = (req.headers.cookie || '').split(';').filter((cookie) =>
    cookie.trim() && !cookie.trim().startsWith('authjs.session-token=') && !cookie.trim().startsWith('__Secure-authjs.session-token=')
  );
  cookies.push(`authjs.session-token=${session}`, `__Secure-authjs.session-token=${secureSession}`);
  return { ...req.headers, cookie: cookies.join('; ') };
}

const server = http.createServer(async (req, res) => {
  try {
    const upstream = http.request({
      hostname: '127.0.0.1', port: 5276, path: req.url, method: req.method,
      headers: await headers(req)
    }, (reply) => {
      const responseHeaders = { ...reply.headers };
      delete responseHeaders['x-frame-options'];
      const parents = ['http://127.0.0.1:5275', 'http://localhost:5275', process.env.PREVIEW_PARENT_ORIGIN].filter(Boolean).join(' ');
      const csp = String(responseHeaders['content-security-policy'] ?? "default-src 'self'");
      responseHeaders['content-security-policy'] = csp.replace(/(?:^|;)\s*frame-ancestors[^;]*/g, '') + '; frame-ancestors ' + parents;
      res.writeHead(reply.statusCode, responseHeaders);
      reply.pipe(res);
    });
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502);
      res.end('Local preview is starting. Please refresh.');
    });
    req.pipe(upstream);
  } catch {
    res.writeHead(500);
    res.end('Preview session unavailable.');
  }
});

server.on('upgrade', async (req, socket, head) => {
  try {
    const upstream = http.request({
      hostname: '127.0.0.1', port: 5276, path: req.url,
      headers: await headers(req)
    });
    upstream.on('upgrade', (reply, remote, remainder) => {
      socket.write(`HTTP/1.1 ${reply.statusCode} ${reply.statusMessage}\r\n`);
      for (let i = 0; i < reply.rawHeaders.length; i += 2) {
        socket.write(`${reply.rawHeaders[i]}: ${reply.rawHeaders[i + 1]}\r\n`);
      }
      socket.write('\r\n');
      if (remainder.length) socket.write(remainder);
      if (head.length) remote.write(head);
      socket.pipe(remote).pipe(socket);
      remote.on('error', () => socket.destroy());
      socket.on('error', () => remote.destroy());
    });
    upstream.on('error', () => socket.destroy());
    upstream.on('response', () => socket.destroy());
    upstream.end();
  } catch {
    socket.destroy();
  }
});
server.listen(5275, '0.0.0.0');

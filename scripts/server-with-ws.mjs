/**
 * Production adapter-node entry with graceful listener shutdown.
 *
 * Session input uses the normal SvelteKit POST endpoint and output uses SSE.
 * Do not add an `upgrade` listener here: HTTP upgrades bypass SvelteKit's
 * Auth.js/owner gate, and checking merely for the presence of a cookie is not
 * authentication. The obsolete WebSocket bridge was removed after that exact
 * bypass was verified against production.
 */
import http from 'node:http';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
// Policy documents allow 10 MB plus multipart metadata. Keep an operator's
// explicit limit; adapter-node must read the default before its module loads.
process.env.BODY_SIZE_LIMIT ??= '12M';
const { handler } = await import('../build/handler.js');

const PORT = Number(process.env.PORT ?? 4173);
const HOST = process.env.HOST ?? '0.0.0.0';

/**
 * POST /oauth/token is the OpenID provider's server-to-server leg
 * ($lib/server/oidc/provider): Immich's server posts a form there with no
 * Origin header. SvelteKit's CSRF check 403s any form POST whose Origin is not
 * the site's own — missing included — and it runs before hooks.server.ts, so
 * the route cannot opt out. CSRF is a cookie problem, and this endpoint reads
 * no cookie (the client secret, sealed code and PKCE verifier are the
 * credentials), so on EXACTLY this method and path the site's own origin is
 * stamped on and cookies are removed. Every other request is untouched.
 */
function oidcTokenRequest(req) {
  if (req.method !== 'POST') return;
  const url = req.url ?? '';
  const q = url.indexOf('?');
  if ((q === -1 ? url : url.slice(0, q)) !== '/oauth/token') return;
  let origin = '';
  if (process.env.ORIGIN) {
    try { origin = new URL(process.env.ORIGIN).origin; } catch { origin = ''; }
  } else {
    // adapter-node's own rule when ORIGIN is unset.
    const proto = (process.env.PROTOCOL_HEADER && String(req.headers[process.env.PROTOCOL_HEADER.toLowerCase()] ?? '')) || 'https';
    const host = (process.env.HOST_HEADER && String(req.headers[process.env.HOST_HEADER.toLowerCase()] ?? '')) || req.headers.host;
    if (host && !proto.includes(':')) origin = `${proto}://${host}`;
  }
  if (!origin) return;
  req.headers.origin = origin;
  delete req.headers.cookie;
}

/**
 * Files copied from static/ are answered by adapter-node's static handler
 * before hooks.server.ts runs, so they never received the header layer every
 * other response gets. Set the baseline here for exactly those paths, listed
 * once at boot (static/ only changes with a release): `nosniff` and SAMEORIGIN
 * framing for every file, and a baseline policy on the hand-written HTML tools.
 * That policy allows what those pages use — inline script/style, Google Fonts,
 * the Cloudflare analytics beacon — and closes plugins, foreign frames, base
 * rewriting and cross-origin framing. SvelteKit responses are untouched; they
 * get their own policy from svelte.config.js.
 */
const STATIC_HTML_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://cloudflareinsights.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join('; ');

const CLIENT_DIR = fileURLToPath(new URL('../build/client/', import.meta.url));

function listStaticFiles(dir, prefix = '/') {
  const files = new Set();
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return files; }
  for (const entry of entries) {
    // _app is the bundler's output, not static/ — and thousands of files.
    if (prefix === '/' && entry.name === '_app') continue;
    const path = prefix + entry.name;
    if (entry.isDirectory()) for (const f of listStaticFiles(join(dir, entry.name), path + '/')) files.add(f);
    else files.add(path);
  }
  return files;
}
const STATIC_FILES = listStaticFiles(CLIENT_DIR);

/** The static file a request resolves to, using the static handler's own fallbacks. */
function staticFileFor(rawUrl, files = STATIC_FILES) {
  const q = rawUrl.indexOf('?');
  let path;
  try { path = decodeURIComponent(q === -1 ? rawUrl : rawUrl.slice(0, q)); } catch { return null; }
  for (const candidate of [path, path + '.html', path.endsWith('/') ? path + 'index.html' : path + '/index.html']) {
    if (files.has(candidate)) return candidate;
  }
  return null;
}

function staticHeaders(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return;
  const file = staticFileFor(req.url ?? '/');
  if (!file) return;
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  if (file.endsWith('.html')) res.setHeader('Content-Security-Policy', STATIC_HTML_CSP);
}

const server = http.createServer((req, res) => {
  oidcTokenRequest(req);
  staticHeaders(req, res);
  return handler(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`Listening on http://${HOST}:${PORT}`);
});

/**
 * Stop accepting work on the way down.
 *
 * hooks.server.ts drains the workflow engine on SIGTERM and then calls
 * process.exit(0), but it holds no handle on this server — so nothing ever
 * closed the listening socket, and every restart severed whatever requests and
 * SSE streams were open. cloudflared sees that as the origin resetting the
 * connection and returns 502, which is why restarts showed up as gateway errors
 * rather than as a brief blip.
 *
 * Closing the listener refuses new connections immediately, so the supervisor
 * can bring the replacement up, while requests already being served run to
 * completion inside the drain window. `closeIdleConnections` is the other half:
 * without it, a pooled keep-alive connection that cloudflared is about to reuse
 * stays open just long enough to be picked, then dies mid-request.
 */
let closing = false;
function closeServer() {
  if (closing) return;
  closing = true;
  server.close(() => console.log('[server] listener closed'));
  server.closeIdleConnections?.();
}

process.on('SIGTERM', closeServer);
process.on('SIGINT', closeServer);

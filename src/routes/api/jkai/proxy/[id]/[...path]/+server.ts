import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { jkaiBuilds } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { proxyToSandbox } from '$lib/jkai/serve';
import { startProjectServer } from '$lib/jkai/sandbox';
import type { ServeConfig } from '$lib/jkai/types';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { isOwnerRequest } from '$lib/server/owner';
import { safeGeneratedResponseHeaders } from '$lib/server/generated-content';
import {
  PREVIEW_TICKET_PREFIX,
  issuePreviewTicket,
  splitPreviewTicket,
  verifyPreviewTicket,
} from '$lib/server/preview-ticket';
import { env } from '$env/dynamic/private';

// Track in-flight revive attempts so concurrent requests during the wake-up
// window don't all fan out to startProjectServer (which is expensive).
const reviving = new Set<string>();

// Static MIME map for register_chat_build's typical outputs (HTML/CSS/JS +
// a few images/fonts). Anything not listed falls back to octet-stream — the
// browser handles it fine for download but won't render. Expand on demand.
const STATIC_MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

/** Serve a kind:'static' build directly from /home/jkai/workspace/<id>/live/.
 *
 * register_chat_build writes files into this directory at registration time
 * (no dev server, no proxy needed). Without this branch the request bounces
 * through proxyToSandbox(0,…) → fake 502 → fake "Waking preview" page →
 * infinite refresh, because there's no startCommand to revive.
 *
 * Path-traversal guard: resolve the requested file inside the workspace root
 * and refuse anything outside.
 *
 * HTML pages get a <base href> injection so relative links + asset URLs in the
 * served app resolve through the proxy prefix (e.g. <link href="style.css">
 * resolves to /api/jkai/proxy/<id>/style.css) — same convention proxyToSandbox
 * uses, kept identical so the rest of the build pipeline behaves the same.
 */
async function serveStaticBuild(
  buildId: string,
  requestedPath: string,
  baseHref: string,
): Promise<Response> {
  const workspaceRoot = `/home/jkai/workspace/${buildId}/live`;
  // Normalise the requested path and refuse absolute / parent-escaping paths.
  const cleanRequested = requestedPath.replace(/^\/+/, '') || 'index.html';
  const rootResolved = resolve(workspaceRoot);
  const resolved = resolve(rootResolved, cleanRequested);
  if (resolved !== rootResolved && !resolved.startsWith(rootResolved + sep)) {
    return new Response('forbidden', { status: 403 });
  }

  let st: Awaited<ReturnType<typeof stat>>;
  try {
    st = await stat(resolved);
  } catch {
    return new Response('not found', { status: 404 });
  }

  // Directory request → fall back to index.html inside it. Mirrors `serve`'s
  // default behaviour and matches how publishBuild's static copy would resolve.
  const targetPath = st.isDirectory() ? join(resolved, 'index.html') : resolved;
  let body: Buffer;
  try {
    // `resolve` blocks lexical traversal; realpath also blocks symlinks that
    // point out of the build root.
    const [realRoot, realTarget] = await Promise.all([realpath(rootResolved), realpath(targetPath)]);
    if (realTarget !== realRoot && !realTarget.startsWith(realRoot + sep)) {
      return new Response('forbidden', { status: 403 });
    }
    body = await readFile(realTarget);
  } catch {
    return new Response('not found', { status: 404 });
  }

  const ext = extname(targetPath).toLowerCase();
  const mime = STATIC_MIME[ext] ?? 'application/octet-stream';

  // Inject a <base href> into served HTML so relative URLs resolve through
  // the proxy prefix. Mirrors proxyToSandbox's behaviour for dev-server HTML.
  if (mime.startsWith('text/html') && !body.includes(Buffer.from('<base'))) {
    const baseTag = `<base href="${baseHref}">`;
    const text = body.toString('utf-8');
    // Insert just after <head>, or at the start of <html>, or at the very top.
    const headIdx = text.search(/<head[^>]*>/i);
    const injected = headIdx >= 0
      ? text.slice(0, headIdx + text.match(/<head[^>]*>/i)![0].length) + baseTag + text.slice(headIdx + text.match(/<head[^>]*>/i)![0].length)
      : baseTag + text;
    body = Buffer.from(injected, 'utf-8');
  }

  // Buffer → Uint8Array for the Response constructor's BodyInit shape.
  const headers = safeGeneratedResponseHeaders(new Headers({
    'content-type': mime,
    'cache-control': 'no-cache',
  }));
  return new Response(new Uint8Array(body), {
    status: 200,
    headers,
  });
}

function wakingUpHtml(refreshUrl: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Waking up…</title>
<meta http-equiv="refresh" content="3; url=${refreshUrl}">
<style>
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #f4f1ea;
    color: #1a1a1a;
    font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .box {
    text-align: center;
    padding: 2rem;
    border: 1px solid #1a1a1a;
    background: #fff;
    max-width: 360px;
  }
  .dot {
    display: inline-block;
    width: 8px; height: 8px;
    border-radius: 50%;
    background: #b48a32;
    margin-right: 8px;
    animation: pulse 1.4s ease-in-out infinite;
    vertical-align: middle;
  }
  h1 { font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.18em; margin: 0 0 0.75rem; }
  p { font-size: 12px; line-height: 1.5; color: #555; margin: 0; }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
</style>
</head>
<body>
  <div class="box">
    <h1><span class="dot"></span>Waking preview</h1>
    <p>The build's dev server is starting back up. This page will refresh automatically once it's ready.</p>
  </div>
</body>
</html>`;
}

const handler: RequestHandler = async (event) => {
  const { params, request } = event;

  // Preview identifiers are still not capabilities: a bare build id authorises
  // nothing. But an owner SESSION cannot carry the whole preview on its own,
  // because the generated document's opaque origin (CSP `sandbox` without
  // `allow-same-origin`) makes every subresource cross-site and the
  // `SameSite=Lax` cookie is withheld — the HTML loaded, its assets all 404ed,
  // and studio explainers rendered blank. See $lib/server/preview-ticket.
  //
  // So: an owner session OR a valid ticket for THIS build. The ticket is minted
  // below and injected into the <base href>, so the app's own relative URLs
  // carry it. A ticket that is present but does not verify is unauthorised —
  // never fall through to the stripped path, or the prefix becomes a way to
  // rewrite request paths.
  const { ticket, path: assetPath } = splitPreviewTicket(params.path || '');
  const owner = await isOwnerRequest(event);
  const ticketOk = verifyPreviewTicket(ticket ?? undefined, params.id, env.AUTH_SECRET);
  if (!owner && !ticketOk) return new Response('Not found', { status: 404 });

  const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, params.id));
  if (!build?.serveConfig) return new Response('Project not serving', { status: 404 });

  const config = build.serveConfig as ServeConfig;
  const path = '/' + assetPath;
  // Reuse the caller's ticket when it verified, so one page load and everything
  // it pulls share a lifetime; mint a fresh one for an owner-session request
  // (which is what a top-level navigation to the preview is). Falling back to
  // an unticketed base href keeps the route working if AUTH_SECRET is unset in
  // a dev environment, where an owner session covers subresources anyway.
  let ticketSegment = ticketOk && ticket ? `${PREVIEW_TICKET_PREFIX}${ticket}/` : '';
  if (!ticketSegment && env.AUTH_SECRET) {
    ticketSegment = `${PREVIEW_TICKET_PREFIX}${issuePreviewTicket(params.id, env.AUTH_SECRET)}/`;
  }
  // Base href ensures all relative URLs in the proxied app resolve through the proxy
  const baseHref = `/api/jkai/proxy/${params.id}/${ticketSegment}`;

  // Static-kind builds (e.g. register_chat_build output: a single index.html
  // app, no dev server) have port=0 / startCommand=null. The proxy path below
  // would 502 and bounce into the "Waking preview" infinite refresh loop.
  // Serve the files directly from the live/ workspace instead — that's the
  // version register_chat_build wrote and the same version publishBuild
  // would copy to /projects/<slug>/. When HOST_MODE=1 (VPS prod), workspace
  // files live on the host fs and are readable by this node process.
  if (config.kind === 'static') {
    // assetPath, not params.path — the ticket segment is authorisation, not
    // part of the filename, and passing it through would look for a directory
    // called `_t_<ticket>` inside the workspace and 404 every asset.
    const result = await serveStaticBuild(params.id, assetPath, baseHref);
    return result;
  }

  const resp = await proxyToSandbox(config.port, path, request, baseHref);

  // Persistent-preview behaviour: a 502 from the proxy means the dev server
  // backing this build has died (typical cause: pi held the process tree and
  // an interrupt-or-stop killed it with everything attached). For GET requests
  // we kick off a revive in the background using the stored serveConfig and
  // return a self-refreshing shim so the next visit lands on a live server.
  // POST/PUT/etc. we don't auto-revive — the caller likely wants to know
  // immediately rather than have a write silently dropped.
  if (resp.status === 502 && request.method === 'GET') {
    if (config.startCommand && config.healthCheck && !reviving.has(params.id)) {
      reviving.add(params.id);
      // Fire-and-forget — startProjectServer's health-check loop can take up
      // to two minutes; we're not blocking the user on it.
      void startProjectServer(params.id, config.startCommand, config.port, config.healthCheck)
        .catch(() => {})
        .finally(() => reviving.delete(params.id));
    }
    // Refresh through baseHref so the ticket survives the wait. Inside the
    // preview iframe this meta-refresh is not a top-level navigation, so
    // without it the retry arrives with no cookie and no ticket and 404s.
    return new Response(wakingUpHtml(baseHref), {
      status: 503,
      headers: safeGeneratedResponseHeaders(new Headers({
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      })),
    });
  }

  return resp;
};

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;

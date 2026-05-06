import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { jkaiBuilds } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { proxyToSandbox } from '$lib/jkai/serve';
import { startProjectServer } from '$lib/jkai/sandbox';
import type { ServeConfig } from '$lib/jkai/types';

// Track in-flight revive attempts so concurrent requests during the wake-up
// window don't all fan out to startProjectServer (which is expensive).
const reviving = new Set<string>();

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

const handler: RequestHandler = async ({ params, request }) => {
  const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, params.id));
  if (!build?.serveConfig) return new Response('Project not serving', { status: 404 });

  const config = build.serveConfig as ServeConfig;
  const path = '/' + (params.path || '');
  // Base href ensures all relative URLs in the proxied app resolve through the proxy
  const baseHref = `/api/jkai/proxy/${params.id}/`;

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
    return new Response(wakingUpHtml(`/api/jkai/proxy/${params.id}/`), {
      status: 503,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      },
    });
  }

  return resp;
};

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;

import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

const CLIENT_INJECT = `
<script>
(() => {
  const post = (msg) => { try { parent.postMessage(msg, '*'); } catch {} };
  document.addEventListener('selectionchange', () => {
    const t = document.getSelection()?.toString();
    if (t && t.trim()) post({ type: 'webframe-selection', text: t });
  });
  window.addEventListener('load', () => post({ type: 'webframe-pong' }));
  post({ type: 'webframe-pong' });
  document.addEventListener('click', (e) => {
    post({ type: 'webframe-click', x: e.clientX, y: e.clientY });
  });
  document.addEventListener('scroll', () => {
    post({ type: 'webframe-scroll', y: window.scrollY });
  }, { passive: true });
})();
</script>
`;

export const GET: RequestHandler = async ({ url, fetch }) => {
  const target = url.searchParams.get('url');
  const session = url.searchParams.get('session');
  if (!target || !session) throw error(400, 'url and session required');
  try { new URL(target); } catch { throw error(400, 'invalid url'); }

  const svc = env.WEBFRAME_SERVICE_URL;
  if (!svc) throw error(503, 'webframe service not configured');

  const upstream = await fetch(
    `${svc}/render?url=${encodeURIComponent(target)}&session=${encodeURIComponent(session)}`,
  );
  if (!upstream.ok) {
    const body = await upstream.text().catch(() => '');
    throw error(upstream.status, body || 'render failed');
  }
  const html = await upstream.text();
  const injected = html.includes('</head>')
    ? html.replace('</head>', `${CLIENT_INJECT}</head>`)
    : `${CLIENT_INJECT}${html}`;
  return new Response(injected, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // The iframe loads this response — don't cache so reloads re-render.
      'cache-control': 'no-store',
    },
  });
};

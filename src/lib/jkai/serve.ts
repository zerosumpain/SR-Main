import type { ServeConfig } from './types';
import { getContainerIp, clearContainerIpCache, execInSandbox } from './sandbox';
import {
  safeGeneratedRequestHeaders,
  safeGeneratedResponseHeaders,
} from '$lib/server/generated-content';

export function validateServeConfig(raw: any): ServeConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const { port, startCommand, healthCheck, description } = raw;

  if (typeof port !== 'number' || port < 1024 || port > 65535) return null;
  if (typeof startCommand !== 'string' || !startCommand.trim()) return null;
  if (typeof healthCheck !== 'string' || !healthCheck.startsWith('/')) return null;

  return {
    port,
    startCommand: startCommand.trim(),
    healthCheck,
    description: typeof description === 'string' ? description : '',
  };
}

/**
 * Best-effort serve config autodetection. Used when the agent hasn't yet
 * written `dev/serve.json` but the project already has a runnable dev
 * script — surfaces a preview link on the very first iteration where the
 * code can boot, instead of waiting for the agent to formalise it.
 *
 * Looks at `<dev>/package.json` for a `dev` (preferred) or `start` script,
 * tries to parse a port hint from the script, falls back to a sensible
 * default per framework. Returns null if there's no package.json or no
 * usable script.
 */
export async function autodetectServeConfig(buildId: string): Promise<ServeConfig | null> {
  const dir = `/home/jkai/workspace/${buildId}/dev`;
  const cat = await execInSandbox(`cat ${dir}/package.json 2>/dev/null`, 5000);
  if (cat.exitCode !== 0 || !cat.stdout.trim()) return null;
  let pkg: { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> } | null;
  try { pkg = JSON.parse(cat.stdout); } catch { return null; }
  if (!pkg) return null;

  const script = pkg.scripts?.dev ?? pkg.scripts?.start ?? null;
  if (!script || !script.trim()) return null;

  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const knownFramework =
    'vite' in deps || 'next' in deps || '@sveltejs/kit' in deps ||
    'react-scripts' in deps || 'astro' in deps || 'expo' in deps ||
    /\b(vite|next|svelte-kit|astro|expo|react-scripts|nuxt)\b/.test(script) ||
    /\b(node|tsx|ts-node|bun|deno)\b/.test(script);
  if (!knownFramework) return null;

  // Port: prefer an explicit --port / -p / PORT= flag in the script string.
  // Otherwise pick a framework-typical default. The orchestrator's port
  // allocator will reassign if it collides with another build, and rewrite
  // the start command accordingly — so a wrong default here is recoverable.
  let port: number | null = null;
  const explicit = script.match(/(?:--port[\s=]|-p\s+|PORT=)(\d{2,5})/);
  if (explicit) port = Number(explicit[1]);
  if (!port) {
    if ('next' in deps) port = 3000;
    else if ('@sveltejs/kit' in deps) port = 5173;
    else if ('vite' in deps) port = 5173;
    else if ('react-scripts' in deps) port = 3000;
    else if ('astro' in deps) port = 4321;
    else if ('expo' in deps) port = 8081;
    else port = 3000;
  }

  // Inject host + port flags so the server binds 0.0.0.0 (the proxy needs to
  // reach it from outside the container) and listens where we expect.
  const startCommand = injectHostPort(script, port);

  return {
    port,
    startCommand,
    healthCheck: '/',
    description: '[autodetected] inferred from package.json scripts.dev — replace by writing dev/serve.json',
  };
}

function injectHostPort(script: string, port: number): string {
  // Already explicit? Trust the script.
  if (/--port[\s=]|--host[\s=]|-p\s+\d/.test(script)) return script;
  // npm/pnpm/yarn/bun run scripts need the `--` separator before flags.
  const isRunScript = /^\s*(npm|pnpm|yarn|bun)\s+run\b/.test(script);
  const sep = isRunScript ? ' --' : '';
  return `${script}${sep} --host 0.0.0.0 --port ${port}`;
}

// Script injected into proxied HTML to rewrite fetch/XHR to route through the proxy
function proxyRewriteScript(baseHref: string): string {
  return `<script>
(function(){
  var B="${baseHref}";
  // Patch fetch
  var _f=window.fetch;
  window.fetch=function(u,o){
    if(typeof u==='string'&&u.startsWith('/')){u=B+u.slice(1);}
    else if(u instanceof Request&&u.url){
      var p=new URL(u.url).pathname;
      if(p.startsWith('/')&&!p.startsWith(B)){u=new Request(B+p.slice(1),u);}
    }
    return _f.call(this,u,o);
  };
  // Patch XMLHttpRequest
  var _o=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(m,u){
    if(typeof u==='string'&&u.startsWith('/')){u=B+u.slice(1);}
    return _o.apply(this,[m,u].concat(Array.prototype.slice.call(arguments,2)));
  };
})();
</script>`;
}

export async function proxyToSandbox(
  port: number,
  path: string,
  request: Request,
  baseHref?: string,
): Promise<Response> {
  let ip: string;
  try {
    ip = await getContainerIp();
  } catch {
    return new Response('Sandbox not running', { status: 502 });
  }

  const url = `http://${ip}:${port}${path}`;

  try {
    // Generated applications are an untrusted boundary. In particular, never
    // forward the owner's Auth.js cookie, Authorization header, proxy identity
    // headers, or Origin into an agent-created process.
    const headers = safeGeneratedRequestHeaders(request.headers);

    const resp = await fetch(url, {
      method: request.method,
      headers,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
      // @ts-ignore - duplex needed for streaming body
      duplex: request.body ? 'half' : undefined,
    });

    const contentType = resp.headers.get('content-type') || '';

    // For HTML responses, inject <base> tag and fetch/XHR proxy rewrite script
    if (baseHref && contentType.includes('text/html')) {
      let html = await resp.text();
      // Extract buildId from baseHref ("/api/jkai/proxy/<id>/") so the
      // running app can address the events endpoint without guessing.
      const buildIdMatch = baseHref.match(/\/api\/jkai\/proxy\/([^/]+)/);
      const buildId = buildIdMatch ? buildIdMatch[1] : '';
      const buildIdScript = buildId
        ? `<script>window.JKAI_BUILD_ID=${JSON.stringify(buildId)};window.JKAI_EVENTS_URL=${JSON.stringify(`/api/jkai/builds/${buildId}/events`)};</script>`
        : '';
      const injection = `<base href="${baseHref}">${buildIdScript}${proxyRewriteScript(baseHref)}`;

      if (html.includes('<head>')) {
        html = html.replace('<head>', `<head>${injection}`);
      } else if (html.includes('<head ')) {
        html = html.replace(/<head([^>]*)>/, `<head$1>${injection}`);
      } else if (html.includes('<html')) {
        html = html.replace(/<html([^>]*)>/, `<html$1><head>${injection}</head>`);
      } else {
        html = injection + html;
      }

      const respHeaders = safeGeneratedResponseHeaders(resp.headers);
      respHeaders.delete('content-length');
      respHeaders.delete('content-encoding');

      return new Response(html, {
        status: resp.status,
        statusText: resp.statusText,
        headers: respHeaders,
      });
    }

    return new Response(resp.body, {
      status: resp.status,
      statusText: resp.statusText,
      headers: safeGeneratedResponseHeaders(resp.headers),
    });
  } catch (err) {
    clearContainerIpCache();
    return new Response(`Proxy error: ${err}`, { status: 502 });
  }
}

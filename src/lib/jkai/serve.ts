import type { ServeConfig } from './types';
import { getContainerIp, clearContainerIpCache } from './sandbox';

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
    const headers = new Headers(request.headers);
    headers.delete('host');

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
      const injection = `<base href="${baseHref}">${proxyRewriteScript(baseHref)}`;

      if (html.includes('<head>')) {
        html = html.replace('<head>', `<head>${injection}`);
      } else if (html.includes('<head ')) {
        html = html.replace(/<head([^>]*)>/, `<head$1>${injection}`);
      } else if (html.includes('<html')) {
        html = html.replace(/<html([^>]*)>/, `<html$1><head>${injection}</head>`);
      } else {
        html = injection + html;
      }

      const respHeaders = new Headers(resp.headers);
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
      headers: resp.headers,
    });
  } catch (err) {
    clearContainerIpCache();
    return new Response(`Proxy error: ${err}`, { status: 502 });
  }
}

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

    // For HTML responses, inject a <base> tag so relative URLs resolve through the proxy
    if (baseHref && contentType.includes('text/html')) {
      let html = await resp.text();
      // Inject <base href> right after <head> (or at the start if no <head>)
      if (html.includes('<head>')) {
        html = html.replace('<head>', `<head><base href="${baseHref}">`);
      } else if (html.includes('<head ')) {
        html = html.replace(/<head([^>]*)>/, `<head$1><base href="${baseHref}">`);
      } else if (html.includes('<html')) {
        html = html.replace(/<html([^>]*)>/, `<html$1><head><base href="${baseHref}"></head>`);
      } else {
        html = `<base href="${baseHref}">` + html;
      }

      const respHeaders = new Headers(resp.headers);
      respHeaders.delete('content-length'); // Length changed
      respHeaders.delete('content-encoding'); // Don't claim compression on rewritten body

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

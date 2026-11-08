import { env } from '$env/dynamic/private';
import { loadOidcConfig, type OidcConfig } from './provider';

/** The provider's config for this request, or null when the feature is off. */
export function oidcConfig(): OidcConfig | null {
  return loadOidcConfig(env);
}

/** Feature off: the routes do not exist. */
export const notFound = () => new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });

/** RFC 6749 5.2 error body. */
export function oauthError(status: number, error: string, description?: string, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(description ? { error, error_description: description } : { error }), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', pragma: 'no-cache', ...extra },
  });
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** A plain page for the refusals that must not go back to the client. */
export function plainPage(status: number, title: string, message: string): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title></head><body style="font-family:system-ui,sans-serif;max-width:36rem;margin:4rem auto;padding:0 1rem;line-height:1.5"><h1 style="font-size:1.25rem">${esc(title)}</h1><p>${esc(message)}</p><p><a href="/">strangeramblings.com</a></p></body></html>`;
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

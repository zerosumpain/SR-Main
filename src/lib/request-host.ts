/**
 * The hostname a request actually arrived on.
 *
 * NOT `event.url.hostname`. Production sets `ORIGIN=https://strangeramblings.com`
 * for adapter-node, which makes `event.url` a rewrite of that origin on every
 * request — so `url.hostname` is always the canonical host and a hostname test
 * against it can never match another name pointed at the same app.
 *
 * That is not hypothetical: the maps.strangeramblings.com retirement shipped
 * testing `url.hostname`, passed locally (homeserv sets no ORIGIN) and did
 * nothing at all in production.
 *
 * Lives in its own module rather than in hooks.server.ts so it can be tested
 * without importing the auth stack, the database and the WhatsApp client —
 * importing that module for one pure function actually opens a WhatsApp
 * connection from the test runner.
 */
export function requestHost(event: { request: Request; url: URL }): string {
  const header = event.request.headers.get('host');
  if (!header) return event.url.hostname.toLowerCase();

  const host = header.trim().toLowerCase();
  // Strip any port, keeping IPv6 brackets intact.
  const withoutPort = host.startsWith('[')
    ? host.slice(0, host.indexOf(']') + 1)
    : host.split(':')[0];

  return withoutPort || event.url.hostname.toLowerCase();
}

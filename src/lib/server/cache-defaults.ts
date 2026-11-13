// The Cache-Control default the header hook applies (hooks.server.ts).
// Its own module so it can be tested without loading the hook.

/**
 * Owner surfaces and APIs that say nothing about caching are not cacheable.
 *
 * A response with no Cache-Control is fair game for heuristic caching by a
 * browser or anything in between, and the owner's pages and API answers —
 * including the 401s and redirects the gate itself emits — are the last
 * things that should be kept. A handler that DOES choose (the public
 * read-only APIs that set max-age, Drive's ETag-keyed previews, SSE streams
 * with their own no-cache) is left exactly as it chose; event streams are
 * skipped even when silent, so nothing about a stream changes.
 */
export function defaultsToNoStore(pathname: string, headers: Headers): boolean {
  if (headers.has('Cache-Control')) return false;
  if ((headers.get('Content-Type') ?? '').startsWith('text/event-stream')) return false;
  return (
    pathname.startsWith('/api/') ||
    pathname === '/admin' || pathname.startsWith('/admin/') ||
    pathname === '/jkai' || pathname.startsWith('/jkai/')
  );
}

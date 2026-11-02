// Which /api/native answer keeps its own cache headers. The hook stamps every
// phone API answer `private, no-store`; the Drive previews are the exception,
// because their private, ETag-keyed headers are what let the app keep a tile
// instead of fetching it again. Pure, so the hook can import it cheaply.

export const NATIVE_PREVIEW_ROUTE = '/api/native/drive/files/[id]/preview';

/** A preview, served or a 304, whose Cache-Control is private. Anything else is no-store. */
export function keepsOwnNativeCache(routeId: string | null, status: number, cacheControl: string | null): boolean {
  return routeId === NATIVE_PREVIEW_ROUTE && (status === 200 || status === 304) && /^private\b/.test(cacheControl ?? '');
}

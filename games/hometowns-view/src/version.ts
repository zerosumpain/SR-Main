// The page's own version (spec §10.10). ENGINE_HASH (from ./engine) says which
// simulation this bundle runs; PAGE_HASH says which page this is: ENGINE_HASH
// and every page build input (scripts/hometowns/page-hash.mjs). The server
// names a page by its path, `/projects/hometowns/<PAGE_HASH>/mobile.html`, so
// a page-only change gets a folder of its own and the phone reloads into it.
// The generated file sits outside the page's sources, so importing it does
// not feed back into the hash.

export { PAGE_HASH } from '../../../src/lib/games/hometowns/page-hash.generated';

const PAGE_PATH = /^\/projects\/hometowns\/([A-Za-z0-9]{1,64})\/mobile\.html$/;

/** The page hash a wire's `client.page` names, or null when it is not a Hometowns page path. */
export function pageHashOf(page: unknown): string | null {
  const m = typeof page === 'string' ? PAGE_PATH.exec(page) : null;
  return m ? m[1] : null;
}

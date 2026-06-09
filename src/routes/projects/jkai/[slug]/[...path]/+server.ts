import type { RequestHandler } from './$types';

// Don't let SvelteKit strip the trailing slash first (that would double-redirect);
// our handler does the single canonical redirect itself.
export const trailingSlash = 'ignore';

// This legacy path served published bundles from getPublishedDir()/<slug> with
// NO visibility/share guard — so a private project (incl. whitehall/brass-and-rails)
// would have leaked here regardless of the /projects visibility + share controls.
// The canonical route /projects/<slug>/[...path] serves the IDENTICAL bundles
// behind the full guard (visibility + owner session + share token), so we
// permanently redirect every request here into it. Exactly one serving path now
// exists, and it is gated. The query string (any ?t= share token) is preserved
// so the canonical guard can validate it.
export const GET: RequestHandler = ({ params, url }) => {
  const rest = params.path ? `/${params.path}` : '/';
  return new Response(null, {
    status: 308,
    headers: { Location: `/projects/${params.slug}${rest}${url.search}` },
  });
};

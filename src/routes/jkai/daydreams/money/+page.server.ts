import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// The money room was retired with the daydream engine it showed (spec
// 2026-09-25-daydream-simplify, P4). Kept as a redirect stub so old bookmarks
// and notification links land on the one feed. The query is dropped on
// purpose: the feed reads `?tab=`/`?rate=`/`?open=` as legacy links and
// would bounce straight back here.
export const load: PageServerLoad = () => {
  throw redirect(308, '/jkai/daydreams');
};

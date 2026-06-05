import { getAllPosts } from '$lib/blog';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
  // Streamed (un-awaited) — the hero's static headline + strap paint immediately
  // while the full post list loads; the page shows skeleton rows until it
  // resolves. The `.catch` keeps the promise from rejecting so {#await} needs no
  // {:catch} branch. (Tradeoff: post links arrive in the streamed body rather
  // than the initial HTML — fine for the index, individual posts SSR fully.)
  const posts = getAllPosts().catch((e) => {
    console.error('Failed to fetch blog posts:', e);
    return [];
  });
  return { posts };
};

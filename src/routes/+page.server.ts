import { getAllPosts } from '$lib/blog';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  try {
    const posts = await getAllPosts();
    return { posts: posts.slice(0, 5) };
  } catch {
    return { posts: [] };
  }
};

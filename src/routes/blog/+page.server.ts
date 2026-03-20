import { getAllPosts } from '$lib/blog';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  try {
    const posts = await getAllPosts();
    return { posts };
  } catch (e) {
    console.error('Failed to fetch blog posts:', e);
    return { posts: [] };
  }
};

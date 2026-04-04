import type { PageServerLoad } from './$types';
import { getPostsByTag } from '$lib/blog';

export const load: PageServerLoad = async ({ params }) => {
  const posts = await getPostsByTag(params.tag);
  return { posts, tag: params.tag };
};

import type { PageServerLoad } from './$types';
import { getPostByPreviewToken } from '$lib/blog';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params }) => {
  const post = await getPostByPreviewToken(params.token);
  if (!post) throw error(404, 'Post not found');
  return { post };
};

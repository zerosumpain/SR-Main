import { json } from '@sveltejs/kit';
import { readDevFile } from '$lib/jkai/sandbox';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
  try {
    const content = await readDevFile(params.id!, params.path ?? '');
    return json({ content });
  } catch (err) {
    return json({ content: '', error: (err as Error).message }, { status: 200 });
  }
};

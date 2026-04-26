import { json } from '@sveltejs/kit';
import { listDevFiles } from '$lib/jkai/sandbox';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
  try {
    const files = await listDevFiles(params.id!);
    return json({ files });
  } catch (err) {
    return json({ files: [], error: (err as Error).message }, { status: 200 });
  }
};

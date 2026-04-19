import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listNotes } from '$lib/jkai/intel/queries';

export const GET: RequestHandler = async ({ url }) => {
  const limit = Number(url.searchParams.get('limit') ?? 50);
  const offset = Number(url.searchParams.get('offset') ?? 0);
  const source = url.searchParams.get('source') ?? undefined;
  const format = url.searchParams.get('format') ?? undefined;
  const notes = await listNotes({ limit, offset, source, format });
  return json(notes);
};

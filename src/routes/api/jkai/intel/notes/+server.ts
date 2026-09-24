import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listNotes } from '$lib/jkai/intel/queries';
import { resolveRequestScope } from '$lib/jkai/intel/scope.server';

export const GET: RequestHandler = async (event) => {
  const { url } = event;
  const scope = await resolveRequestScope(event);
  const limit = Number(url.searchParams.get('limit') ?? 50);
  const offset = Number(url.searchParams.get('offset') ?? 0);
  const source = url.searchParams.get('source') ?? undefined;
  const format = url.searchParams.get('format') ?? undefined;
  const notes = await listNotes({ limit, offset, source, format, scope });
  return json(notes);
};

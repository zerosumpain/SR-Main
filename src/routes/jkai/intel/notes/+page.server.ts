import type { PageServerLoad } from './$types';
import { listNotes } from '$lib/jkai/intel/queries';
import { resolveRequestScope } from '$lib/jkai/intel/scope.server';

export const load: PageServerLoad = async (event) => {
  const { url } = event;
  const scope = await resolveRequestScope(event);
  const source = url.searchParams.get('source') ?? undefined;
  const format = url.searchParams.get('format') ?? undefined;
  const notes = await listNotes({ limit: 50, source, format, scope });
  return { notes, filters: { source, format } };
};

import type { PageServerLoad } from './$types';
import { listNotes } from '$lib/jkai/intel/queries';

export const load: PageServerLoad = async ({ url }) => {
  const source = url.searchParams.get('source') ?? undefined;
  const format = url.searchParams.get('format') ?? undefined;
  const notes = await listNotes({ limit: 50, source, format });
  return { notes, filters: { source, format } };
};

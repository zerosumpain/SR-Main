import type { PageServerLoad } from './$types';
import { listSegments } from '$lib/trails/segments-service';
import { segmentDescriptor } from '$lib/trails/segments/naming';

// Owner-gated the same way as the rest of /trails: absent from PUBLIC_PATHS.
export const load: PageServerLoad = async ({ url }) => {
  const type = url.searchParams.get('type');
  try {
    const { rows, types } = await listSegments({ types: type ? [type] : undefined });
    // The list gives each row its own efforts column, so the descriptor beside
    // the name drops the count and keeps the two facts it adds.
    const segments = rows.map((row) => ({
      ...row,
      shortDescriptor: segmentDescriptor(row, { includeEfforts: false }),
    }));
    return { segments, types, activeType: type, error: null };
  } catch (err) {
    console.warn('[trails] segments list failed:', (err as Error)?.message);
    return { segments: [], types: [], activeType: null, error: 'Could not load segments.' };
  }
};

import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// The workbench is now the Diagnose tab of the unified workspace. The parent
// +layout.server.ts still 404s anonymous visitors before this runs; /workbench/upload
// stays a real (owner-only) page, linked from the Diagnose tab.
export const load: PageServerLoad = async () => {
  throw redirect(308, '/projects/dfe-data-strategy/author?tab=diagnose');
};

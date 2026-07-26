import type { PageServerLoad } from './$types';

interface DossierSummary {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  status: string;
  openQuestions: string[];
  itemCount: number;
  entityCount: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Reads the same endpoint the page writes to, so the list and the API can never
 * disagree about what a dossier's counts mean.
 */
export const load: PageServerLoad = async ({ fetch }) => {
  const res = await fetch('/api/jkai/intel/dossiers?status=all');
  if (!res.ok) return { dossiers: [] as DossierSummary[] };
  const body = (await res.json()) as { dossiers: DossierSummary[] };
  return { dossiers: body.dossiers ?? [] };
};

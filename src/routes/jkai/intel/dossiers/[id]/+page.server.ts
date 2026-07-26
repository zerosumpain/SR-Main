import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

interface Dossier {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  standingInstructions: string | null;
  status: string;
  openQuestions: string[];
  createdAt: string;
  updatedAt: string;
}

interface DossierItem {
  id: string;
  kind: string;
  refId: string | null;
  body: string | null;
  position: number;
  pinnedAt: string;
  label: string | null;
  detail: string | null;
  href: string | null;
  icon: string | null;
  meta: Record<string, unknown>;
}

/**
 * Hydrating a pin (entity type, connection count, note date) is the same work
 * the API already does, so the page reads it from there rather than keeping a
 * second copy that can drift.
 */
export const load: PageServerLoad = async ({ params, fetch }) => {
  const res = await fetch(`/api/jkai/intel/dossiers/${params.id}`);
  if (res.status === 404) throw error(404, 'dossier not found');
  if (!res.ok) throw error(res.status, 'could not load the dossier');

  const body = (await res.json()) as { dossier: Dossier; items: DossierItem[] };
  return { dossier: body.dossier, items: body.items ?? [] };
};

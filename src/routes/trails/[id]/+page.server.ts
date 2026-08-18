import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getActivity } from '$lib/trails/activities-service';
import { getActivityPhysio } from '$lib/trails/physio-service';

export const load: PageServerLoad = async ({ params }) => {
  const activity = await getActivity(params.id);
  if (!activity) throw error(404, 'Activity not found');

  // Physiology is an enrichment, never a gate — the page renders without it.
  let physio = null;
  try {
    physio = await getActivityPhysio(activity);
  } catch (err) {
    console.warn('[trails] physio enrichment failed:', (err as Error)?.message);
  }
  return { activity, physio };
};

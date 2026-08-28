import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getActivity } from '$lib/trails/activities-service';
import { getActivityPhysio } from '$lib/trails/physio-service';
import { getHighlightCorpus, type Highlight } from '$lib/trails/highlights-service';
import { getActivitySegments } from '$lib/trails/segments-service';

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
  // Segments are an enrichment too, and one that only exists once a rebuild
  // has run — never let their absence take the page down with them.
  let segments: Awaited<ReturnType<typeof getActivitySegments>> = [];
  try {
    segments = await getActivitySegments(activity.id);
  } catch (err) {
    console.warn('[trails] segment lookup failed:', (err as Error)?.message);
  }
  // The list page ships one highlight per row; a detail page gets the whole
  // ordered set, because this is the one place there is room to read it. Same
  // fail-soft shape: no badges beats no page.
  let highlights: Highlight[] = [];
  try {
    const corpus = await getHighlightCorpus();
    highlights = corpus.byActivity.get(activity.id) ?? [];
  } catch (err) {
    console.warn('[trails] highlights failed:', (err as Error)?.message);
  }
  return { activity, physio, segments, highlights };
};

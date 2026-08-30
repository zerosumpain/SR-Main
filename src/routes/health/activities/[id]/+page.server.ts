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
  // Everything the redesigned detail page binds is on these four, and all of it
  // was already here bar `physio.hrMaxSource`:
  //   activity — splits (trailing split reported at true distance, never
  //     rounded up), elevation profile, the HR/cadence series, and the whole
  //     provenance set: source, rawType (reported-as), timezone + startDateLocal
  //     (local offset), coordinates (whether there is a GPS trace at all).
  //   physio  — trimp + trimpBasis (the load basis), ef, decouplingPct,
  //     hrrCurve + hrr60, zones, zoneEdges off hrMax with hrMaxSource beside it,
  //     mets, minHr, temperatureC, humidityPct, and `typical` — the same-sport
  //     medians the pace / HR / efficiency comparisons read.
  //   segments — rankByTime and rankByEfficiency with rankedByTimeOf and
  //     rankedByEfficiencyOf beside them, so "3rd of 4" can never print as
  //     "3rd of 19".
  //   highlights — the whole ordered set for this outing, best first.
  return { activity, physio, segments, highlights };
};

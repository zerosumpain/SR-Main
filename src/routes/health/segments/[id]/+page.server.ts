import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getSegment, getSimilarSegments } from '$lib/trails/segments-service';
import { gradientBands, type GradientBands } from '$lib/trails/segments/gradient-bands';

export const load: PageServerLoad = async ({ params }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) throw error(404, 'Segment not found');

  const segment = await getSegment(id);
  if (!segment) throw error(404, 'Segment not found');

  // Comparison panels are garnish; the segment page must survive their failure.
  const similar = await getSimilarSegments(segment).catch((err) => {
    console.warn('[trails] similar segments failed:', (err as Error)?.message);
    return { byClimb: [], byEfficiency: [] };
  });

  // How much of this ground is actually steep. `SegmentDetail` stores one
  // average gradient, which cannot tell a steady 6% from a wall then a flat —
  // but the stored coordinates carry elevation, so the breakdown is derivable
  // here with no schema change. Pure and synchronous; wrapped anyway, because
  // a malformed geometry must cost the strip and not the page.
  let bands: GradientBands | null = null;
  try {
    bands = gradientBands(segment.coordinates);
  } catch (err) {
    console.warn('[trails] gradient bands failed:', (err as Error)?.message);
  }

  // Everything else the page binds is already on `segment`: `form` (direction,
  // gapPct, daysSincePb, the ±2% holding band), `efforts` (date, time, EF, and
  // avgHeartrate — which is null exactly when the effort fell under
  // MIN_HR_COVERAGE, so it IS the unranked flag the scatter marks with a
  // square), `bests` for the PB, and `conditions` for typical/quickest/slowest.
  // The PB progression is a step line over `efforts` and is derived in the page.
  return { segment, similar, gradientBands: bands };
};

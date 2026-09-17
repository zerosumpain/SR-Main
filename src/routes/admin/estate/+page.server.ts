import type { PageServerLoad } from './$types';
import { ENDPOINTS, byHost, publicUnauthenticated, unmonitored, HOST_LABELS } from '$lib/estate/endpoints';
import { probeEstate } from '$lib/estate/probe.server';
import { readApiSurface } from '$lib/estate/api-surface.server';
import { assembleEstateModel } from '$lib/estate/model/assemble.server';

export const load: PageServerLoad = async () => {
  // The probe reaches across the tailnet, so it is the slow half. The surface
  // scan is local filesystem work — run them together rather than in sequence.
  // The model is a third: mostly in-build reads, plus short loopback probes.
  const [health, surface, model] = await Promise.all([
    probeEstate(),
    Promise.resolve().then(readApiSurface),
    assembleEstateModel(),
  ]);

  return {
    hostLabels: HOST_LABELS,
    groups: byHost(),
    endpoints: ENDPOINTS,
    health,
    surface,
    model,
    findings: {
      publicUnauthenticated: publicUnauthenticated().map((e) => e.id),
      unmonitored: unmonitored().map((e) => e.id),
    },
  };
};

// Reads the vitals agents on homeserv and porkserv and folds their answers
// together with the estate service probes into the cards /admin renders.
//
// Server-side only: production reaches both boxes over the tailnet
// (100.72.165.45 / 100.83.68.108), which the browser cannot do. Same doctrine
// as probe.server.ts — every read is best-effort with a short timeout, and a
// failure is a STATE, never a thrown page load.
import { HOST_TILES, hostState, vitalsConcerns, type HostCard, type HostVitals } from './hosts';
import { ENDPOINTS } from './endpoints';
import type { HealthStatus } from '$lib/architecture/topology';

// Shorter than the estate probe's 2500ms. This runs on the admin landing page,
// and the agents are two hops away on a LAN — if one has not answered in a
// second and a half it is not going to.
const TIMEOUT = 1500;

async function readVitals(url: string): Promise<HostVitals | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
    if (!res.ok) return null;
    const body = (await res.json()) as HostVitals;
    // Guard against a 200 that is not actually the agent — a captive portal, a
    // reused port, a proxy error page rendered as JSON. `agent` is the version
    // marker the agent stamps; nothing else on the estate emits it.
    if (!body || typeof body !== 'object' || body.agent !== 1) return null;
    return body;
  } catch {
    return null;
  }
}

/**
 * Build both host cards.
 *
 * `health` is the estate probe result, keyed by probeId. The service roll-up is
 * derived from the SAME catalogue the estate page renders, so adding a service
 * to endpoints.ts with a probeId puts it in this count automatically — there is
 * no second list here to fall out of step with the first.
 */
export async function readHostCards(health: Record<string, HealthStatus>): Promise<HostCard[]> {
  const vitals = await Promise.all(HOST_TILES.map((h) => readVitals(h.vitalsUrl)));

  return HOST_TILES.map((tile, i) => {
    const v = vitals[i];
    const probed = ENDPOINTS.filter((e) => e.host === tile.id && e.probeId);

    // Counted as 'up' explicitly, never as "not down". Folding 'unknown' into
    // the healthy number is how the estate page once reported 12/12 while two
    // probes were not answering at all.
    const up = probed.filter((e) => health[e.probeId as string] === 'up');
    const down = probed.filter((e) => health[e.probeId as string] === 'down');

    const concerns = vitalsConcerns(v);
    const { state, reason } = hostState({
      vitals: v,
      servicesUp: up.length,
      servicesTotal: probed.length,
      servicesDown: down.map((e) => e.label),
      concerns,
    });

    return {
      id: tile.id,
      label: tile.label,
      address: tile.address,
      role: tile.role,
      state,
      vitals: v,
      concerns,
      services: { up: up.length, total: probed.length, down: down.map((e) => e.label) },
      reason,
    };
  });
}

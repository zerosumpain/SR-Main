// Boat-vs-restriction classification for the Broads Pilot routing engine.
// Pure, dependency-free.
import type { Bridge, Boat, GraphEdge, Restrictions, Verdict } from './types';

/** Headroom (m) kept below a bridge's conservative clearance before we call it
 * a clean pass; inside this band the crossing is 'marginal'. */
export const SAFETY_MARGIN_M = 0.3;

/** Speed-limit (statute mph) → ground speed (m/s). */
export const groundSpeedMs = (mph: number): number => mph * 0.44704;

const RANK: Record<Verdict, number> = { pass: 0, marginal: 1, blocked: 2 };

/** Classify a single boat against a single bridge. */
export function bridgeVerdict(b: Bridge, boat: Boat): Verdict {
  if (boat.bridges_blocked.includes(b.id)) return 'blocked';
  if (b.practically_closed && boat.class !== 'dayboat') return 'blocked';
  const clear = b.clearance_band_m[0];
  if (boat.air_draft_m > clear) return 'blocked';
  if (boat.air_draft_m > clear - SAFETY_MARGIN_M) return 'marginal';
  return 'pass';
}

/** Classify a boat against a graph edge: the worst of its bridges, plus hard
 * beam/draft limits on the edge (when those fields are set). */
export function edgeVerdict(
  edge: GraphEdge,
  restrictions: Restrictions,
  boat: Boat,
): Verdict {
  let worst: Verdict = 'pass';

  for (const rid of edge.restriction_ids) {
    const bridge = restrictions.bridges.find((b) => b.id === rid);
    if (!bridge) continue; // restriction id may reference a non-bridge (lock/zone)
    const v = bridgeVerdict(bridge, boat);
    if (RANK[v] > RANK[worst]) worst = v;
  }

  if (
    edge.max_beam_m != null &&
    boat.beam_m != null &&
    boat.beam_m > edge.max_beam_m
  ) {
    return 'blocked';
  }
  if (
    edge.max_draft_m != null &&
    boat.water_draft_m != null &&
    boat.water_draft_m > edge.max_draft_m
  ) {
    return 'blocked';
  }

  return worst;
}

/** Convenience: can a boat traverse this edge at all? */
export const edgePassable = (
  edge: GraphEdge,
  restrictions: Restrictions,
  boat: Boat,
): boolean => edgeVerdict(edge, restrictions, boat) !== 'blocked';

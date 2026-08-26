// The one that makes everything else work.
//
// A centroid with four visits is a fact about coordinates and is useless on its
// own. It becomes useful the moment it has a name, and the only reliable source
// of that name is the owner. Five of the other seven detectors are inert until
// a place has one, which is why this one is first in the registry and why its
// support gate is the lowest.

import { describePlaceRhythm } from '../places';
import { MIN_VISITS_FOR_PLACE } from '../types';
import { ramp } from './shared';
import { notReady, ready, type Candidate, type DaydreamSnapshot, type Detector } from '../snapshot-types';

/** Visits at which a place is interesting enough to interrupt for. */
const ASK_AT_VISITS = MIN_VISITS_FOR_PLACE;
/** Where the score saturates — a place visited fifteen times is not three times
 *  more interesting than one visited five. */
const SATURATE_AT_VISITS = 12;

export const unknownFrequentPlace: Detector = {
  kind: 'unknown_frequent_place',
  description:
    'A place visited enough to matter that still has no name. Asks what it is, and writes the answer to memory.',

  readiness(s: DaydreamSnapshot) {
    const candidates = s.places.filter(
      (p) => p.status === 'active' && !p.label && p.visitCount >= ASK_AT_VISITS,
    ).length;
    return candidates > 0
      ? ready(candidates, 1, 'unnamed places')
      : notReady(
          candidates,
          1,
          'unnamed places',
          `no place yet has ${ASK_AT_VISITS} visits of ${15}+ minutes without a name`,
        );
  },

  detect(s: DaydreamSnapshot): Candidate[] {
    return s.places
      .filter((p) => p.status === 'active' && !p.label && p.visitCount >= ASK_AT_VISITS)
      // Most-visited first: the place it is least odd to be asked about.
      .sort((a, b) => b.visitCount - a.visitCount)
      .slice(0, 3)
      .map((p) => {
        const rhythm = describePlaceRhythm(p);
        const visitScore = ramp(p.visitCount, ASK_AT_VISITS - 1, SATURATE_AT_VISITS);
        const dwellScore = ramp(p.medianDwellMins, 15, 90);
        const rawScore = Math.min(1, 0.55 + 0.3 * visitScore + 0.15 * dwellScore);

        return {
          kind: 'unknown_frequent_place',
          title: `What is this place you keep going to?`,
          explanation:
            `An unnamed spot with ${rhythm}. Naming it turns a coordinate into a fact ` +
            `everything else can use — and five of the other detectors stay silent until it has one.`,
          rawScore,
          components: {
            visits: p.visitCount,
            medianDwellMins: p.medianDwellMins,
            visitScore: Math.round(visitScore * 1000) / 1000,
            dwellScore: Math.round(dwellScore * 1000) / 1000,
          },
          evidence: [{ kind: 'place', id: p.id, note: rhythm }],
          placeId: p.id,
          // Keyed on the place alone: asking twice about the same place is
          // annoying, and a dismissal should hold however the geometry moves.
          dedupeKey: `unknown_frequent_place:${p.id}`,
          proposedActions: [
            { kind: 'name_place', label: 'Name this place', payload: p.id },
            { kind: 'ignore_place', label: 'Stop asking about it', payload: p.id },
          ],
        };
      });
  },
};

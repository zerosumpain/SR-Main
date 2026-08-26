// The one that makes everything else work.
//
// A centroid is a fact about coordinates and is useless on its own. It becomes
// useful the moment it has a name, and the only reliable source of that name is
// the owner. Five of the other seven detectors are inert until a place has one,
// which is why this one is first in the registry and why its support gate is
// the lowest.
//
// Renamed from `unknown_frequent_place` on 2026-08-26 when the bar dropped from
// three visits to one. Frequency is no longer what makes a place worth asking
// about — TIME SPENT is. Somewhere the owner sat for an hour matters on the
// first visit, and waiting for a third made a café invisible for weeks.

import { describePlaceRhythm } from '../places';
import { MIN_DWELL_MINS, MIN_VISITS_TO_ASK } from '../types';
import { ramp } from './shared';
import { notReady, ready, type Candidate, type DaydreamSnapshot, type Detector } from '../snapshot-types';

/**
 * Visits before it is worth ASKING. Two — not the one that makes a place.
 *
 * A place exists after a single real stay so it can match offers and anchor
 * proximity checks, all of which cost nothing. A question costs a notification
 * and a decision, and somewhere visited once is usually somewhere that needs no
 * name: a car park on the way to somewhere else, a waiting room, a one-off.
 */
const ASK_AT_VISITS = MIN_VISITS_TO_ASK;
/** Where the visit component saturates: a place visited fifteen times is not
 *  three times more interesting than one visited five. */
const SATURATE_AT_VISITS = 12;

export const unknownPlace: Detector = {
  kind: 'unknown_place',
  description:
    'Somewhere you spent real time that still has no name. Asks what it is, suggests one from the address, and writes the answer to memory.',

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
          `nowhere unnamed has ${ASK_AT_VISITS}+ stays of ${MIN_DWELL_MINS}+ minutes yet`,
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
        const dwellScore = ramp(p.medianDwellMins, MIN_DWELL_MINS, 90);
        // Dwell now outweighs repetition: an hour somewhere once says more
        // about a place mattering than three two-minute stops do.
        const rawScore = Math.min(1, 0.5 + 0.35 * dwellScore + 0.15 * visitScore);

        // Ask about somewhere he can RECOGNISE. "What is this place you keep
        // going to?" is unanswerable on a phone and unanswerable on the ledger
        // — ten of them sat there naming nothing. A suggested name and a street
        // turn it into a yes/no.
        const where = p.suggestedAddress ? ` (${p.suggestedAddress})` : '';
        const title = p.suggestedLabel
          ? `Is this ${p.suggestedLabel}?`
          : p.suggestedAddress
            ? `What is the place on ${p.suggestedAddress}?`
            : `What is this place you keep going to?`;

        return {
          kind: 'unknown_place',
          title,
          explanation:
            (p.suggestedLabel
              ? `The geocoder suggests ${p.suggestedLabel}${where}. `
              : p.suggestedAddress
                ? `Somewhere around ${p.suggestedAddress}. `
                : '') +
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
          dedupeKey: `unknown_place:${p.id}`,
          proposedActions: [
            { kind: 'name_place', label: 'Name this place', payload: p.id },
            { kind: 'ignore_place', label: 'Stop asking about it', payload: p.id },
          ],
        };
      });
  },
};

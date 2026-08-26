// "You look to be in a coffee shop — don't forget how badly you slept."
//
// The one detector most likely to be irritating, so it is deliberately the most
// restrained. Two rules keep it on the right side of the line:
//
//  1. It compares against the owner's OWN recent baseline, never a population
//     norm. "Below average for you this month" is information; "below the
//     recommended 8 hours" is a lecture from a pamphlet.
//  2. It states the reading and stops. It does not tell anyone what to do about
//     their coffee.

import { placesNearby, positionIsUsable, ramp } from './shared';
import {
  notReady,
  ready,
  type Candidate,
  type DaydreamSnapshot,
  type Detector,
} from '../snapshot-types';

/** How far below personal baseline counts as "materially off". Below this it
 *  is ordinary night-to-night variation and not worth a word. */
const MATERIAL_DROP = 12;

/** Place kinds where a sleep reading is actually relevant. */
const RELEVANT_KINDS = new Set(['cafe']);

export const contextMeetsHealth: Detector = {
  kind: 'context_meets_health',
  description:
    "Where you are, crossed with a reading materially off your own baseline. States the number and stops.",

  readiness(s: DaydreamSnapshot) {
    if (!s.health.lastNightSleep) {
      return notReady(0, 1, 'sleep readings', 'no sleep reading for last night');
    }
    if (s.health.sleepBaseline == null) {
      return notReady(0, 1, 'baseline', 'not enough recent nights to know your own baseline yet');
    }
    const kinded = s.places.filter(
      (p) => p.status === 'active' && RELEVANT_KINDS.has(p.kind),
    ).length;
    return kinded > 0
      ? ready(kinded, 1, 'relevant places')
      : notReady(0, 1, 'relevant places', 'no place has been named as a cafe yet');
  },

  detect(s: DaydreamSnapshot): Candidate[] {
    const sleep = s.health.lastNightSleep;
    const baseline = s.health.sleepBaseline;
    if (!sleep || baseline == null) return [];
    if (!positionIsUsable(s)) return [];

    const place = placesNearby(s, 100).find((p) => RELEVANT_KINDS.has(p.kind));
    if (!place) return [];

    const drop = baseline - sleep.performance;
    if (drop < MATERIAL_DROP) return [];

    const severity = ramp(drop, MATERIAL_DROP, 35);
    const hours = Math.floor(sleep.durationMins / 60);
    const mins = sleep.durationMins % 60;

    return [
      {
        kind: 'context_meets_health',
        title: `Rough night — ${hours}h ${mins}m, ${Math.round(drop)} below your usual`,
        explanation:
          `Last night scored ${Math.round(sleep.performance)} against your recent average of ` +
          `${Math.round(baseline)}. You are at ${place.label ?? 'a cafe'}.`,
        rawScore: Math.min(0.75, 0.4 + 0.35 * severity),
        components: {
          performance: Math.round(sleep.performance),
          baseline: Math.round(baseline),
          drop: Math.round(drop),
          durationMins: sleep.durationMins,
        },
        evidence: [
          { kind: 'health', id: 'sleep:last-night', note: `${Math.round(sleep.performance)} vs ${Math.round(baseline)}` },
          { kind: 'place', id: place.id, note: place.label ?? '' },
        ],
        placeId: place.id,
        // Once per day at most — the reading does not change between coffees.
        dedupeKey: `context_meets_health:sleep:${s.localDate}`,
        proposedActions: [{ kind: 'open_health', label: 'See the night', payload: '/health' }],
      },
    ];
  },
};

// "You were reading about this place recently."
//
// Matches where the owner is standing against what they have recently been
// researching, corresponding about, or building an intel picture of. The value
// is the join: the research is weeks old and forgotten, the place is in front
// of them now, and nothing else in the system puts the two together.

import { looseMatch, placesNearby, positionIsUsable, ramp } from './shared';
import {
  notReady,
  ready,
  type Candidate,
  type DaydreamSnapshot,
  type Detector,
} from '../snapshot-types';

/** Interest older than this is not "recently". */
const RECENT_DAYS = 30;

export const nearOpenThread: Detector = {
  kind: 'near_open_thread',
  description:
    'Standing near a place that matches something recently researched, discussed or filed. Joins an old thread to a present location.',

  readiness(s: DaydreamSnapshot) {
    const named = s.places.filter((p) => p.status === 'active' && p.label).length;
    if (named === 0) {
      return notReady(0, 1, 'named places', 'no place has a name yet, so nothing can match one');
    }
    return s.interests.length > 0
      ? ready(s.interests.length, 1, 'recent interests')
      : notReady(0, 1, 'recent interests', 'no research, intel or mail in the last 30 days');
  },

  detect(s: DaydreamSnapshot): Candidate[] {
    if (!positionIsUsable(s)) return [];

    const nearby = placesNearby(s).filter((p) => p.label);
    if (nearby.length === 0) return [];

    const cutoff = s.now.getTime() - RECENT_DAYS * 86_400_000;
    const recent = s.interests.filter((i) => i.at.getTime() >= cutoff);

    const out: Candidate[] = [];

    for (const place of nearby) {
      for (const interest of recent) {
        if (!looseMatch(place.label as string, interest.term)) continue;

        const ageDays = (s.now.getTime() - interest.at.getTime()) / 86_400_000;
        // Fresher is more likely to still be live in the owner's head, and so
        // more likely to be worth acting on while standing here.
        const freshness = 1 - ramp(ageDays, 0, RECENT_DAYS);

        out.push({
          kind: 'near_open_thread',
          title: `You looked into ${interest.term} recently — you're next to it`,
          explanation:
            `${place.label} matches "${interest.term}", which came up in your ${interest.source} ` +
            `${Math.max(1, Math.round(ageDays))} day${Math.round(ageDays) === 1 ? '' : 's'} ago. ` +
            `You are beside it now.`,
          rawScore: Math.min(1, 0.5 + 0.4 * freshness),
          components: {
            ageDays: Math.round(ageDays),
            freshness: Math.round(freshness * 1000) / 1000,
          },
          evidence: [
            { kind: 'place', id: place.id, note: place.label ?? '' },
            { kind: interest.source, id: interest.refId, note: interest.term },
          ],
          placeId: place.id,
          dedupeKey: `near_open_thread:${place.id}:${interest.refId}`,
          proposedActions: [
            { kind: 'open_source', label: `Open the ${interest.source}`, payload: interest.refId },
          ],
        });
        // One thread per place is enough; a list of six is not a nudge.
        break;
      }
    }

    return out.slice(0, 2);
  },
};

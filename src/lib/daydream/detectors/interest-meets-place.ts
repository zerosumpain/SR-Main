// "Your email suggests you've been looking at running shoes — there's a shop
//  nearby you have a discount for."
//
// The difference from near_offer: that one needs the merchant name to match the
// place. This one is looser and more speculative — a repeated INTEREST plus a
// nearby place of the right KIND. Because it is looser, it scores lower, needs
// the interest to have recurred rather than appeared once, and says out loud
// that it is an inference.

import { looseMatch, placesNearby, positionIsUsable, ramp } from './shared';
import {
  notReady,
  ready,
  type Candidate,
  type DaydreamSnapshot,
  type Detector,
  type InterestTerm,
} from '../snapshot-types';

/** One mention is a glance. This many is an interest. */
const MIN_MENTIONS = 3;
const RECENT_DAYS = 30;

/** Which place kinds a shopping interest could plausibly be satisfied at.
 *  Deliberately narrow — "somewhere nearby" is not a suggestion. */
const SHOPPING_KINDS = new Set(['shop', 'gym']);

/** Group interest terms by their normalised form and count recurrences. */
export function recurringInterests(
  interests: InterestTerm[],
  now: Date,
  minMentions = MIN_MENTIONS,
  recentDays = RECENT_DAYS,
): Array<{ term: string; mentions: number; latest: Date; refIds: string[] }> {
  const cutoff = now.getTime() - recentDays * 86_400_000;
  const byTerm = new Map<string, { term: string; mentions: number; latest: Date; refIds: string[] }>();

  for (const i of interests) {
    if (i.at.getTime() < cutoff) continue;
    const key = i.term.toLowerCase().trim();
    if (!key) continue;
    const found = byTerm.get(key);
    if (found) {
      found.mentions++;
      if (i.at > found.latest) found.latest = i.at;
      if (found.refIds.length < 5) found.refIds.push(i.refId);
    } else {
      byTerm.set(key, { term: i.term, mentions: 1, latest: i.at, refIds: [i.refId] });
    }
  }

  return [...byTerm.values()]
    .filter((t) => t.mentions >= minMentions)
    .sort((a, b) => b.mentions - a.mentions);
}

export const interestMeetsPlace: Detector = {
  kind: 'interest_meets_place',
  description:
    'A recurring interest plus a nearby place of a matching kind. Looser and lower-scoring than near_offer, and says so.',

  readiness(s: DaydreamSnapshot) {
    const recurring = recurringInterests(s.interests, s.now).length;
    if (recurring === 0) {
      return notReady(
        0,
        1,
        'recurring interests',
        `nothing has come up ${MIN_MENTIONS}+ times in the last ${RECENT_DAYS} days`,
      );
    }
    const kinded = s.places.filter(
      (p) => p.status === 'active' && SHOPPING_KINDS.has(p.kind),
    ).length;
    return kinded > 0
      ? ready(recurring, 1, 'recurring interests')
      : notReady(0, 1, 'shop/gym places', 'no place has been named as a shop or gym yet');
  },

  detect(s: DaydreamSnapshot): Candidate[] {
    if (!positionIsUsable(s)) return [];

    const nearby = placesNearby(s).filter((p) => SHOPPING_KINDS.has(p.kind) && p.label);
    if (nearby.length === 0) return [];

    const recurring = recurringInterests(s.interests, s.now);
    if (recurring.length === 0) return [];

    const out: Candidate[] = [];

    for (const place of nearby) {
      for (const interest of recurring) {
        // The place must plausibly relate to the interest — a hardware shop is
        // not where a running-shoe interest gets satisfied. Without this the
        // detector degenerates into "you are near a shop and you like things".
        if (!looseMatch(place.label as string, interest.term)) continue;

        const strength = ramp(interest.mentions, MIN_MENTIONS - 1, 10);

        out.push({
          kind: 'interest_meets_place',
          title: `${place.label} is here, and ${interest.term} keeps coming up`,
          explanation:
            `"${interest.term}" has appeared ${interest.mentions} times in the last ${RECENT_DAYS} days, ` +
            `and you are beside ${place.label}. This is an inference from what has been landing in ` +
            `your mail and research, not a confirmed offer.`,
          // Capped below near_offer's floor on purpose: a guess should never
          // outrank a voucher you actually hold.
          rawScore: Math.min(0.6, 0.35 + 0.25 * strength),
          components: {
            mentions: interest.mentions,
            strength: Math.round(strength * 1000) / 1000,
          },
          evidence: [
            { kind: 'place', id: place.id, note: place.label ?? '' },
            ...interest.refIds.slice(0, 3).map((id) => ({
              kind: 'interest',
              id,
              note: interest.term,
            })),
          ],
          placeId: place.id,
          dedupeKey: `interest_meets_place:${place.id}:${interest.term.toLowerCase()}`,
          proposedActions: [
            { kind: 'search_offers', label: 'Check for a discount', payload: interest.term },
          ],
        });
        break;
      }
    }

    return out.slice(0, 1);
  },
};

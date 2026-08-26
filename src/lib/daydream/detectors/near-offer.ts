// "You're at Sports Direct and there's a voucher sitting in your email."
//
// The offer INDEX lands in merge 5. This detector is written now, and reports
// honestly that its input does not exist yet rather than quietly returning
// nothing — an empty list and a missing source look identical from the outside,
// and confusing the two is how a broken feature passes for a quiet one.

import { looseMatch, placesNearby, positionIsUsable, ramp } from './shared';
import {
  notReady,
  ready,
  type Candidate,
  type DaydreamSnapshot,
  type Detector,
} from '../snapshot-types';

/** An offer expiring sooner is worth more now. Beyond this it is not urgent. */
const URGENT_WITHIN_DAYS = 14;

export const nearOffer: Detector = {
  kind: 'near_offer',
  description:
    'Standing at or beside a merchant you hold a live, unexpired offer for. Needs the email offer index (merge 5).',

  readiness(s: DaydreamSnapshot) {
    if (!s.offers.available) {
      return notReady(0, 1, 'offer index', 'the email offer index is not built yet (merge 5)');
    }
    const named = s.places.filter((p) => p.status === 'active' && p.label).length;
    if (named === 0) {
      return notReady(0, 1, 'named places', 'no place has a name yet, so no merchant can match one');
    }
    return s.offers.items.length > 0
      ? ready(s.offers.items.length, 1, 'live offers')
      : notReady(0, 1, 'live offers', 'no unexpired offers on file');
  },

  detect(s: DaydreamSnapshot): Candidate[] {
    if (!s.offers.available || s.offers.items.length === 0) return [];
    // A proximity claim on a stale or vague fix is a guess that buzzes.
    if (!positionIsUsable(s)) return [];

    const nearby = placesNearby(s).filter((p) => p.label);
    if (nearby.length === 0) return [];

    const out: Candidate[] = [];

    for (const place of nearby) {
      for (const offer of s.offers.items) {
        if (!looseMatch(place.label as string, offer.merchant)) continue;

        // An expired offer is worse than no offer — it sends you in for
        // nothing. Excluded rather than down-weighted.
        const daysLeft =
          offer.expiresAt != null
            ? (offer.expiresAt.getTime() - s.now.getTime()) / 86_400_000
            : null;
        if (daysLeft != null && daysLeft < 0) continue;

        const urgency = daysLeft == null ? 0.4 : 1 - ramp(daysLeft, 0, URGENT_WITHIN_DAYS);

        out.push({
          kind: 'near_offer',
          title: `You're at ${place.label} — there's an offer in your email`,
          explanation:
            `${offer.summary} (${offer.merchant})` +
            (daysLeft != null ? `, ${Math.max(0, Math.round(daysLeft))} days left.` : '.') +
            ` You are within ${Math.round(Math.max(place.radiusM, 250))} m of it now.`,
          rawScore: Math.min(1, 0.6 + 0.4 * urgency),
          components: {
            daysLeft: daysLeft == null ? -1 : Math.round(daysLeft),
            urgency: Math.round(urgency * 1000) / 1000,
          },
          evidence: [
            { kind: 'place', id: place.id, note: place.label ?? '' },
            { kind: 'email', id: offer.emailId, note: offer.summary },
          ],
          placeId: place.id,
          // Per offer per place: the same voucher at the same shop should not
          // re-fire every tick you stand there, but a different voucher should.
          dedupeKey: `near_offer:${place.id}:${offer.id}`,
          proposedActions: [
            { kind: 'open_email', label: 'Open the email', payload: offer.emailId },
          ],
        });
      }
    }

    return out.slice(0, 2);
  },
};

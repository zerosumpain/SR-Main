// src/lib/home/presence/viewer.ts
//
// Who is looking at /home/people, and what they may see of it (spec: household
// movement, section 4, decision D2).
//
// Scoping lives HERE, in code the load functions call, never in the page: the
// production database role is a superuser and bypasses RLS, and anything a
// load returns reaches the browser whether the markup shows it or not.
//
// - The owner sees everything, as before.
// - A household viewer — a member holding `family:circle` (the Family Circle
//   group, $lib/access/catalogue) whose email is on a household_member row
//   (`householdSubjectFor` in $lib/server/members) — sees every sharing
//   person's live status, their OWN day in full, and nothing of anyone who has
//   chosen not to share.

import { householdSubjectFor } from '$lib/server/members';
import { wardsOf } from './members';
import { isOwnerRequest, type OwnerCheckEvent } from '$lib/server/owner';
import { viewerHolds, viewerOf } from '$lib/server/viewer';
import type { HouseholdPresence } from './household';

/**
 * `wards`: the people this household viewer is a guardian of — non-empty only
 * for a `family:admin` holder whose household_member row names them. A ward's
 * day and person page are open to their guardian as their own are.
 */
export type PeopleViewer = { kind: 'owner' } | { kind: 'household'; subject: string; wards?: readonly string[] };

/**
 * The viewer of a /home/people route, or null for anyone else — the route
 * refuses them. The owner check comes first and mirrors the hook's two paths
 * (an owner session, or the dev-only LAN bypass where no session exists), so
 * the owner never pays for the household lookup. A lookup that fails reads as
 * null: fail closed.
 */
export async function peopleViewerOf(event: OwnerCheckEvent): Promise<PeopleViewer | null> {
  if (await isOwnerRequest(event)) return { kind: 'owner' };
  try {
    const viewer = await viewerOf(event);
    if (viewer.kind !== 'member' || !viewerHolds(viewer, 'family:circle')) return null;
    const subject = await householdSubjectFor(viewer.email);
    if (!subject) return null;
    const wards = viewerHolds(viewer, 'family:admin') ? await wardsOf(subject) : [];
    return { kind: 'household', subject, wards };
  } catch (err) {
    console.error('[home/people] viewer lookup failed:', err);
    return null;
  }
}

/** A card as a viewer receives it. `today` is null where it is not theirs to see. */
export type ScopedPresence = Omit<HouseholdPresence, 'today'> & {
  today: HouseholdPresence['today'] | null;
};

/**
 * What a viewer receives of the household. PURE.
 *
 * The owner gets the cards untouched. A household viewer gets, per person:
 *   - not sharing: the name and "not sharing", and no position data at all —
 *     not the last fix, not how old it is, not the battery. That holds for the
 *     viewer's own card too: they chose.
 *   - their own card: everything, today's figures included.
 *   - anyone else: live status only — where, since when, home or out, battery.
 *     Their day (first out, time out, places, fixes) is theirs.
 *
 * Each card is built field by field rather than spread and trimmed, so a field
 * added to `HouseholdPresence` later reaches a household viewer only when it is
 * added here on purpose.
 */
export function scopeHousehold(members: readonly HouseholdPresence[], viewer: PeopleViewer): ScopedPresence[] {
  if (viewer.kind === 'owner') return members.map((m) => ({ ...m }));
  return members.map((m): ScopedPresence => {
    if (m.notSharing) {
      return {
        subject: m.subject,
        notSharing: true,
        isHome: null,
        placeLabel: null,
        distanceHomeKm: null,
        batteryPct: null,
        ageMins: null,
        lastSeenAt: null,
        today: null,
      };
    }
    const own = m.subject === viewer.subject || (viewer.wards ?? []).includes(m.subject);
    return {
      subject: m.subject,
      isHome: m.isHome,
      placeLabel: m.placeLabel,
      distanceHomeKm: m.distanceHomeKm,
      batteryPct: m.batteryPct,
      ageMins: m.ageMins,
      lastSeenAt: m.lastSeenAt,
      today: own ? { ...m.today } : null,
    };
  });
}

/**
 * Which person pages a viewer may open, as subject → href. PURE. The owner may
 * open anyone's; a household viewer only their own. Decided here, beside the
 * guard on /home/people/[subject], so a card never offers a link that page
 * would refuse.
 */
/** Whether a viewer may open this person's page: the owner anyone's, anyone else their own and their wards'. PURE. */
export function mayOpenPerson(viewer: PeopleViewer, subject: string): boolean {
  return viewer.kind === 'owner' || subject === viewer.subject || (viewer.wards ?? []).includes(subject);
}

export function personLinks(subjects: readonly string[], viewer: PeopleViewer): Record<string, string> {
  const open = viewer.kind === 'owner' ? subjects : subjects.filter((s) => mayOpenPerson(viewer, s));
  return Object.fromEntries(open.map((s) => [s, `/home/people/${encodeURIComponent(s)}`]));
}

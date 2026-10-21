// src/lib/trips/proposals.store.server.ts
//
// v8: the two writes on a stored proposal the contract's store
// (./decisions.store.server) does not have: refreshing a proposal's check
// after the plan moved on (accepting a stale proposal shows the new
// difference first), and turning an accepted proposal that could not be
// applied into an expired one (the claim is taken before applying, so two
// taps never apply it twice).

import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { tripProposal } from '$lib/db/schema';
import type { PlanDiff, Proposal, ProposalStatus, ProposalTradeoffs } from './decisions';

/** Store a re-check: the new difference, preview and trade-offs, against the version it was made on. Only while open. */
export async function updateProposalCheck(
  tripId: string,
  id: string,
  check: { diff: PlanDiff; preview: Proposal['preview']; tradeoffs: ProposalTradeoffs; basedOnVersion: number | null },
): Promise<void> {
  await db
    .update(tripProposal)
    .set({
      diff: check.diff as unknown as Record<string, unknown>,
      preview: check.preview as unknown[],
      tradeoffs: check.tradeoffs as unknown as Record<string, unknown>,
      basedOnVersion: check.basedOnVersion,
    })
    .where(and(eq(tripProposal.tripId, tripId), eq(tripProposal.id, id), eq(tripProposal.status, 'open')));
}

/** Move a proposal from one decided status to another (accepted → expired when it could not be applied). */
export async function moveProposal(tripId: string, id: string, from: ProposalStatus, to: Exclude<ProposalStatus, 'open'>, reason: string | null): Promise<void> {
  await db
    .update(tripProposal)
    .set({ status: to, reason, decidedAt: new Date() })
    .where(and(eq(tripProposal.tripId, tripId), eq(tripProposal.id, id), eq(tripProposal.status, from)));
}

/**
 * A new group for a slot replaces the slot's older open groups (a second
 * swap, a nudge): on the preview the rail filled with three groups for the
 * same stop. Closes open swap/fill/day proposals with the same day and part
 * of the day (and, for a swap, the same stop) that are not in `keep`.
 */
export async function supersedeSlot(tripId: string, slot: { date: string | null; stage: string | null; wishId: string | null }, keepGroup: string, reason: string): Promise<void> {
  if (!slot.date) return;
  await db
    .update(tripProposal)
    .set({ status: 'superseded', reason, decidedAt: new Date() })
    .where(
      and(
        eq(tripProposal.tripId, tripId),
        eq(tripProposal.status, 'open'),
        inArray(tripProposal.kind, ['swap', 'fill', 'day']),
        sql`${tripProposal.groupId} <> ${keepGroup}`,
        sql`${tripProposal.scope}->>'date' = ${slot.date}`,
        slot.stage ? sql`coalesce(${tripProposal.scope}->>'stage', '') = ${slot.stage}` : sql`true`,
        slot.wishId ? sql`coalesce(${tripProposal.scope}->>'wishId', '') = ${slot.wishId}` : sql`true`,
      ),
    );
}

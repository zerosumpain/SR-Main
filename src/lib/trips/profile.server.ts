// src/lib/trips/profile.server.ts
//
// Gathering the TravellerProfile (v3) and the one memory write the planner may
// make. OWNER ONLY (D2): it reads the owner's personal JKAI memory, the
// owner's knowledge search and the family roster's names — and refuses to run
// for a trip whose owner is not an allow-listed owner. Memories distilled from
// a member's conversation are dropped (./profile `ownerMemoriesOnly`).

import { and, eq, inArray, ne } from 'drizzle-orm';
import { db } from '$lib/db';
import { conversations, trip as tripTable } from '$lib/db/schema';
import { isOwnerEmail } from '$lib/server/access';
import type { TravellerProfile } from './model';
import { buildProfile, ownerMemoriesOnly, type KnowledgeRow, type MemoryRow, type RosterRow } from './profile';
import type { TripRecord } from './store.server';

const QUERIES = ['travel holiday trip flight hotel', 'food diet eat lunch dinner', 'walking pace mornings early late', 'family partner children'];

/** Conversation ids among `ids` that belong to a member (not the owner). */
async function memberConversations(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(inArray(conversations.id, ids), ne(conversations.principalId, 'owner')));
  return new Set(rows.map((r) => r.id));
}

/** The owner's memories that bear on travel, member-sourced ones removed. */
export async function ownerMemories(queries: string[] = QUERIES, limit = 25): Promise<MemoryRow[]> {
  const { retrieveMemories } = await import('$lib/jkai/memory/retrieve.server');
  const batches = await Promise.all([
    retrieveMemories('', 'preferences', limit).catch(() => []),
    retrieveMemories('', 'health', 10).catch(() => []),
    ...queries.map((q) => retrieveMemories(q, undefined, limit).catch(() => [])),
  ]);
  const byId = new Map<string, MemoryRow>();
  for (const batch of batches) {
    for (const r of batch as Array<MemoryRow & { provenance?: MemoryRow['provenance'] }>) {
      if (!byId.has(r.id)) byId.set(r.id, { id: r.id, category: r.category, content: r.content, sourceConversationId: r.sourceConversationId ?? null, provenance: r.provenance ?? null });
    }
  }
  const rows = [...byId.values()];
  const members = await memberConversations(rows.map((r) => r.sourceConversationId).filter((x): x is string => !!x)).catch(() => null);
  // If the member check cannot run, keep only memories with no conversation behind them.
  return members ? ownerMemoriesOnly(rows, members) : rows.filter((r) => !r.sourceConversationId && (r.provenance?.scope ?? 'personal') === 'personal');
}

/** Owner knowledge (their notes and memory) about travel — never a member reader. */
export async function ownerKnowledge(query: string): Promise<KnowledgeRow[]> {
  const { searchKnowledge } = await import('$lib/knowledge/search');
  const res = await searchKnowledge(query, { sources: ['notes', 'memory'], limitPerSource: 4 });
  return res.hits.map((h) => ({ source: h.source, title: h.title, passage: h.passage, ref: h.ref }));
}

async function roster(): Promise<RosterRow[]> {
  const { familyRoster } = await import('$lib/family/roster.server');
  return (await familyRoster()).map((p) => ({ name: p.name, email: p.email, parent: p.parent, id: p.id }));
}

/**
 * Gather and store the profile from the OWNER's memory. Only ever called when
 * the owner is the one asking (`asOwner`) — v5 trips may be created by any
 * family member, and their turns never trigger a read of the owner's memory.
 * Each source degrades on its own.
 */
export async function gatherProfile(trip: TripRecord, opts: { asOwner: boolean; ownerEmail?: string } = { asOwner: false }): Promise<TravellerProfile | null> {
  const owner = opts.ownerEmail ?? trip.ownerEmail;
  if (!opts.asOwner || !isOwnerEmail(owner)) return null;
  const [memories, knowledge, people] = await Promise.all([
    ownerMemories().catch((err) => {
      console.warn('[trips/profile] memory unavailable:', (err as Error)?.message);
      return [];
    }),
    ownerKnowledge(`${trip.destination} holiday travel trip`).catch(() => []),
    roster().catch(() => []),
  ]);
  const profile = buildProfile({ memories, knowledge, roster: people, ownerEmail: owner, now: new Date().toISOString(), previous: trip.profile });
  await db.update(tripTable).set({ profile: profile as unknown as Record<string, unknown> }).where(eq(tripTable.id, trip.id));
  return profile;
}

export async function saveProfile(tripId: string, profile: TravellerProfile): Promise<void> {
  await db.update(tripTable).set({ profile: profile as unknown as Record<string, unknown> }).where(eq(tripTable.id, tripId));
}

/**
 * The `remember` op: one LASTING preference the owner stated, saved to JKAI
 * memory through the same path chat's save_memory uses — origin 'user',
 * assertion 'stated' — with the trip message it came from as the source.
 * Nothing else in the planner writes to memory.
 */
export async function rememberStated(input: { text: string; category: 'preferences' | 'people' | 'health' | 'places'; messageId: string; ownerEmail: string }): Promise<{ id: string; stored: boolean }> {
  if (!isOwnerEmail(input.ownerEmail)) throw new Error('Only the owner’s statements are remembered.');
  const { writeMemory } = await import('$lib/jkai/memory/service.server');
  const row = await writeMemory({
    category: input.category,
    content: input.text,
    sourceConversationId: null,
    provenance: { origin: 'user', assertion: 'stated', sourceId: `trip-message:${input.messageId}` },
  });
  return { id: row.id, stored: (row as { stored?: boolean }).stored !== false };
}

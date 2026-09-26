// The owner-only fence for background readers.
//
// Members get jkai threads of their own. Nothing that runs in the background —
// heartbeat, daydream, the briefing, memory review, intel extraction, the
// recall tools — may read, deliver into, or learn from one: every one of those
// runs with the owner's tools, memory and context. They read the owner's
// threads (`principal_id = 'owner'`, which is every thread that existed before
// members did) and nothing else.
//
// Spec: docs/superpowers/specs/2026-09-26-access-groups-design.md (jkai chat).

import { and, eq, sql, type SQL } from 'drizzle-orm';
import type { AnyColumn } from 'drizzle-orm';
import { db } from '$lib/db';
import { conversations } from '$lib/db/schema';

/** WHERE predicate on `jkai_conversations`: the owner's threads. */
export const ownerThread: SQL = eq(conversations.principalId, 'owner');

/**
 * WHERE predicate on a row that MAY carry a thread id (a chat message, a
 * trace): true when it has no thread, or its thread is the owner's. Use it in
 * WHERE only — drizzle qualifies the column there (see the memory note on
 * select-list fragments rendering it bare).
 */
export function inOwnerThread(conversationId: AnyColumn): SQL {
  return sql`(${conversationId} is null or exists (select 1 from ${conversations} where ${conversations.id} = ${conversationId} and ${conversations.principalId} = 'owner'))`;
}

/** Is this thread the owner's? False for a member's thread and for one that does not exist. */
export async function isOwnerThread(conversationId: string): Promise<boolean> {
  if (!conversationId) return false;
  const [row] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), ownerThread))
    .limit(1);
  return !!row;
}

/** Throw unless the thread is the owner's — the chokepoint for owner-grade background turns. */
export async function assertOwnerThread(conversationId: string, what: string): Promise<void> {
  if (!(await isOwnerThread(conversationId))) {
    throw new Error(`${what}: thread ${conversationId} is not the owner's — refused`);
  }
}

/**
 * Is this an existing thread that is NOT the owner's? For best-effort owner
 * paths that must keep working on a thread id that does not resolve yet (an
 * upload can name its thread before the row lands) while still never touching
 * a member's thread.
 */
export async function isMemberThread(conversationId: string | null | undefined): Promise<boolean> {
  if (!conversationId) return false;
  const [row] = await db
    .select({ principalId: conversations.principalId })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  return !!row && row.principalId !== 'owner';
}

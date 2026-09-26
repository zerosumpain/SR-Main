// Who may read, post in and manage which jkai thread — the guard every chat
// route calls before it touches a conversation or a job.
//
// A thread the caller may not read is a 404, exactly like one that does not
// exist. Posting is stricter than writing: you post only in your OWN thread,
// the owner included — a member's thread is theirs to talk in, and an owner
// turn in it would run with the owner's tools and memory. Every thread that
// existed before access groups is the owner's, so this refuses nothing that
// works today.
//
// Spec: docs/superpowers/specs/2026-09-26-access-groups-design.md (jkai chat).

import { error } from '@sveltejs/kit';
import { and, count, eq, gte, sql, type SQL } from 'drizzle-orm';
import { db } from '$lib/db';
import { accessUsage, conversations } from '$lib/db/schema';
import { areaAccess, canRead, canWrite, readable, type AreaAccess } from '$lib/server/area-scope';
import { getSetting } from '$lib/server/models/settings';
import { getJob, type OrchestratorJob } from '$lib/workflows/chat/job-store';

export type ConversationRow = typeof conversations.$inferSelect;

export async function chatAccess(event: { locals: App.Locals }): Promise<AreaAccess> {
  return areaAccess(event, 'jkai.chat');
}

export async function requireConversation(
  event: { locals: App.Locals },
  id: string,
  intent: 'read' | 'write' | 'post' = 'read',
): Promise<{ conversation: ConversationRow; access: AreaAccess }> {
  const access = await chatAccess(event);
  const [conversation] = id ? await db.select().from(conversations).where(eq(conversations.id, id)).limit(1) : [];
  if (!conversation || !canRead(conversation.principalId, access)) throw error(404, 'Conversation not found');
  if (intent === 'write' && !canWrite(conversation.principalId, access)) throw error(403, 'Forbidden');
  if (intent === 'post' && conversation.principalId !== access.own) throw error(403, 'You can only post in your own threads.');
  return { conversation, access };
}

/**
 * A chat job the caller may see, stream, answer or cancel — or a 404, exactly
 * as for a job that does not exist. The owner reaches every job (he always
 * could: the admin pulse and "cancel all" are his); anyone else only their own.
 * A job with no principal predates members and is the owner's.
 */
export async function requireOwnJob(
  event: { locals: App.Locals },
  jobId: string,
): Promise<{ job: OrchestratorJob; access: AreaAccess }> {
  const access = await chatAccess(event);
  const job = jobId ? getJob(jobId) : null;
  if (!job) throw error(404, 'Job not found');
  if (access.level !== 'owner' && (job.scope.principalId ?? 'owner') !== access.own) {
    throw error(404, 'Job not found');
  }
  return { job, access };
}

/**
 * Owner-only chat surfaces (the context rail and its drill, the memory panel,
 * tool traces): they read the owner's health, places, research and memory,
 * whoever's thread they are asked about. Anyone else is a 403.
 */
export async function requireChatOwner(event: { locals: App.Locals }): Promise<void> {
  const access = await chatAccess(event);
  if (access.level !== 'owner') throw error(403, 'owner only');
}

/**
 * The threads a thread LIST shows. The owner's hub is the owner's own threads
 * — exactly what it showed before members existed; a member sees what
 * `readable` gives them.
 */
export function conversationListScope(access: AreaAccess): SQL {
  if (access.level === 'owner') return eq(conversations.principalId, 'owner');
  return readable(conversations.principalId, access);
}

/** Member chat turns per rolling 24 h, unless the `access.chat.dailyTurns` setting says otherwise. */
export const CHAT_DAILY_TURNS = 50;

/** PURE: may this reader take one more turn? The owner is never capped. */
export function chatTurnDecision(
  access: AreaAccess,
  usedToday: number,
  cap: number = CHAT_DAILY_TURNS,
): { ok: true } | { ok: false; status: number; error: string } {
  if (access.level === 'owner') return { ok: true };
  if (usedToday >= cap) {
    return { ok: false, status: 429, error: `That is ${cap} messages today — the limit. Try again tomorrow.` };
  }
  return { ok: true };
}

/**
 * Take one metered chat turn, or throw the refusal. Count and ledger row under
 * a per-principal advisory lock, as `reserveResearchStart` does.
 */
export async function reserveChatTurn(access: AreaAccess): Promise<void> {
  if (access.level === 'owner') return;
  const setting = await getSetting<number>('access.chat.dailyTurns').catch(() => null);
  const cap = typeof setting === 'number' && setting > 0 ? setting : CHAT_DAILY_TURNS;
  const refusal = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`access_usage:chat:${access.own}`}))`);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [row] = await tx
      .select({ n: count() })
      .from(accessUsage)
      .where(and(eq(accessUsage.principalId, access.own), eq(accessUsage.kind, 'chat'), gte(accessUsage.at, since)));
    const decision = chatTurnDecision(access, Number(row?.n ?? 0), cap);
    if (!decision.ok) return decision;
    await tx.insert(accessUsage).values({ principalId: access.own, kind: 'chat' });
    return null;
  });
  if (refusal) throw error(refusal.status, refusal.error);
}

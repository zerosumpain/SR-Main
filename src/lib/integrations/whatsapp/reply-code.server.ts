import { sql, eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { conversations, orchestratorChats } from '$lib/db/schema';
import { isOwnerNumber } from '$lib/config/owner-number';
import { declaredTier } from '$lib/tools/declared-tier';
import { unattendedPrincipal } from '$lib/tools/in-process-principal';
import type { FrozenCall } from '$lib/jkai/chat/turn';
import { WHATSAPP_CONFIRM_BY_CODE } from './tool-whitelist';
import {
  REPLY_CODE_KIND,
  answerReplyCode,
  issueReplyCode,
  type ReplyCodeAnswer,
  type ReplyCodeDeps,
  type ReplyCodeRecord,
  type ReplyCodeStore,
} from './reply-code';

/**
 * The real wiring for `./reply-code.ts`: `jkai_gates` as the store, the tool
 * catalogue for eligibility and execution, and the WhatsApp thread rows.
 *
 * The store is Slice 8's `jkai_gates` (no new table). Its rows hang off a
 * `jkai_turns` row by foreign key, so each code gets one synthetic turn row:
 * job id `wa-reply:<uuid>`, status 'done' (the turn has ended), and NO
 * conversation id, so `/chat/active`, the open-turn dots and the stale-lease
 * reaper never see it, and Core's cross-slot relay (which only answers gates
 * of 'running' or 'gated' turns) can never answer it. The conversation is kept
 * on the gate row and in its payload.
 *
 * Core only freezes a call when `JKAI_DURABLE_TURNS` is on in Core, so these
 * tables exist whenever a code is asked for; if a write still fails, nothing
 * waits and the reply says it could not ask.
 */
export const sqlReplyCodeStore: ReplyCodeStore = {
  async open(rec) {
    const jobId = `wa-reply:${rec.gateKey.slice(REPLY_CODE_KIND.length + 1)}`;
    await db.execute(sql`INSERT INTO jkai_turns (job_id, conversation_id, principal_id, surface, slot, status, phase, workload, last_seq, ended_at)
      VALUES (${jobId}, NULL, 'owner', 'whatsapp', 'whatsapp-reply-code', 'done', 'awaiting-reply-code', 'chat', -1, now())`);
    await db.execute(sql`INSERT INTO jkai_gates (job_id, gate_key, kind, principal_id, conversation_id, payload)
      VALUES (${jobId}, ${rec.gateKey}, ${REPLY_CODE_KIND}, 'owner', ${rec.conversationId}, ${JSON.stringify(rec)}::jsonb)`);
  },
  async latestOpen(sender) {
    const res = await db.execute(sql`SELECT payload FROM jkai_gates
      WHERE kind = ${REPLY_CODE_KIND} AND answered_at IS NULL AND payload ->> 'sender' = ${sender}
      ORDER BY opened_at DESC LIMIT 1`);
    const row = (res as unknown as { rows?: Array<{ payload: ReplyCodeRecord }> }).rows?.[0];
    return row?.payload ?? null;
  },
  async close(gateKey, answer) {
    const res = await db.execute(sql`UPDATE jkai_gates SET answered_at = now(), answer = ${JSON.stringify(answer)}::jsonb,
        answered_by = 'whatsapp', consumed_at = now()
      WHERE kind = ${REPLY_CODE_KIND} AND gate_key = ${gateKey} AND answered_at IS NULL RETURNING gate_key`);
    return ((res as unknown as { rows?: unknown[] }).rows?.length ?? 0) > 0;
  },
  async closeAllFor(sender, answer) {
    await db.execute(sql`UPDATE jkai_gates SET answered_at = now(), answer = ${JSON.stringify(answer)}::jsonb,
        answered_by = 'whatsapp', consumed_at = now()
      WHERE kind = ${REPLY_CODE_KIND} AND answered_at IS NULL AND payload ->> 'sender' = ${sender}`);
  },
};

/**
 * On the confirm-by-code list AND still a mutate on the standard lane that
 * does not always confirm, read from the live catalogue: a tool whose tier was
 * raised after the code was issued is no longer run by it.
 */
export async function replyCodeEligible(tool: string): Promise<boolean> {
  if (!(WHATSAPP_CONFIRM_BY_CODE as readonly string[]).includes(tool)) return false;
  const { loadToolRegistry } = await import('$lib/tools/load-registry');
  const def = (await loadToolRegistry()).getTool(tool);
  if (!def) return false;
  const tier = declaredTier(def);
  return tier.effect === 'mutate' && tier.confirm !== 'always' && tier.lane === 'standard';
}

const deps = (): ReplyCodeDeps => ({ store: sqlReplyCodeStore, isOwner: isOwnerNumber, eligible: replyCodeEligible });

/** After a WhatsApp turn whose call Core froze: the text to add under the reply. */
export function askForReplyCode(from: string, conversationId: string, call: FrozenCall): Promise<string> {
  return issueReplyCode({ from, conversationId, call }, deps());
}

/**
 * The intercept's step: John's message against his open code, if any. The
 * confirmed call runs in this process as an unattended WhatsApp principal
 * that lists exactly that one tool, so `executeTool`'s principal check still
 * refuses anything destructive or always-confirm, whatever the row says.
 */
export async function handleReplyCode(from: string, text: string): Promise<ReplyCodeAnswer> {
  try {
    const [conv] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.whatsappPhoneNumber, from))
      .limit(1);
    const answer = await answerReplyCode(
      { from, text, conversationId: conv?.id ?? null },
      {
        ...deps(),
        execute: async (tool, args) => {
          const { executeSiteTool } = await import('$lib/tools/executor');
          return executeSiteTool(tool, args, {
            emit: () => {},
            conversationId: conv?.id,
            principal: unattendedPrincipal('whatsapp-reply-code', [tool], 'whatsapp'),
          });
        },
      },
    );
    // The code and its outcome belong in the thread, like any other exchange.
    if (answer.handled && answer.reply && conv) {
      await db.insert(orchestratorChats).values([
        { conversationId: conv.id, role: 'user', content: text, metadata: { channel: 'whatsapp' } },
        { conversationId: conv.id, role: 'assistant', content: answer.reply, metadata: { channel: 'whatsapp', ...(answer.ran ? { replyCode: answer.ran } : {}) } },
      ]);
    }
    return answer;
  } catch (err) {
    console.error('[whatsapp-reply-code] answer failed:', err instanceof Error ? err.message : err);
    // A code-shaped message that could not be checked must not reach chat as
    // if nothing were pending; anything else carries on.
    return /^\s*\d{4}\s*[.!]?\s*$/.test(text) ? { handled: true, reply: "I couldn't check that code just now, so I haven't done anything." } : { handled: false };
  }
}

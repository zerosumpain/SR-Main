import { db } from '$lib/db';
import { orchestratorChats, scheduledCallbacks } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import type { ScheduledCallback } from '$lib/db/schema';
import type { FireResult, ReplyPayload, ToolPayload, OrchestratorTurnPayload } from './types';

/**
 * Execute one scheduled callback. Marks status='fired' on success or
 * 'failed' on error. Returns a FireResult summary so the engine can log
 * cleanly. Each kind handler is intentionally tiny — no shared abstractions
 * because the three behaviours are genuinely different.
 */
export async function fireCallback(row: ScheduledCallback): Promise<FireResult> {
  try {
    let result: FireResult;
    switch (row.kind) {
      case 'reply':
        result = await fireReply(row);
        break;
      case 'tool':
        result = await fireTool(row);
        break;
      case 'orchestrator-turn':
        result = await fireOrchestratorTurn(row);
        break;
      default:
        result = { ok: false, summary: `unknown kind ${row.kind}`, error: `unknown kind ${row.kind}` };
    }

    await db.update(scheduledCallbacks).set({
      status: result.ok ? 'fired' : 'failed',
      firedAt: new Date(),
      error: result.error ?? null,
      totalCostUsd: ((Number(row.totalCostUsd) || 0) + (result.costUsd ?? 0)).toFixed(6),
      updatedAt: new Date(),
    }).where(eq(scheduledCallbacks.id, row.id));

    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.update(scheduledCallbacks).set({
      status: 'failed',
      firedAt: new Date(),
      error: msg.slice(0, 500),
      updatedAt: new Date(),
    }).where(eq(scheduledCallbacks.id, row.id));
    return { ok: false, summary: msg.slice(0, 200), error: msg };
  }
}

async function fireReply(row: ScheduledCallback): Promise<FireResult> {
  const payload = row.payload as ReplyPayload;
  if (!row.conversationId) return { ok: false, summary: 'reply requires conversation_id', error: 'no conversation_id' };
  if (!payload.text) return { ok: false, summary: 'reply requires payload.text', error: 'no text' };

  await db.insert(orchestratorChats).values({
    conversationId: row.conversationId,
    role: 'assistant',
    content: payload.text,
    metadata: { scheduledCallback: { id: row.id, name: row.name, kind: 'reply' } },
  });

  if (payload.notifyWhatsApp) {
    try {
      const { notifySubscribers } = await import('$lib/workflows/chat/followup-queue');
      notifySubscribers(row.conversationId, { role: 'assistant', content: payload.text, source: 'scheduled' });
    } catch {
      // noop — SSE delivery is best-effort
    }
  }

  return { ok: true, summary: `posted reply (${payload.text.length} chars)` };
}

async function fireTool(row: ScheduledCallback): Promise<FireResult> {
  const payload = row.payload as ToolPayload;
  if (!payload.toolName) return { ok: false, summary: 'tool requires payload.toolName', error: 'no toolName' };

  const { executeSiteTool, isRegisteredTool } = await import('$lib/workflows/site-tools/executor');
  if (!isRegisteredTool(payload.toolName)) {
    return { ok: false, summary: `unknown tool ${payload.toolName}`, error: `tool not registered` };
  }

  const ctx = {
    emit: () => {},
    conversationId: row.conversationId ?? undefined,
  };
  const out = await executeSiteTool(payload.toolName, payload.args ?? {}, ctx);

  // If we have a conversation, drop a small note so the user sees what happened.
  if (row.conversationId) {
    const summary = out?.success
      ? `[scheduled] ${payload.toolName} fired — ${describeData(out.data)}`
      : `[scheduled] ${payload.toolName} failed: ${out?.error ?? 'unknown error'}`;
    await db.insert(orchestratorChats).values({
      conversationId: row.conversationId,
      role: 'assistant',
      content: summary,
      metadata: { scheduledCallback: { id: row.id, name: row.name, kind: 'tool', tool: payload.toolName, success: out?.success } },
    });
  }

  return {
    ok: !!out?.success,
    summary: out?.success ? `tool ${payload.toolName} ok` : `tool ${payload.toolName} failed`,
    error: out?.success ? undefined : out?.error,
  };
}

async function fireOrchestratorTurn(row: ScheduledCallback): Promise<FireResult> {
  const payload = row.payload as OrchestratorTurnPayload;
  if (!row.conversationId) return { ok: false, summary: 'orchestrator-turn requires conversation_id', error: 'no conversation_id' };
  if (!payload.message) return { ok: false, summary: 'orchestrator-turn requires payload.message', error: 'no message' };

  // Re-engage the orchestrator by inserting a synthetic user message and
  // running a focused chat turn against it. Uses the heartbeat LLM helper
  // (no plan/clarify phases — this is system-driven, not user-driven).
  const { runHeartbeatTurn } = await import('$lib/heartbeat/llm');
  const turn = await runHeartbeatTurn({
    conversationId: row.conversationId,
    userText: payload.message,
    activityName: row.name,
    instruction:
      'You are responding to a scheduled re-engagement of this conversation. Treat the message above as a system reminder. Be concise and concrete. You may call tools (system + home toolsets are available) to actually do things — e.g. turn off lights, send messages — not just narrate.',
    maxTokens: 800,
    toolsEnabled: true,
  });
  return {
    ok: true,
    summary: `orchestrator turn — ${turn.reply.slice(0, 120)}`,
    costUsd: 0, // cost is approximated separately; runHeartbeatTurn doesn't compute USD
  };
}

function describeData(data: unknown): string {
  if (data == null) return 'no data';
  if (typeof data !== 'object') return String(data).slice(0, 80);
  try {
    return JSON.stringify(data).slice(0, 120);
  } catch {
    return '[object]';
  }
}

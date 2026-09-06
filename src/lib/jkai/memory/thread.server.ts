// The thread inspector's Memory mode — the composer.
//
// THIS HALF TOUCHES THE DB. Types and the zod schema are in `thread.ts`.
//
// Three sources, each answering a different question, and deliberately not
// blended into one "memory activity" list:
//
//   1. `orchestrator_chats.metadata.memory` on assistant rows — what a turn
//      was GIVEN at assembly. Written by the chat route since this shipped;
//      absent before, and reported as absent.
//   2. `jkai_tool_traces.steps` — memory TOOL calls the model made on its
//      own initiative (save / recall / forget), with the turn's clock.
//   3. `jkai_memories` itself — provenance (`sourceConversationId`), lineage
//      (`supersededBy`), validity, pins. The state vocabulary comes from the
//      row and nothing else (`memoryState`).

import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { conversations, jkaiMemories, jkaiToolTraces, orchestratorChats } from '$lib/db/schema';
import type { ToolTrace } from '$lib/jkai/tool-trace';
import { memoryLinks } from './graph.server';
import { retrieveMemories } from './retrieve.server';
import { memoryIdsInStep, memoryState, memoryToolVerb, type MemoryTurnStamp } from './contracts';
import { MEMORY_PROMPT_BUDGET, type ThreadMemoryEvent, type ThreadMemoryPayload, type ThreadMemoryRow } from './thread';

type MemoryRow = typeof jkaiMemories.$inferSelect;

const RECENT_MESSAGES = 12;
const RELEVANT_LIMIT = 8;
const CHANGED_LIMIT = 10;
const STALE_WINDOW_MS = 30 * 86400000;

/** Personal scope only — the scope chat retrieves. Daydream findings have
 *  their own room and their own lens. */
const personalScope = () =>
  and(isNull(jkaiMemories.daydreamOrigin), sql`coalesce(${jkaiMemories.provenance}->>'scope','personal')='personal'`);

interface Usage {
  servedTurns: number;
  lastServedAt: string | null;
  events: number;
}

/** Stamps off the assistant rows, newest first. */
async function readStamps(conversationId: string) {
  const rows = await db
    .select({ id: orchestratorChats.id, createdAt: orchestratorChats.createdAt, metadata: orchestratorChats.metadata })
    .from(orchestratorChats)
    .where(and(eq(orchestratorChats.conversationId, conversationId), eq(orchestratorChats.role, 'assistant')))
    .orderBy(desc(orchestratorChats.createdAt))
    .limit(200);
  const stamped: Array<{ at: Date; stamp: MemoryTurnStamp }> = [];
  for (const r of rows) {
    const meta = (r.metadata ?? {}) as { memory?: Partial<MemoryTurnStamp> };
    const m = meta.memory;
    if (!m || !Array.isArray(m.served)) continue;
    stamped.push({
      at: r.createdAt,
      stamp: {
        served: m.served.filter((x): x is string => typeof x === 'string'),
        retrieved: Number(m.retrieved ?? 0),
        chars: Number(m.chars ?? 0),
        ...(m.unavailable ? { unavailable: true } : {}),
      },
    });
  }
  return stamped;
}

/** Memory tool calls off the recorded traces, newest first. */
async function readEvents(conversationId: string): Promise<ThreadMemoryEvent[]> {
  const traces = await db
    .select({ id: jkaiToolTraces.id, createdAt: jkaiToolTraces.createdAt, steps: jkaiToolTraces.steps })
    .from(jkaiToolTraces)
    .where(eq(jkaiToolTraces.conversationId, conversationId))
    .orderBy(desc(jkaiToolTraces.createdAt))
    .limit(60);
  const events: ThreadMemoryEvent[] = [];
  for (const t of traces) {
    const trace = t.steps as Partial<ToolTrace> | null;
    for (const step of trace?.steps ?? []) {
      const tool = step.displayTool || step.tool;
      const verb = memoryToolVerb(tool);
      if (!verb) continue;
      events.push({
        id: `${t.id}:${step.seq}`,
        verb,
        tool,
        at: new Date(step.startedAt || +t.createdAt).toISOString(),
        memoryIds: memoryIdsInStep({ tool, args: step.args, result: step.result }),
        summary: step.summary ?? null,
        traceId: t.id,
      });
    }
  }
  return events;
}

function toRow(
  m: MemoryRow & { recalledBecause?: string | null },
  entities: Array<{ id: string; name: string }>,
  replacedBy: { id: string; content: string } | null,
  conversationId: string,
  use: Usage,
  now: number,
): ThreadMemoryRow {
  return {
    id: m.id,
    category: m.category,
    content: m.content,
    confidence: m.confidence,
    state: memoryState(m, now),
    origin: m.provenance?.origin ?? (m.daydreamOrigin ? `daydream-${m.daydreamOrigin}` : 'legacy'),
    assertion: m.provenance?.assertion ?? 'unverified',
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
    validFrom: m.provenance?.validFrom ?? null,
    validUntil: m.provenance?.validUntil ?? null,
    pinned: Boolean(m.provenance?.pinned),
    recalledBecause: m.recalledBecause ?? null,
    entities,
    replacedBy,
    fromThisThread: m.sourceConversationId === conversationId,
    use,
  };
}

export async function composeThreadMemory(conversationId: string): Promise<ThreadMemoryPayload | null> {
  const now = Date.now();
  const [[conversation], recentDesc, stamps, events] = await Promise.all([
    db
      .select({ id: conversations.id, title: conversations.title, lastMemoryReview: conversations.lastMemoryReview })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1),
    db
      .select({ role: orchestratorChats.role, content: orchestratorChats.content })
      .from(orchestratorChats)
      .where(eq(orchestratorChats.conversationId, conversationId))
      .orderBy(desc(orchestratorChats.createdAt))
      .limit(RECENT_MESSAGES),
    readStamps(conversationId),
    readEvents(conversationId),
  ]);
  if (!conversation) return null;

  // ── Usage per memory, from the two recorded sources ───────────────────
  const use = new Map<string, Usage>();
  const bump = (id: string, patch: Partial<Usage> & { at?: string }) => {
    const u = use.get(id) ?? { servedTurns: 0, lastServedAt: null, events: 0 };
    if (patch.servedTurns) {
      u.servedTurns += patch.servedTurns;
      if (patch.at && (!u.lastServedAt || patch.at > u.lastServedAt)) u.lastServedAt = patch.at;
    }
    if (patch.events) u.events += patch.events;
    use.set(id, u);
  };
  for (const s of stamps) for (const id of s.stamp.served) bump(id, { servedTurns: 1, at: s.at.toISOString() });
  for (const e of events) for (const id of e.memoryIds) bump(id, { events: 1 });
  const usageOf = (id: string): Usage => use.get(id) ?? { servedTurns: 0, lastServedAt: null, events: 0 };

  // ── The query retrieval will run for "relevant now" ───────────────────
  // The user's recent words, oldest first, capped — the same material the
  // chat hands `retrieveMemories`, minus the turn that has not been typed.
  const recentUser = recentDesc
    .slice()
    .reverse()
    .filter((m) => m.role === 'user')
    .map((m) => m.content)
    .join('\n');
  const relevantQuery = `${conversation.title ?? ''}\n${recentUser}`.trim().slice(-1200);

  const lastStamp = stamps[0] ?? null;
  const servedIds = lastStamp?.stamp.served ?? [];

  const [relevantRows, servedRows, threadRows, changedRows, counts] = await Promise.all([
    relevantQuery ? retrieveMemories(relevantQuery, undefined, RELEVANT_LIMIT).catch(() => []) : Promise.resolve([]),
    servedIds.length
      ? db.select().from(jkaiMemories).where(inArray(jkaiMemories.id, servedIds))
      : Promise.resolve([] as MemoryRow[]),
    db
      .select()
      .from(jkaiMemories)
      .where(and(eq(jkaiMemories.sourceConversationId, conversationId), personalScope()))
      .orderBy(desc(jkaiMemories.updatedAt))
      .limit(20),
    db
      .select()
      .from(jkaiMemories)
      .where(personalScope())
      .orderBy(desc(jkaiMemories.updatedAt))
      .limit(CHANGED_LIMIT),
    db
      .select({
        live: sql<number>`count(*) filter (where ${jkaiMemories.supersededBy} is null)`,
        pinned: sql<number>`count(*) filter (where ${jkaiMemories.supersededBy} is null and ${jkaiMemories.provenance}->>'pinned' = 'true')`,
        writtenHere: sql<number>`count(*) filter (where ${jkaiMemories.sourceConversationId} = ${conversationId})`,
        stale30d: sql<number>`count(*) filter (where ${jkaiMemories.supersededBy} is not null and ${jkaiMemories.updatedAt} >= ${new Date(now - STALE_WINDOW_MS)})`,
      })
      .from(jkaiMemories)
      .where(personalScope()),
  ]);

  // Memories the events name that no list above holds — a recalled row that
  // has since been replaced still belongs in THREAD, as history.
  const eventIds = [...new Set(events.flatMap((e) => e.memoryIds))];
  const known = new Set<string>([...relevantRows, ...servedRows, ...threadRows, ...changedRows].map((r) => r.id));
  const missing = eventIds.filter((id) => !known.has(id));
  const eventRows = missing.length ? await db.select().from(jkaiMemories).where(inArray(jkaiMemories.id, missing)) : [];

  // ── Entities and lineage for everything we will show ──────────────────
  const all = new Map<string, MemoryRow & { recalledBecause?: string | null }>();
  for (const r of [...relevantRows, ...servedRows, ...threadRows, ...changedRows, ...eventRows]) {
    const prev = all.get(r.id);
    // Keep a retrieval row over a plain one: it carries `recalledBecause`.
    if (!prev || ('recalledBecause' in r && !('recalledBecause' in prev))) all.set(r.id, r as MemoryRow & { recalledBecause?: string | null });
  }
  const ids = [...all.keys()];
  const replacedIds = [...new Set([...all.values()].map((r) => r.supersededBy).filter((s): s is string => Boolean(s) && s !== 'forgotten'))];
  const [links, replacements] = await Promise.all([
    ids.length ? memoryLinks(ids) : Promise.resolve([]),
    replacedIds.length
      ? db.select({ id: jkaiMemories.id, content: jkaiMemories.content }).from(jkaiMemories).where(inArray(jkaiMemories.id, replacedIds))
      : Promise.resolve([] as Array<{ id: string; content: string }>),
  ]);
  const entitiesOf = (id: string) => links.filter((l) => l.memory_id === id).map((l) => ({ id: l.id, name: l.name }));
  const replacementOf = (m: MemoryRow) =>
    m.supersededBy && m.supersededBy !== 'forgotten'
      ? (replacements.find((r) => r.id === m.supersededBy) ?? { id: m.supersededBy, content: '' })
      : null;
  const rowOf = (id: string): ThreadMemoryRow | null => {
    const m = all.get(id);
    return m ? toRow(m, entitiesOf(id), replacementOf(m), conversationId, usageOf(id), now) : null;
  };
  const rowsOf = (list: Array<{ id: string }>) => list.map((r) => rowOf(r.id)).filter((r): r is ThreadMemoryRow => r !== null);

  // THREAD = written here ∪ touched by a tool event here, newest first.
  const threadIds = [...new Set([...threadRows.map((r) => r.id), ...eventIds])];
  const threadList = threadIds
    .map((id) => rowOf(id))
    .filter((r): r is ThreadMemoryRow => r !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const c = counts[0];
  return {
    conversationId,
    recorded: stamps.length > 0,
    lastTurn: lastStamp
      ? {
          at: lastStamp.at.toISOString(),
          served: lastStamp.stamp.served.length,
          retrieved: lastStamp.stamp.retrieved,
          chars: lastStamp.stamp.chars,
          budget: MEMORY_PROMPT_BUDGET,
          unavailable: Boolean(lastStamp.stamp.unavailable),
        }
      : null,
    figures: {
      live: Number(c?.live ?? 0),
      pinned: Number(c?.pinned ?? 0),
      writtenHere: Number(c?.writtenHere ?? 0),
      stale30d: Number(c?.stale30d ?? 0),
    },
    // In the order the prompt carried them.
    served: servedIds.map((id) => rowOf(id)).filter((r): r is ThreadMemoryRow => r !== null),
    omittedLastTurn: lastStamp ? Math.max(0, lastStamp.stamp.retrieved - lastStamp.stamp.served.length) : 0,
    relevant: rowsOf(relevantRows),
    relevantQuery,
    thread: { rows: threadList, events: events.slice(0, 40) },
    changed: rowsOf(changedRows),
    lastReviewAt: conversation.lastMemoryReview?.toISOString() ?? null,
  };
}

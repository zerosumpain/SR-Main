// The knowledge graph beside a /jkai thread.
//
// Answers "what does this conversation know about, and what does that connect
// to?" from two sources, deliberately kept separate:
//
//  1. STRUCTURAL nodes — free, always present, derived from what the thread
//     demonstrably touched: the models that answered, the attachments it
//     carried, the /drive files it cited (@files), the canvases it built, the
//     research sessions it drew on. No LLM call, no latency, no spend.
//
//  2. CONCEPT nodes — the entities the intel pipeline extracted from the
//     thread's own text (auto-extract kind 'chat'). These are what make the
//     rail read like a graph rather than a file list, and they arrive on the
//     same extract → persist → embed path every other intel source uses, so a
//     concept surfaced here is the same row /jkai/intel already knows about.
//
// Edges are either real intel relationships (typed verbs — SUPERSEDES, CAUSES)
// between concept nodes, or co-occurrence between things that appeared in the
// same turn (MENTIONED WITH). Co-occurrence is labelled honestly rather than
// dressed up as a semantic relation.

import { db } from '$lib/db';
import {
  conversations,
  orchestratorChats,
  jkaiAttachments,
  intelNotes,
  intelNoteEntities,
  intelEntities,
  intelEntityTypes,
  intelRelationships,
} from '$lib/db/schema';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { shortModelLabel } from '$lib/jkai/model-label';
import { readTurnStamp } from '$lib/jkai/turn-stamp';

export type ThreadNodeKind =
  | 'concept'
  | 'model'
  | 'artefact'
  | 'doc'
  | 'image'
  | 'run'
  | 'intel';

export interface ThreadGraphNode {
  id: string;
  kind: ThreadNodeKind;
  /** Type label shown in the detail panel — `CONCEPT`, `FAILURE MODE`, `DOC`… */
  type: string;
  /** Full name. The rail shortens it for the chip and shows this in detail. */
  name: string;
  note: string | null;
  /** Deep link, when the node points at something with a page. */
  href: string | null;
  /** ISO timestamp of the turn this node was last seen in. */
  lastSeen: string | null;
  /** Index of the turn(s) this node appeared in — drives co-occurrence edges. */
  turns: number[];
}

export interface ThreadGraphEdge {
  source: string;
  target: string;
  /** ER verb: `SUPERSEDES`, `CAUSES`, `MENTIONED WITH`… */
  verb: string;
  /** True for a real intel relationship rather than co-occurrence. */
  typed: boolean;
}

export interface ThreadGraph {
  nodes: ThreadGraphNode[];
  edges: ThreadGraphEdge[];
  /** True once the concept-extraction pass has produced a derived note. */
  conceptsReady: boolean;
}

/** Verb used when two things merely showed up in the same turn. */
const CO_OCCURRENCE_VERB = 'MENTIONED WITH';

/** A node the rail can plausibly draw. More than this and the 324px canvas
 *  turns to soup, so the least-connected are dropped (see rankAndTrim). */
const MAX_NODES = 12;

function pushTurn(node: ThreadGraphNode, turn: number): void {
  if (!node.turns.includes(turn)) node.turns.push(turn);
}

export async function buildThreadGraph(conversationId: string): Promise<ThreadGraph> {
  const [conv] = await db
    .select({ modelId: conversations.modelId, updatedAt: conversations.updatedAt })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  if (!conv) return { nodes: [], edges: [], conceptsReady: false };

  const messages = await db
    .select({
      id: orchestratorChats.id,
      role: orchestratorChats.role,
      metadata: orchestratorChats.metadata,
      createdAt: orchestratorChats.createdAt,
    })
    .from(orchestratorChats)
    .where(eq(orchestratorChats.conversationId, conversationId))
    .orderBy(asc(orchestratorChats.createdAt));

  const byId = new Map<string, ThreadGraphNode>();
  const add = (
    node: Omit<ThreadGraphNode, 'turns'> & { turns?: number[] },
    turn: number,
  ): ThreadGraphNode => {
    const existing = byId.get(node.id);
    if (existing) {
      pushTurn(existing, turn);
      if (node.lastSeen) existing.lastSeen = node.lastSeen;
      return existing;
    }
    const created: ThreadGraphNode = { ...node, turns: [turn] };
    byId.set(created.id, created);
    return created;
  };

  // ── Structural nodes ──────────────────────────────────────────────────────
  messages.forEach((m, turn) => {
    const iso = m.createdAt instanceof Date ? m.createdAt.toISOString() : String(m.createdAt);
    const meta = (m.metadata ?? {}) as Record<string, unknown>;

    const stamp = readTurnStamp(meta);
    if (stamp?.model) {
      add(
        {
          id: `model:${stamp.model}`,
          kind: 'model',
          type: 'MODEL',
          name: stamp.model,
          note: 'Answered turns in this thread.',
          href: '/admin/ai/models',
          lastSeen: iso,
        },
        turn,
      );
    }

    for (const ref of Array.isArray(meta.fileRefs) ? meta.fileRefs : []) {
      const r = ref as { fileId?: string; source?: string; modality?: string; passage?: string };
      if (!r?.fileId) continue;
      add(
        {
          id: `file:${r.fileId}`,
          kind: r.modality === 'image' ? 'image' : 'doc',
          type: r.modality === 'image' ? 'IMAGE' : 'DOC',
          name: r.source || 'file',
          note: r.passage ? r.passage.slice(0, 180) : 'Cited from /drive by this thread.',
          href: '/drive',
          lastSeen: iso,
        },
        turn,
      );
    }

    for (const ref of Array.isArray(meta.researchRefs) ? meta.researchRefs : []) {
      const r = ref as { sessionId?: string; sessionTopic?: string; passage?: string };
      if (!r?.sessionId) continue;
      add(
        {
          id: `research:${r.sessionId}`,
          kind: 'intel',
          type: 'RESEARCH',
          name: r.sessionTopic || 'deep dive',
          note: r.passage ? r.passage.slice(0, 180) : 'Deep-dive research drawn on by this thread.',
          href: `/deepdive/${r.sessionId}`,
          lastSeen: iso,
        },
        turn,
      );
    }

    for (const ref of Array.isArray(meta.workflowRefs) ? meta.workflowRefs : []) {
      const r = ref as { workflowId?: string; name?: string; slug?: string; url?: string };
      if (!r?.workflowId) continue;
      add(
        {
          id: `run:${r.workflowId}`,
          kind: 'run',
          type: 'RUN',
          name: r.name || r.slug || 'canvas',
          note: 'Canvas created or updated from this thread.',
          href: r.url ?? (r.slug ? `/jkai/canvas/${r.slug}` : '/jkai/canvas'),
          lastSeen: iso,
        },
        turn,
      );
    }
  });

  // Attachments carried by the thread (both directions — uploads and outputs).
  const turnOfMessage = new Map(messages.map((m, i) => [m.id, i]));
  const attachments = await db
    .select({
      id: jkaiAttachments.id,
      messageId: jkaiAttachments.messageId,
      kind: jkaiAttachments.kind,
      originalName: jkaiAttachments.originalName,
      source: jkaiAttachments.source,
      createdAt: jkaiAttachments.createdAt,
    })
    .from(jkaiAttachments)
    .where(eq(jkaiAttachments.conversationId, conversationId));
  for (const a of attachments) {
    const turn = a.messageId ? (turnOfMessage.get(a.messageId) ?? 0) : 0;
    const isImage = a.kind === 'image';
    add(
      {
        id: `att:${a.id}`,
        kind: a.source === 'generated' ? 'artefact' : isImage ? 'image' : 'doc',
        type: a.source === 'generated' ? 'ARTEFACT' : isImage ? 'IMAGE' : a.kind.toUpperCase(),
        name: a.originalName || `${a.kind} attachment`,
        note:
          a.source === 'generated'
            ? 'Produced by this thread.'
            : 'Attached to this thread.',
        href: null,
        lastSeen: a.createdAt instanceof Date ? a.createdAt.toISOString() : null,
      },
      turn,
    );
  }

  // ── Concept nodes ─────────────────────────────────────────────────────────
  const [derivedNote] = await db
    .select({ id: intelNotes.id })
    .from(intelNotes)
    .where(
      and(
        sql`${intelNotes.metadata}->>'autoKind' = 'chat'`,
        sql`${intelNotes.metadata}->>'refId' = ${conversationId}`,
      ),
    )
    .limit(1);

  const conceptIds: string[] = [];
  if (derivedNote) {
    const rows = await db
      .select({
        id: intelEntities.id,
        name: intelEntities.name,
        summary: intelEntities.summary,
        typeName: intelEntityTypes.name,
        updatedAt: intelEntities.updatedAt,
      })
      .from(intelNoteEntities)
      .innerJoin(intelEntities, eq(intelEntities.id, intelNoteEntities.entityId))
      .innerJoin(intelEntityTypes, eq(intelEntityTypes.id, intelEntities.typeId))
      .where(eq(intelNoteEntities.noteId, derivedNote.id));

    for (const e of rows) {
      conceptIds.push(e.id);
      // Concepts belong to the thread as a whole — the extractor works over the
      // full transcript, not per turn — so they attach to the last turn, which
      // is what "what is this conversation about" means in practice.
      add(
        {
          id: `entity:${e.id}`,
          kind: 'concept',
          type: (e.typeName || 'concept').toUpperCase(),
          name: e.name,
          note: e.summary,
          href: `/jkai/intel/entities/${e.id}`,
          lastSeen: e.updatedAt instanceof Date ? e.updatedAt.toISOString() : null,
        },
        Math.max(0, messages.length - 1),
      );
    }
  }

  // ── Edges ─────────────────────────────────────────────────────────────────
  const edges: ThreadGraphEdge[] = [];
  const seenEdge = new Set<string>();
  const addEdge = (source: string, target: string, verb: string, typed: boolean) => {
    if (source === target) return;
    const key = [source, target].sort().join('|') + `|${verb}`;
    if (seenEdge.has(key)) return;
    seenEdge.add(key);
    edges.push({ source, target, verb, typed });
  };

  // Real, typed relationships between the thread's concepts.
  if (conceptIds.length > 1) {
    const rels = await db
      .select({
        sourceEntityId: intelRelationships.sourceEntityId,
        targetEntityId: intelRelationships.targetEntityId,
        type: intelRelationships.type,
        label: intelRelationships.label,
      })
      .from(intelRelationships)
      .where(
        and(
          inArray(intelRelationships.sourceEntityId, conceptIds),
          inArray(intelRelationships.targetEntityId, conceptIds),
        ),
      );
    for (const r of rels) {
      addEdge(
        `entity:${r.sourceEntityId}`,
        `entity:${r.targetEntityId}`,
        (r.label || r.type || 'related').toUpperCase(),
        true,
      );
    }
  }

  // Co-occurrence: things that showed up in the same turn are connected.
  const nodes = [...byId.values()];
  const byTurn = new Map<number, ThreadGraphNode[]>();
  for (const n of nodes) {
    for (const t of n.turns) {
      const arr = byTurn.get(t) ?? [];
      arr.push(n);
      byTurn.set(t, arr);
    }
  }
  for (const group of byTurn.values()) {
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        addEdge(group[i].id, group[j].id, CO_OCCURRENCE_VERB, false);
      }
    }
  }

  return {
    ...rankAndTrim(nodes, edges),
    conceptsReady: !!derivedNote,
  };
}

/** Keep the most connected MAX_NODES and drop edges that lose an endpoint.
 *  Concepts outrank structure at equal degree — the rail's job is to say what
 *  the thread is *about*, and a list of every attachment doesn't. */
function rankAndTrim(
  nodes: ThreadGraphNode[],
  edges: ThreadGraphEdge[],
): { nodes: ThreadGraphNode[]; edges: ThreadGraphEdge[] } {
  if (nodes.length <= MAX_NODES) return { nodes, edges };

  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  const rank = (n: ThreadGraphNode) => (degree.get(n.id) ?? 0) * 2 + (n.kind === 'concept' ? 1 : 0);
  const kept = [...nodes].sort((a, b) => rank(b) - rank(a)).slice(0, MAX_NODES);
  const keptIds = new Set(kept.map((n) => n.id));
  return {
    nodes: kept,
    edges: edges.filter((e) => keptIds.has(e.source) && keptIds.has(e.target)),
  };
}

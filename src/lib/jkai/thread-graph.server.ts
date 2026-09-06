// The knowledge graph beside a /jkai thread — the half that reads the database.
//
// Split out of `thread-graph.ts` so the rail and modal, which are client
// components, can import the types and the maths without dragging `$lib/db`,
// drizzle, `pg` and `$env/dynamic/private` into the browser bundle. See the
// header of the pure module for why the `.server` suffix rather than a
// convention.

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
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import { shortModelLabel } from '$lib/jkai/model-label';
import { readTurnStamp } from '$lib/jkai/turn-stamp';
import {
  CO_OCCURRENCE_VERB,
  conceptAnchorTurn,
  countMentions,
  emptyThreadGraph,
  pushTurn,
  rankAndTrim,
  type NodeProvenance,
  type ThreadGraph,
  type ThreadGraphEdge,
  type ThreadGraphNode,
} from './thread-graph';

export async function buildThreadGraph(
  conversationId: string,
  /** `full` returns every concept ranked rather than the twelve the rail draws. */
  opts: { full?: boolean } = {},
): Promise<ThreadGraph> {
  const [conv] = await db
    .select({
      modelId: conversations.modelId,
      updatedAt: conversations.updatedAt,
      intelEnabled: conversations.intelEnabled,
    })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  if (!conv) return emptyThreadGraph();
  const intelEnabled = conv.intelEnabled !== false;

  const messages = await db
    .select({
      id: orchestratorChats.id,
      role: orchestratorChats.role,
      // Read for mention counting only — see countMentions.
      content: orchestratorChats.content,
      metadata: orchestratorChats.metadata,
      createdAt: orchestratorChats.createdAt,
    })
    .from(orchestratorChats)
    .where(eq(orchestratorChats.conversationId, conversationId))
    .orderBy(asc(orchestratorChats.createdAt));

  const byId = new Map<string, ThreadGraphNode>();
  // Provenance defaults to 'thread': everything the structural pass adds is
  // something this conversation demonstrably touched, not a knowledge claim.
  // Only the concept pass below decides between 'known' and 'new'.
  const add = (
    node: Omit<ThreadGraphNode, 'turns' | 'provenance' | 'mentions'> & {
      turns?: number[];
      provenance?: NodeProvenance;
    },
    turn: number,
  ): ThreadGraphNode => {
    const existing = byId.get(node.id);
    if (existing) {
      pushTurn(existing, turn);
      if (node.lastSeen) existing.lastSeen = node.lastSeen;
      return existing;
    }
    // `mentions` is filled in once every node exists — see countMentions.
    const created: ThreadGraphNode = { provenance: 'thread', ...node, turns: [turn], mentions: 0 };
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
  let conceptTotal = 0;
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

    // Which of these the knowledge base already knew. One grouped count over the
    // note links, excluding THIS thread's derived note — an entity with any other
    // source pre-dates the conversation. See NodeProvenance for why the embedding
    // column can't answer this.
    const priorlyKnown = new Set<string>();
    if (rows.length > 0) {
      const priorRows = await db
        .select({ entityId: intelNoteEntities.entityId })
        .from(intelNoteEntities)
        .where(
          and(
            inArray(
              intelNoteEntities.entityId,
              rows.map((e) => e.id),
            ),
            ne(intelNoteEntities.noteId, derivedNote.id),
          ),
        )
        .groupBy(intelNoteEntities.entityId);
      for (const r of priorRows) priorlyKnown.add(r.entityId);
    }

    // Every turn that already carries a structural node. Computed once, before
    // the concept pass adds to the same map — see conceptAnchorTurn.
    const conceptTurn = conceptAnchorTurn(
      [...new Set([...byId.values()].flatMap((n) => n.turns))],
      messages.length,
    );

    conceptTotal = rows.length;
    for (const e of rows) {
      conceptIds.push(e.id);
      // Concepts belong to the thread as a whole — the extractor works over the
      // full transcript, not per turn — so they all share one anchor turn, which
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
          provenance: priorlyKnown.has(e.id) ? 'known' : 'new',
        },
        conceptTurn,
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

  countMentions(
    nodes,
    messages.map((m) => m.content ?? ''),
  );

  return {
    ...rankAndTrim(nodes, edges, opts.full ? Number.POSITIVE_INFINITY : undefined),
    conceptsReady: !!derivedNote,
    intelEnabled,
    conceptTotal,
  };
}

/** Regex-safe form of a name that may contain brackets, dots or dashes. */

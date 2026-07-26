// One case file: its own fields, and the working set pinned to it.
//
//   GET     the dossier with every pinned item HYDRATED
//   PATCH   edit title / summary / status / open questions
//   POST    item operations — add, remove, update, reorder
//   DELETE  bin the case file (items cascade)
//
// Items are hydrated server-side rather than shipped as bare ids: a pin only
// earns its place on the page if it shows what it is — an entity with its type
// and connection count, a note with its date, an insight with its score. A list
// of uuids is a list nobody reads.
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import {
  intelDossierItems,
  intelDossiers,
  intelEntities,
  intelEntityTypes,
  intelInsights,
  intelNotes,
  intelTimelineEvents,
} from '$lib/db/schema';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';

const DOSSIER_STATUSES = ['open', 'parked', 'closed'] as const;
const ITEM_KINDS = ['entity', 'note', 'insight', 'commission', 'timeline', 'text'] as const;

const MAX_TITLE = 200;
const MAX_SUMMARY = 4000;
const MAX_BODY = 8000;
const MAX_QUESTIONS = 40;
const MAX_QUESTION_LENGTH = 400;
const MAX_ITEMS = 400;

interface HydratedItem {
  id: string;
  kind: string;
  refId: string | null;
  body: string | null;
  position: number;
  pinnedAt: Date;
  /** Human-readable head of the pinned thing. Null when the target is gone. */
  label: string | null;
  detail: string | null;
  href: string | null;
  icon: string | null;
  /** Kind-specific extras the card shows — type name, connection count, score. */
  meta: Record<string, unknown>;
}

/**
 * Resolve every pin in one pass per kind.
 *
 * A dangling pin (the entity was merged away, the note deleted) keeps its row
 * and comes back with `label: null` rather than vanishing — an item silently
 * disappearing from a case file is worse than one marked missing.
 */
async function hydrateItems(dossierId: string): Promise<HydratedItem[]> {
  const rows = await db
    .select()
    .from(intelDossierItems)
    .where(eq(intelDossierItems.dossierId, dossierId))
    .orderBy(asc(intelDossierItems.position), asc(intelDossierItems.pinnedAt))
    .limit(MAX_ITEMS);

  const idsOf = (kind: string) =>
    [...new Set(rows.filter((r) => r.kind === kind && r.refId).map((r) => r.refId as string))];

  const entityIds = idsOf('entity');
  const noteIds = idsOf('note');
  const insightIds = idsOf('insight');
  const timelineIds = idsOf('timeline');

  const [entities, notes, insights, events] = await Promise.all([
    entityIds.length
      ? db
          .select({
            id: intelEntities.id,
            name: intelEntities.name,
            summary: intelEntities.summary,
            confirmed: intelEntities.confirmed,
            watched: intelEntities.watched,
            typeName: intelEntityTypes.name,
            typeIcon: intelEntityTypes.icon,
            typeColor: intelEntityTypes.color,
            connectionCount: sql<number>`(
              select count(*) from intel_relationships
              where intel_relationships.source_entity_id = intel_entities.id
                 or intel_relationships.target_entity_id = intel_entities.id
            )::int`.as('connection_count'),
          })
          .from(intelEntities)
          .innerJoin(intelEntityTypes, eq(intelEntities.typeId, intelEntityTypes.id))
          .where(inArray(intelEntities.id, entityIds))
      : [],
    noteIds.length
      ? db
          .select({
            id: intelNotes.id,
            title: intelNotes.title,
            source: intelNotes.source,
            createdAt: intelNotes.createdAt,
            snippet: sql<string | null>`substring(coalesce(${intelNotes.processedContent}, ${intelNotes.rawContent}) from 1 for 220)`.as(
              'snippet',
            ),
          })
          .from(intelNotes)
          .where(inArray(intelNotes.id, noteIds))
      : [],
    insightIds.length
      ? db
          .select({
            id: intelInsights.id,
            title: intelInsights.title,
            explanation: intelInsights.explanation,
            kind: intelInsights.kind,
            score: intelInsights.score,
            status: intelInsights.status,
          })
          .from(intelInsights)
          .where(inArray(intelInsights.id, insightIds))
      : [],
    timelineIds.length
      ? db
          .select({
            id: intelTimelineEvents.id,
            title: intelTimelineEvents.title,
            description: intelTimelineEvents.description,
            date: intelTimelineEvents.date,
          })
          .from(intelTimelineEvents)
          .where(inArray(intelTimelineEvents.id, timelineIds))
      : [],
  ]);

  const entityById = new Map(entities.map((e) => [e.id, e]));
  const noteById = new Map(notes.map((n) => [n.id, n]));
  const insightById = new Map(insights.map((i) => [i.id, i]));
  const eventById = new Map(events.map((e) => [e.id, e]));

  return rows.map((row) => {
    const base: HydratedItem = {
      id: row.id,
      kind: row.kind,
      refId: row.refId,
      body: row.body,
      position: row.position,
      pinnedAt: row.pinnedAt,
      label: null,
      detail: null,
      href: null,
      icon: null,
      meta: {},
    };

    if (row.kind === 'text') {
      return { ...base, label: 'Analyst note', detail: row.body, icon: '✎' };
    }

    if (row.kind === 'entity') {
      const e = row.refId ? entityById.get(row.refId) : undefined;
      if (!e) return base;
      return {
        ...base,
        label: e.name,
        detail: e.summary,
        href: `/jkai/intel/entities/${e.id}`,
        icon: e.typeIcon,
        meta: {
          typeName: e.typeName,
          typeColor: e.typeColor,
          connectionCount: Number(e.connectionCount ?? 0),
          confirmed: e.confirmed,
          watched: e.watched,
        },
      };
    }

    if (row.kind === 'note') {
      const n = row.refId ? noteById.get(row.refId) : undefined;
      if (!n) return base;
      return {
        ...base,
        label: n.title ?? 'Untitled note',
        detail: n.snippet,
        href: `/jkai/intel/notes/${n.id}`,
        icon: '📄',
        meta: { source: n.source, createdAt: n.createdAt },
      };
    }

    if (row.kind === 'insight') {
      const i = row.refId ? insightById.get(row.refId) : undefined;
      if (!i) return base;
      return {
        ...base,
        label: i.title,
        detail: i.explanation,
        href: '/jkai/intel',
        icon: '◈',
        meta: { insightKind: i.kind, score: i.score, status: i.status },
      };
    }

    if (row.kind === 'timeline') {
      const e = row.refId ? eventById.get(row.refId) : undefined;
      if (!e) return base;
      return {
        ...base,
        label: e.title,
        detail: e.description,
        href: '/jkai/intel/timeline',
        icon: '◷',
        meta: { date: e.date },
      };
    }

    return base;
  });
}

async function loadDossier(id: string) {
  const [row] = await db.select().from(intelDossiers).where(eq(intelDossiers.id, id)).limit(1);
  if (!row) throw error(404, 'dossier not found');
  return row;
}

/** Any item change is activity on the case file, and the index sorts on that. */
async function touch(id: string): Promise<void> {
  await db.update(intelDossiers).set({ updatedAt: new Date() }).where(eq(intelDossiers.id, id));
}

function readQuestions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((q) => String(q ?? '').trim().slice(0, MAX_QUESTION_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_QUESTIONS);
}

export const GET: RequestHandler = async ({ params }) => {
  const dossier = await loadDossier(params.id);
  return json({ dossier, items: await hydrateItems(dossier.id) });
};

export const PATCH: RequestHandler = async ({ params, request }) => {
  const dossier = await loadDossier(params.id);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const patch: Record<string, unknown> = { updatedAt: new Date() };

  if (body.title !== undefined) {
    const title = String(body.title).trim().slice(0, MAX_TITLE);
    if (!title) throw error(400, 'title cannot be empty');
    patch.title = title;
  }
  if (body.summary !== undefined) {
    patch.summary = body.summary === null ? null : String(body.summary).slice(0, MAX_SUMMARY);
  }
  if (body.standingInstructions !== undefined) {
    patch.standingInstructions =
      body.standingInstructions === null ? null : String(body.standingInstructions).slice(0, MAX_SUMMARY);
  }
  if (body.lensId !== undefined) patch.lensId = body.lensId === null ? null : String(body.lensId);
  if (body.openQuestions !== undefined) patch.openQuestions = readQuestions(body.openQuestions);
  if (body.status !== undefined) {
    const status = String(body.status).trim().toLowerCase();
    if (!(DOSSIER_STATUSES as readonly string[]).includes(status)) {
      throw error(400, `status must be one of ${DOSSIER_STATUSES.join(', ')}`);
    }
    patch.status = status;
  }

  const [row] = await db
    .update(intelDossiers)
    .set(patch)
    .where(eq(intelDossiers.id, dossier.id))
    .returning();

  return json({ dossier: row });
};

export const POST: RequestHandler = async ({ params, request }) => {
  const dossier = await loadDossier(params.id);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? '').trim();

  if (action === 'add') {
    const kind = String(body.kind ?? '').trim();
    if (!(ITEM_KINDS as readonly string[]).includes(kind)) {
      throw error(400, `kind must be one of ${ITEM_KINDS.join(', ')}`);
    }

    const refId = body.refId ? String(body.refId).trim() : null;
    const text = body.body == null ? null : String(body.body).slice(0, MAX_BODY);

    if (kind === 'text') {
      if (!text?.trim()) throw error(400, 'a text item needs a body');
    } else if (!refId) {
      throw error(400, `a ${kind} item needs a refId`);
    }

    // Pinning the same entity twice is a mis-click, not an instruction.
    if (refId) {
      const [existing] = await db
        .select({ id: intelDossierItems.id })
        .from(intelDossierItems)
        .where(
          and(
            eq(intelDossierItems.dossierId, dossier.id),
            eq(intelDossierItems.kind, kind),
            eq(intelDossierItems.refId, refId),
          ),
        )
        .limit(1);
      if (existing) return json({ ok: true, duplicate: true, items: await hydrateItems(dossier.id) });
    }

    const [{ next } = { next: 0 }] = await db
      .select({ next: sql<number>`coalesce(max(${intelDossierItems.position}), -1)::int + 1` })
      .from(intelDossierItems)
      .where(eq(intelDossierItems.dossierId, dossier.id));

    await db.insert(intelDossierItems).values({
      dossierId: dossier.id,
      kind,
      refId,
      body: text,
      position: Number(next ?? 0),
    });
    await touch(dossier.id);
    return json({ ok: true, items: await hydrateItems(dossier.id) }, { status: 201 });
  }

  if (action === 'remove') {
    const itemId = String(body.itemId ?? '').trim();
    if (!itemId) throw error(400, 'itemId is required');
    await db
      .delete(intelDossierItems)
      .where(and(eq(intelDossierItems.id, itemId), eq(intelDossierItems.dossierId, dossier.id)));
    await touch(dossier.id);
    return json({ ok: true, items: await hydrateItems(dossier.id) });
  }

  if (action === 'update') {
    const itemId = String(body.itemId ?? '').trim();
    if (!itemId) throw error(400, 'itemId is required');
    const text = String(body.body ?? '').slice(0, MAX_BODY);
    if (!text.trim()) throw error(400, 'body cannot be empty');

    const updated = await db
      .update(intelDossierItems)
      .set({ body: text })
      .where(
        and(
          eq(intelDossierItems.id, itemId),
          eq(intelDossierItems.dossierId, dossier.id),
          // Only the analyst's own text is editable — the others are pins at
          // rows that own their own content.
          eq(intelDossierItems.kind, 'text'),
        ),
      )
      .returning({ id: intelDossierItems.id });
    if (!updated.length) throw error(404, 'no editable item with that id');

    await touch(dossier.id);
    return json({ ok: true, items: await hydrateItems(dossier.id) });
  }

  if (action === 'reorder') {
    const itemIds = (Array.isArray(body.itemIds) ? body.itemIds : []).map(String).filter(Boolean);
    if (!itemIds.length) throw error(400, 'itemIds is required');

    // Positions are rewritten from the client's full ordering rather than
    // swapped pairwise, so a reorder can never leave two items on one index.
    await Promise.all(
      itemIds.map((itemId, index) =>
        db
          .update(intelDossierItems)
          .set({ position: index })
          .where(and(eq(intelDossierItems.id, itemId), eq(intelDossierItems.dossierId, dossier.id))),
      ),
    );
    await touch(dossier.id);
    return json({ ok: true, items: await hydrateItems(dossier.id) });
  }

  throw error(400, 'action must be one of add, remove, update, reorder');
};

export const DELETE: RequestHandler = async ({ params }) => {
  const dossier = await loadDossier(params.id);
  await db.delete(intelDossiers).where(eq(intelDossiers.id, dossier.id));
  return json({ ok: true });
};

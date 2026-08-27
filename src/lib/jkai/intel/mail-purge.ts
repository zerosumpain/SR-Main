// Taking the mailbox back out of the graph, without taking it out of the system.
//
// The graph had been fed the whole mailbox for weeks and had become a
// description of it. Before this ran, on production: 2,781 of 3,116 intel notes
// were email; 8,974 of 13,469 live entities were asserted by an email note and
// nothing else; 11,458 of 16,727 relationships were sourced from one. The single
// most common relationship type in a knowledge graph about a person's working
// life was `offers`, at 1,368 edges — ahead of `collaborates_with`, `works_on`
// and `stakeholder_in` combined. Entities included "5% savings ending", "Summer
// body", "Christmas bauble" and "Order #204-3656435-0740303".
//
// ── What this deletes, and what it very deliberately does not ───────────────
//
// It deletes the GRAPH ROWS read out of email notes. It does not delete the
// NOTES. That distinction is the whole design, and it is not tidiness:
// daydreaming reads `intel_notes WHERE source = 'email'` directly in three
// places — voucher extraction (daydream/offers.ts), receipt extraction
// (daydream/spend/read.ts) and interest terms (daydream/snapshot.ts). Deleting
// the notes would silently kill the savings prompts, the spend series and a
// third of the interest signal, and none of those failures would look like this
// module's fault a fortnight later. The notes stay, drop to `graph_state =
// 'pending'`, and become the admission queue.
//
// ── What survives, and why ──────────────────────────────────────────────────
//
// Two things the owner authored are never touched, because a purge of MACHINE
// extraction that also destroyed hand-made decisions would be a worse graph,
// not a cleaner one:
//
//   - relationships with `manual = true` — an edge drawn by hand
//   - entities with `confirmed = true` — a node judged real in triage
//
// A confirmed entity keeps its node and loses its email evidence links, which
// is the honest outcome: you vouched for the thing, not for the marketing email
// that happened to mention it.
//
// Everything is counted before it is deleted and the whole thing runs in ONE
// transaction, so `dryRun` returns exactly the numbers the real run will
// produce and a failure half way leaves the graph as it was.
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import {
  mailEmbeddings,
  intelAlerts,
  intelDossierItems,
  intelEntities,
  intelInsights,
  intelNoteEntities,
  intelNotes,
  intelRelationships,
  intelTimelineEvents,
} from '$lib/db/schema';

export interface MailPurgeResult {
  /** True when nothing was written — the counts are a forecast. */
  dryRun: boolean;
  /** Email notes in scope. These are KEPT; only their graph rows go. */
  notesRetained: number;
  /** Notes moved to `pending` so they appear in the admission queue. */
  notesHeld: number;
  relationshipsRemoved: number;
  /** Edges left alone because the owner drew them by hand. */
  relationshipsKeptManual: number;
  entitiesRemoved: number;
  /** Entities left alone because the owner confirmed them in triage. */
  entitiesKeptConfirmed: number;
  /** Entities that keep their node because a non-email note also asserts them. */
  entitiesKeptOtherEvidence: number;
  noteEntityLinksRemoved: number;
  timelineEventsRemoved: number;
  alertsRemoved: number;
  dossierItemsRemoved: number;
  insightsRemoved: number;
  mailChunksRemoved: number;
}

const EMPTY: Omit<MailPurgeResult, 'dryRun'> = {
  notesRetained: 0,
  notesHeld: 0,
  relationshipsRemoved: 0,
  relationshipsKeptManual: 0,
  entitiesRemoved: 0,
  entitiesKeptConfirmed: 0,
  entitiesKeptOtherEvidence: 0,
  noteEntityLinksRemoved: 0,
  timelineEventsRemoved: 0,
  alertsRemoved: 0,
  dossierItemsRemoved: 0,
  insightsRemoved: 0,
  mailChunksRemoved: 0,
};

export interface MailPurgeOptions {
  /** Count everything and write nothing. */
  dryRun?: boolean;
  /**
   * Limit the purge to these note ids. Used by the per-thread "take this back
   * out of the graph" action; omitted for the full reset.
   */
  noteIds?: string[];
}

/**
 * Remove everything the graph learned from email, keeping the mail itself.
 *
 * Set-based rather than a loop over `deleteNoteCascade`: that function is
 * correct but it deletes the note, and at 2,781 notes it is 2,781 transactions.
 * The steps below are the same steps in the same order, expressed once.
 */
export async function purgeMailFromGraph(opts: MailPurgeOptions = {}): Promise<MailPurgeResult> {
  const dryRun = !!opts.dryRun;

  return await db.transaction(async (tx) => {
    const result: MailPurgeResult = { dryRun, ...EMPTY };

    // ── A. Scope ────────────────────────────────────────────────────────────
    const scope = opts.noteIds?.length
      ? and(eq(intelNotes.source, 'email'), inArray(intelNotes.id, opts.noteIds))
      : eq(intelNotes.source, 'email');

    const notes = await tx.select({ id: intelNotes.id }).from(intelNotes).where(scope);
    const noteIds = notes.map((n) => n.id);
    result.notesRetained = noteIds.length;
    if (noteIds.length === 0) return result;

    // ── B. Which entities are at risk ───────────────────────────────────────
    //
    // Computed BEFORE any link is removed. An entity is a candidate only if an
    // email note in scope asserts it; the 482 entities that already had no note
    // links at all are somebody's hand-made nodes and are none of this
    // module's business.
    const linkedHere = await tx
      .select({ entityId: intelNoteEntities.entityId })
      .from(intelNoteEntities)
      .where(inArray(intelNoteEntities.noteId, noteIds));
    const candidateIds = [...new Set(linkedHere.map((r) => r.entityId))];

    let doomedIds: string[] = [];
    if (candidateIds.length > 0) {
      // Kept because something else also asserts them. Counted separately from
      // "kept because confirmed" because they are different reassurances: one
      // says other evidence exists, the other says you personally vouched.
      const elsewhere = await tx
        .select({ entityId: intelNoteEntities.entityId })
        .from(intelNoteEntities)
        .where(
          and(
            inArray(intelNoteEntities.entityId, candidateIds),
            notInArray(intelNoteEntities.noteId, noteIds),
          ),
        );
      const survivors = new Set(elsewhere.map((r) => r.entityId));
      result.entitiesKeptOtherEvidence = survivors.size;

      const orphanIds = candidateIds.filter((id) => !survivors.has(id));

      // Confirmed entities are the owner's judgement and outrank the purge.
      const confirmed = orphanIds.length
        ? await tx
            .select({ id: intelEntities.id })
            .from(intelEntities)
            .where(and(inArray(intelEntities.id, orphanIds), eq(intelEntities.confirmed, true)))
        : [];
      const confirmedSet = new Set(confirmed.map((r) => r.id));
      result.entitiesKeptConfirmed = confirmedSet.size;

      doomedIds = orphanIds.filter((id) => !confirmedSet.has(id));

      // Merge tombstones. A row whose `merged_into_id` points at something
      // about to be deleted is an alias of a node that will stop existing, and
      // every graph query filters `merged_into_id IS NULL` — so leaving it
      // behind hides it forever rather than restoring it. Walked to a fixpoint
      // because a survivor can itself have been merged into.
      const doomed = new Set(doomedIds);
      for (let depth = 0; depth < 8; depth += 1) {
        const frontier = [...doomed];
        if (frontier.length === 0) break;
        const aliases = await tx
          .select({ id: intelEntities.id })
          .from(intelEntities)
          .where(inArray(intelEntities.mergedIntoId, frontier));
        const added = aliases.map((a) => a.id).filter((id) => !doomed.has(id));
        if (added.length === 0) break;
        for (const id of added) doomed.add(id);
      }
      doomedIds = [...doomed];
    }
    result.entitiesRemoved = doomedIds.length;

    // ── C. Relationships sourced from these notes ───────────────────────────
    //
    // Counted and deleted BEFORE the note rows are touched: the FK on
    // `source_note_id` is `set null`, so anything that nulls it first destroys
    // the only link saying which edges came from where.
    const [{ total, manual }] = await tx
      .select({
        total: sql<number>`count(*)::int`,
        manual: sql<number>`count(*) filter (where ${intelRelationships.manual})::int`,
      })
      .from(intelRelationships)
      .where(inArray(intelRelationships.sourceNoteId, noteIds));
    result.relationshipsKeptManual = Number(manual) || 0;
    result.relationshipsRemoved = (Number(total) || 0) - result.relationshipsKeptManual;

    // ── D. Everything else, counted ─────────────────────────────────────────
    const n = sql<number>`count(*)::int`;
    const [tl] = await tx.select({ n }).from(intelTimelineEvents).where(inArray(intelTimelineEvents.noteId, noteIds));
    const [al] = await tx.select({ n }).from(intelAlerts).where(inArray(intelAlerts.noteId, noteIds));
    const [ne] = await tx.select({ n }).from(intelNoteEntities).where(inArray(intelNoteEntities.noteId, noteIds));
    result.timelineEventsRemoved = Number(tl?.n) || 0;
    result.alertsRemoved = Number(al?.n) || 0;
    result.noteEntityLinksRemoved = Number(ne?.n) || 0;

    // Insights hold entity ids in a jsonb array with no foreign key, so one
    // about a deleted entity would render a card explaining nothing. Read then
    // delete by id rather than a jsonb containment query — there are hundreds of
    // rows, not millions, and a `?|` with an array parameter spliced through the
    // query builder is exactly the shape that silently matches nothing.
    let staleInsightIds: string[] = [];
    if (doomedIds.length > 0) {
      const doomedSet = new Set(doomedIds);
      const candidates = await tx
        .select({ id: intelInsights.id, entityIds: intelInsights.entityIds })
        .from(intelInsights);
      staleInsightIds = candidates
        .filter((row) => (row.entityIds ?? []).some((id) => doomedSet.has(id)))
        .map((row) => row.id);
      result.insightsRemoved = staleInsightIds.length;

      const [dossierRow] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(intelDossierItems)
        .where(and(eq(intelDossierItems.kind, 'entity'), inArray(intelDossierItems.refId, doomedIds)));
      result.dossierItemsRemoved = Number(dossierRow?.n) || 0;
    }

    // The RAG chunks of an admitted email. They come back on re-admission.
    const [chunkRow] = await tx
      .select({ n })
      .from(mailEmbeddings)
      .where(inArray(mailEmbeddings.noteId, noteIds));
    result.mailChunksRemoved = Number(chunkRow?.n) || 0;

    const [heldRow] = await tx
      .select({ n })
      .from(intelNotes)
      .where(and(scope, sql`${intelNotes.graphState} <> 'pending'`));
    result.notesHeld = Number(heldRow?.n) || 0;

    // Everything above is SELECT only, so returning here writes nothing and the
    // transaction closes clean. The counts are the whole product of a dry run,
    // and they are exactly the numbers the real run below will produce because
    // they were measured against the same snapshot inside the same transaction.
    if (dryRun) return result;

    // ── E. Delete, in dependency order ──────────────────────────────────────
    await tx
      .delete(intelRelationships)
      .where(and(inArray(intelRelationships.sourceNoteId, noteIds), eq(intelRelationships.manual, false)));

    // A manual edge keeps its node but loses its provenance — the note it cites
    // is no longer in the graph, and pointing at it would be a dead citation.
    await tx
      .update(intelRelationships)
      .set({ sourceNoteId: null })
      .where(and(inArray(intelRelationships.sourceNoteId, noteIds), eq(intelRelationships.manual, true)));

    await tx.delete(intelTimelineEvents).where(inArray(intelTimelineEvents.noteId, noteIds));
    await tx.delete(intelAlerts).where(inArray(intelAlerts.noteId, noteIds));
    await tx.delete(intelNoteEntities).where(inArray(intelNoteEntities.noteId, noteIds));

    if (staleInsightIds.length > 0) {
      await tx.delete(intelInsights).where(inArray(intelInsights.id, staleInsightIds));
    }

    if (doomedIds.length > 0) {
      await tx
        .delete(intelTimelineEvents)
        .where(inArray(intelTimelineEvents.entityId, doomedIds));
      await tx
        .delete(intelDossierItems)
        .where(and(eq(intelDossierItems.kind, 'entity'), inArray(intelDossierItems.refId, doomedIds)));
      // Cascades on source_entity_id / target_entity_id clear any surviving
      // edges these were an endpoint of.
      await tx.delete(intelEntities).where(inArray(intelEntities.id, doomedIds));
    }

    // `mail_embeddings` cascades from the note, and the note is staying — so the
    // chunks have to go explicitly. An unadmitted thread must not remain
    // searchable at passage level.
    await tx.delete(mailEmbeddings).where(inArray(mailEmbeddings.noteId, noteIds));

    // ── F. The notes survive, held ──────────────────────────────────────────
    //
    // `firstSeenIn` on a surviving entity may point at a note whose graph rows
    // just went. That is fine and deliberate: the note still exists, so the
    // citation still resolves — it simply no longer contributes.
    await tx
      .update(intelNotes)
      .set({ graphState: 'pending', status: 'held', updatedAt: new Date() })
      .where(and(scope, sql`${intelNotes.graphState} <> 'pending'`));

    return result;
  });
}

/**
 * Purge and then invalidate the analytics snapshot.
 *
 * Every downstream reader — the graph page, the clusters, the insight engine —
 * works off a cached analysis, so without this the UI keeps drawing several
 * thousand deleted entities for up to a minute after the biggest delete this
 * graph has ever had. Separate from the transaction because a cache is not
 * something to invalidate before the write it describes has committed.
 */
export async function purgeMailAndRefresh(opts: MailPurgeOptions = {}): Promise<MailPurgeResult> {
  const result = await purgeMailFromGraph(opts);
  if (!result.dryRun) {
    const { invalidateGraphAnalysis } = await import('./analytics/load');
    invalidateGraphAnalysis();
    console.log(
      `[intel:mail-purge] removed ${result.entitiesRemoved} entities, ${result.relationshipsRemoved} edges, ` +
        `${result.timelineEventsRemoved} events, ${result.insightsRemoved} insights from ${result.notesRetained} email notes; ` +
        `kept ${result.entitiesKeptConfirmed} confirmed entities and ${result.relationshipsKeptManual} manual edges; ` +
        `${result.notesHeld} notes now awaiting admission`,
    );
  }
  return result;
}

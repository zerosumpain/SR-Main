// Intel auto-extraction — grows the entity graph from knowledge that arrives
// through other doors.
//
// Until now only hand-written intel notes ran entity extraction; a /drive
// upload or a finished deep dive became vectors and nothing else, so the graph
// only ever knew what you typed into it. This module runs the SAME pipeline
// (extract → persist → embed) over those sources by minting a derived intel
// note per source item.
//
// Deliberately quieter than the note path:
//   - no recall/alert pass and no WhatsApp push (an upload is not an event)
//
// `chat` is the third source: a /jkai thread, re-extracted as it grows, so the
// knowledge-graph rail beside the conversation can show the concepts and
// failure modes the thread is actually about — and so those land in the same
// graph everything else feeds.
//   - content-hash deduped, so re-indexing an unchanged file costs nothing
//   - text is capped, so one huge PDF can't turn into one huge LLM bill
//   - every failure is swallowed and logged; ingest must never fail because
//     the graph was busy or the model was down
//
// Derived notes are tagged `metadata.autoKind`, which unified recall uses to
// suppress them (the file/research branches already return that text — the
// entities are the new part). Kill switch: INTEL_AUTO_EXTRACT=0.
import { db } from '$lib/db';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { intelNotes, researchSessions } from '$lib/db/schema';
import { extractFromNote } from './extract';
import { persistExtraction } from './graph';
import { embedNote } from './embed';

/**
 * `daydream` is the fourth: a thought the owner explicitly called useful, woven
 * back into the graph by $lib/daydream/weave. The graph already feeds daydream
 * (intel-bridge turns an insight into a candidate); this closes the loop in the
 * other direction, and only ever on something the owner has endorsed.
 */
/**
 * `note` is the fifth: a page from John's notebook. Unlike the other four it is
 * something he WROTE rather than something that arrived, which makes it the
 * highest-signal text the graph gets — it names the people, places and
 * organisations he is actually thinking about.
 */
export type AutoKind = 'file' | 'research' | 'chat' | 'daydream' | 'note';

export interface AutoExtractInput {
  kind: AutoKind;
  /** Stable id of the upstream row (file id / research session id). */
  refId: string;
  title: string;
  text: string;
  /** Changes when the upstream content changes; skips re-extraction when equal. */
  contentHash: string;
  /** Extra provenance stored on the derived note. */
  metadata?: Record<string, unknown>;
  /**
   * `intel_notes.source`, when it differs from `kind`.
   *
   * `AutoKind` is about which PIPELINE ingested something; `source` is about
   * where it came from, and the graph's source filter reads the latter. Gmail
   * threads ride the `file` pipeline but are email, and without this override
   * twelve weeks of correspondence would be indistinguishable from Drive
   * uploads in the source selector. Defaults to `kind`.
   */
  source?: string;
  /**
   * Resolved ER category slugs for this source (see ./source-policy). Stored on
   * the note so the graph can filter by category without walking Drive paths
   * inside the cached analytics snapshot.
   */
  categories?: string[];
  /**
   * When the thing being extracted actually happened, if known.
   *
   * Stored on the note as `observed_at`. Without it the only clock a note has is
   * `created_at`, which is when the sweep ran — so twelve weeks of mail all date
   * from the night it was read. The Gmail path already computes this for the
   * edges it writes; it just never reached the note.
   */
  observedAt?: Date;
  /**
   * Re-extract even when the content hash matches.
   *
   * The hash gate assumes the only reason to redo an item is that its text
   * changed. That is wrong whenever the EXTRACTOR changes — a prompt fix, a new
   * entity type, a model swap — because the same text now yields a different
   * (better) result and every item would otherwise be skipped as 'unchanged'.
   * Backfill-only; the live ingest path must keep the gate or every reply would
   * re-bill an unchanged thread.
   */
  force?: boolean;
  /**
   * Store the note but do NOT read it into the graph.
   *
   * The note is written, embedded and searchable exactly as always; what is
   * skipped is `extractFromNote` — the model call — and everything downstream
   * of it. The row lands at `graph_state = 'pending'` and waits for the owner
   * to admit it (see $lib/jkai/intel/mail-admit).
   *
   * This is what stopped the mailbox poisoning the graph. It is a REQUEST, not
   * a command, and the note's existing state overrules it: a thread already
   * admitted re-extracts when a reply arrives (it was approved, and the approval
   * covers the conversation, not one message), and a thread already rejected is
   * left alone rather than re-queued for a decision that has been made.
   */
  hold?: boolean;
}

export type AutoExtractOutcome =
  | { status: 'extracted'; noteId: string; entityCount: number }
  | { status: 'held'; noteId: string }
  | { status: 'unchanged' | 'disabled' | 'too-short' | 'skipped' | 'failed'; noteId?: string };

/** Cap the text sent to the model. Enough for a report; not a whole book. */
const MAX_EXTRACT_CHARS = 24_000;
/**
 * Below this there is nothing worth an LLM call.
 *
 * Exported so a caller that RATIONS its calls can apply the same floor before
 * it spends from its budget. The Gmail sweep decremented `extractBudget` and
 * then discovered the thread was too short in here — no note written, no model
 * called, no hash stored, so the same thread was retried and cost another unit
 * every night in perpetuity. Two clocks for one decision is always a bug; this
 * is the one clock.
 */
export const MIN_EXTRACT_CHARS = 200;

export function isAutoExtractEnabled(): boolean {
  // Off in the builder sidecar — that process imports this transitively but
  // must not duplicate ingest work the web app already does.
  if (process.env.JKAI_BUILDER_PROCESS === '1') return false;
  return process.env.INTEL_AUTO_EXTRACT !== '0';
}

async function findDerivedNote(kind: AutoKind, refId: string) {
  const [row] = await db
    .select({ id: intelNotes.id, metadata: intelNotes.metadata, graphState: intelNotes.graphState })
    .from(intelNotes)
    .where(
      and(
        sql`${intelNotes.metadata}->>'autoKind' = ${kind}`,
        sql`${intelNotes.metadata}->>'refId' = ${refId}`,
      ),
    )
    .limit(1);
  return row ?? null;
}


/**
 * What kind of email this note came from, where it came from one.
 *
 * `source: 'email'` covers 62% of the entities in the graph and describes a
 * colleague writing to you, a service reporting a build, and a shop announcing
 * a sale — all as one thing, which is why the source filter could not narrow
 * anything. These two fields are what let it.
 *
 * Derived HERE, where the note's metadata is assembled, rather than in the
 * Gmail ingest specifically: anything that supplies `participants` gets
 * classified, and nothing that does not is affected.
 *
 * The mailbox owner comes from `gmailAccount`, which the ingest already writes
 * on every email note. Without it the owner would be treated as the sender, and
 * since the owner is on every thread by definition, every email would classify
 * identically.
 */
async function emailFacets(
  metadata: Record<string, unknown> | undefined,
): Promise<Record<string, string> | undefined> {
  const participants = metadata?.participants;
  if (!Array.isArray(participants) || participants.length === 0) return undefined;

  try {
    const [{ classifyEmail }, { emailDomainOverrides }] = await Promise.all([
      import('./email-kind'),
      import('./email-domain-rules'),
    ]);
    const owner = typeof metadata?.gmailAccount === 'string' ? [metadata.gmailAccount] : [];
    const result = classifyEmail(
      participants.map((p) => String(p)),
      owner,
      await emailDomainOverrides(),
    );
    return {
      emailKind: result.kind,
      ...(result.domain ? { senderDomain: result.domain } : {}),
    };
  } catch (err) {
    // A note with no facets is filterable by source as it always was. A note
    // that failed to be written at all is a lost thread.
    console.warn('[intel] could not classify email note', err);
    return undefined;
  }
}

/**
 * Extract entities/relationships/timeline events from an upstream knowledge
 * item into the intel graph. Idempotent per (kind, refId, contentHash).
 */
export async function extractIntoIntel(input: AutoExtractInput): Promise<AutoExtractOutcome> {
  if (!isAutoExtractEnabled()) return { status: 'disabled' };

  const text = (input.text ?? '').trim();
  if (text.length < MIN_EXTRACT_CHARS) return { status: 'too-short' };

  try {
    const existing = await findDerivedNote(input.kind, input.refId);
    if (existing && !input.force) {
      const prevHash = (existing.metadata as Record<string, unknown> | null)?.contentHash;
      if (prevHash === input.contentHash) return { status: 'unchanged', noteId: existing.id };
    }

    // What the gate actually decides, resolved once and before any work.
    //
    // The caller's `hold` is a request about a note it may never have seen. The
    // note's own state is the fact, and the fact wins:
    //
    //   rejected  — the owner has ruled. A new reply does not reopen it, and
    //               re-queueing would ask the same question a second time.
    //   admitted  — approved, so a new reply is extracted like any other
    //               source. Approval is of the thread, not of one message.
    //   pending / new — held, which is what `hold` asked for.
    const priorState = existing?.graphState ?? null;
    if (priorState === 'rejected') return { status: 'skipped', noteId: existing?.id };
    const held = !!input.hold && priorState !== 'admitted';

    const clipped = text.length > MAX_EXTRACT_CHARS ? text.slice(0, MAX_EXTRACT_CHARS) : text;
    const metadata = {
      ...(input.metadata ?? {}),
      autoKind: input.kind,
      refId: input.refId,
      contentHash: input.contentHash,
      sourceTag: input.kind,
      ...(await emailFacets(input.metadata)),
    };

    // One derived note per source item, reused across re-indexes so the graph
    // does not accumulate a new note every time a file is touched.
    //
    // processedContent is written UP FRONT, not after extraction: the entity
    // summariser reads it as evidence, and persistExtraction kicks that off. Set
    // afterwards, the summariser found an empty note, correctly declined to
    // invent detail, and every entity was left summary-less — which also left
    // entity embeddings weaker, since they embed name + summary + properties.
    const categories = input.categories ?? [];
    let noteId: string;
    if (existing) {
      noteId = existing.id;
      await db
        .update(intelNotes)
        .set({
          title: input.title,
          rawContent: clipped,
          processedContent: clipped,
          status: held ? 'held' : 'processing',
          ...(held ? { graphState: 'pending' as const } : {}),
          metadata,
          categories,
          // Also set on update, so notes written before a source override
          // existed are corrected the next time their thread is swept.
          ...(input.source ? { source: input.source } : {}),
          ...(input.observedAt ? { observedAt: input.observedAt } : {}),
          updatedAt: new Date(),
        })
        .where(eq(intelNotes.id, noteId));
    } else {
      const [created] = await db
        .insert(intelNotes)
        .values({
          title: input.title,
          rawContent: clipped,
          processedContent: clipped,
          source: input.source ?? input.kind,
          format: 'summary',
          status: held ? 'held' : 'processing',
          graphState: held ? 'pending' : 'admitted',
          metadata,
          categories,
          observedAt: input.observedAt,
        })
        .returning({ id: intelNotes.id });
      noteId = created.id;
    }

    // Held: the note is stored, and that is the whole job.
    //
    // The embedding is still worth paying for and is the only cost here — a
    // fraction of a cent per thread against the model call it replaces. It is
    // what lets the queue group a mailbox by TOPIC rather than only by sender,
    // and what makes a pending note findable before anyone has decided about
    // it. The graph-facing readers (searchIntel, recall) filter to admitted, so
    // an embedded pending note cannot leak into an answer through that door.
    if (held) {
      await embedNote(noteId).catch((err) =>
        // A note that could not be embedded is still a note. It clusters by
        // sender and subject like any other; it just will not match on topic.
        console.warn(`[intel:auto] could not embed held note ${noteId}:`, err instanceof Error ? err.message : err),
      );
      return { status: 'held', noteId };
    }

    // An unparseable model response now THROWS rather than resolving to an
    // empty extraction (see extractFromNote). Mark the note failed so it is
    // visibly re-runnable — leaving it 'processing' would strand it, and the old
    // behaviour marked it 'processed' with nothing in it, which is a lie.
    let extraction;
    try {
      extraction = await extractFromNote(clipped, 'summary');
    } catch (err) {
      await db
        .update(intelNotes)
        .set({ status: 'failed', updatedAt: new Date() })
        .where(eq(intelNotes.id, noteId));
      console.error(
        `[intel:auto] ${input.kind} ${input.refId} extraction failed:`,
        err instanceof Error ? err.message : err,
      );
      return { status: 'failed', noteId };
    }
    const stats = await persistExtraction(noteId, extraction);

    await db
      .update(intelNotes)
      .set({
        title: input.title || extraction.summary.slice(0, 100) || input.kind,
        status: 'processed',
        // Extraction happened, so by definition this note is in the graph. Set
        // here rather than by the admission path alone, because the state has to
        // describe what is TRUE of the row, not what somebody intended — a note
        // left at 'pending' with entities hanging off it would make the purge
        // and the queue disagree about the same thread.
        graphState: 'admitted',
        updatedAt: new Date(),
      })
      .where(eq(intelNotes.id, noteId));

    // Non-fatal, and the ordering is why. By this line the entities and edges
    // are committed and the note is already marked `processed` / `admitted`, so
    // throwing here would return 'failed' for work that had entirely succeeded:
    // the queue would say "retry me" about a thread already in the graph, and
    // the caller would skip recording the decision. Inconsistent, not merely
    // untidy.
    //
    // It is also the exact failure seen on 2026-08-27. Extraction fell back to
    // Codex when OpenRouter ran out of credit and succeeded; embeddings cannot
    // fall back (the bridge has no such endpoint), so this line threw and took a
    // good admission down with it. An entity without a vector is still an
    // entity — it just will not match by similarity until re-embedded, which is
    // what `backfillPendingEmbeddings` and the entity backfill sweep are for.
    //
    // Matches the two entity-embedding call sites in ./graph, both of which
    // already swallow this.
    await embedNote(noteId).catch((err) =>
      console.warn(
        `[intel:auto] ${input.kind} ${input.refId} extracted but not embedded:`,
        err instanceof Error ? err.message : err,
      ),
    );

    console.log(
      `[intel:auto] ${input.kind} ${input.refId} → ${stats.entityCount} entities, ${stats.relationshipCount} relationships`,
    );
    return { status: 'extracted', noteId, entityCount: stats.entityCount };
  } catch (err) {
    console.error(
      `[intel:auto] ${input.kind} ${input.refId} failed:`,
      err instanceof Error ? err.message : err,
    );
    return { status: 'failed' };
  }
}

/**
 * Fire-and-forget wrapper for ingest call sites. Never throws, never delays the
 * caller — indexing a file must not wait on an LLM round trip.
 */
export function queueIntelExtraction(input: AutoExtractInput): void {
  if (!isAutoExtractEnabled()) return;
  void extractIntoIntel(input).catch(() => {});
}

export interface DerivedDeleteResult {
  notesDeleted: number;
  entitiesRemoved: number;
  relationshipsRemoved: number;
}

/**
 * Remove the intel derived from an upstream source that has gone away.
 *
 * A derived note holds no foreign key to its source — a Drive file lives in
 * `workflow_files`, a deep dive in `research_session` — so deleting the source
 * deleted its bytes and its embeddings and left the entities, relationships and
 * timeline events behind, attributed to a document that no longer exists. Every
 * delete path for those sources calls this.
 *
 * `deleteNoteCascade` decides what actually goes: an entity that another note
 * also asserts is kept, because the source dying is not evidence that the thing
 * it mentioned stopped existing.
 */
export async function deleteDerivedIntel(
  kind: AutoKind,
  refId: string,
): Promise<DerivedDeleteResult> {
  const result: DerivedDeleteResult = {
    notesDeleted: 0,
    entitiesRemoved: 0,
    relationshipsRemoved: 0,
  };
  if (!refId) return result;

  try {
    const notes = await db
      .select({ id: intelNotes.id })
      .from(intelNotes)
      .where(
        and(
          sql`${intelNotes.metadata}->>'autoKind' = ${kind}`,
          sql`${intelNotes.metadata}->>'refId' = ${refId}`,
        ),
      );
    if (notes.length === 0) return result;

    const { deleteNoteCascade } = await import('./ingest');
    for (const note of notes) {
      const cascade = await deleteNoteCascade(note.id);
      result.notesDeleted += 1;
      result.entitiesRemoved += cascade.removedEntities;
      result.relationshipsRemoved += cascade.removedRelationships;
    }

    // Every downstream reader works off the cached snapshot; without this the
    // graph keeps drawing the deleted entities for up to a minute.
    const { invalidateGraphAnalysis } = await import('./analytics/load');
    invalidateGraphAnalysis();

    console.log(
      `[intel:auto] ${kind} ${refId} removed — ${result.notesDeleted} note(s), ${result.entitiesRemoved} entities`,
    );
  } catch (err) {
    // Deleting a file must not fail because the graph was busy.
    console.error(
      `[intel:auto] cascade delete for ${kind} ${refId} failed:`,
      err instanceof Error ? err.message : err,
    );
  }
  return result;
}

/** Fire-and-forget form for delete handlers that must not wait on the graph. */
export function queueDerivedIntelDelete(kind: AutoKind, refId: string): void {
  void deleteDerivedIntel(kind, refId).catch(() => {});
}

export interface BackfillProgress {
  scanned: number;
  extracted: number;
  unchanged: number;
  skipped: number;
  failed: number;
  entities: number;
  truncated: boolean;
}

export interface BackfillOptions {
  /** Which corpora to sweep. Default: both. */
  kinds?: AutoKind[];
  /**
   * Cap on items that do REAL work (an LLM call) in one run. Items already
   * extracted at the current content hash are cheap and don't count, so
   * repeated calls with a small limit walk forward through the corpus instead
   * of re-examining the same head every time. `extracted === 0` means done.
   */
  limit?: number;
}

/**
 * Sweep the existing corpus into the intel graph. Auto-extraction only fires on
 * NEW ingest, so everything indexed before it existed needs this once.
 *
 * Sequential on purpose: each item is an LLM call, and running them
 * concurrently against the gateway buys little while risking rate limits mid-
 * sweep. Idempotent — re-running only touches items whose content changed.
 */
export async function backfillIntelExtraction(opts: BackfillOptions = {}): Promise<BackfillProgress> {
  const kinds = opts.kinds ?? (['file', 'research'] as AutoKind[]);
  const workLimit = Math.max(1, Math.min(opts.limit ?? 500, 2000));
  const SCAN_CEILING = 5000;
  const progress: BackfillProgress = {
    scanned: 0,
    extracted: 0,
    unchanged: 0,
    skipped: 0,
    failed: 0,
    entities: 0,
    truncated: false,
  };

  if (!isAutoExtractEnabled()) return progress;

  // Only 'extracted' and 'failed' spend an LLM call, so only those count
  // against the limit — otherwise a small batch size would re-examine the same
  // already-done head of the corpus on every call and never advance.
  let worked = 0;
  const record = (outcome: AutoExtractOutcome) => {
    if (outcome.status === 'extracted') {
      progress.extracted++;
      progress.entities += outcome.entityCount;
      worked++;
    } else if (outcome.status === 'unchanged') progress.unchanged++;
    else if (outcome.status === 'failed') {
      progress.failed++;
      worked++;
    } else progress.skipped++;
  };
  const exhausted = () => worked >= workLimit || progress.scanned >= SCAN_CEILING;

  if (kinds.includes('file')) {
    // Only files that actually have indexed text — anything else has nothing to
    // extract from, and re-reading bytes here would duplicate indexFile's work.
    const { rows } = await db.execute(sql`
      SELECT f.id, f.name, f.content_hash AS hash, string_agg(e.text, E'\n\n' ORDER BY e.chunk_ord) AS text
      FROM workflow_files f
      JOIN file_embeddings e ON e.file_id = f.id
      WHERE f.content_hash IS NOT NULL
      GROUP BY f.id, f.name, f.content_hash
      ORDER BY f.id
      LIMIT ${SCAN_CEILING}
    `);

    // Resolved once: the policy context is the same for every file in the sweep.
    const { loadSourcePolicyContext, policyForFileName } = await import('./source-policy.server');
    const policyCtx = await loadSourcePolicyContext();

    for (const row of rows as Array<Record<string, unknown>>) {
      if (exhausted()) {
        progress.truncated = true;
        break;
      }
      progress.scanned++;
      const name = String(row.name ?? 'file');
      const policy = await policyForFileName(name, policyCtx);
      if (!policy.included) {
        progress.skipped++;
        continue;
      }
      record(
        await extractIntoIntel({
          kind: 'file',
          refId: String(row.id),
          title: name,
          text: String(row.text ?? ''),
          contentHash: String(row.hash ?? ''),
          categories: policy.categorySlugs,
          metadata: { sourceUrl: '/drive', backfilled: true },
        }),
      );
    }
  }

  if (kinds.includes('research') && !exhausted()) {
    const sessions = await db
      .select({ id: researchSessions.id })
      .from(researchSessions)
      .where(isNotNull(researchSessions.report))
      .orderBy(researchSessions.id);

    const { extractResearchIntoIntel } = await import('$lib/deepdive/intel-bridge');
    for (const s of sessions) {
      if (exhausted()) {
        progress.truncated = true;
        break;
      }
      progress.scanned++;
      try {
        record(await extractResearchIntoIntel(s.id));
      } catch {
        progress.failed++;
        worked++;
      }
    }
  }

  console.log(
    `[intel:auto] backfill done — scanned ${progress.scanned}, extracted ${progress.extracted} (${progress.entities} entities), unchanged ${progress.unchanged}, skipped ${progress.skipped}, failed ${progress.failed}`,
  );
  return progress;
}

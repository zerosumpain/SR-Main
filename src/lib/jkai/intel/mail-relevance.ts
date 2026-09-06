// How much a held thread has to do with the graph you already have.
//
// The gate's fact vocabulary (../mail-facts) describes the SHAPE of a thread —
// who sent it, whether you replied, how long it is. It has no way to say "this
// one matters because it is about things I track", and the rule proposer's
// prompt admitted as much: *you cannot see topics*. So the queue could rank a
// two-line "thanks" above a supplier's contract renewal, and a rule could not
// tell them apart at all.
//
// This module is that missing axis, and it costs no model calls. Both halves
// read data the graph already paid for:
//
//   - the LEXICAL half matches entity names and aliases against the thread's
//     prose. Explainable on the row — "names Keystone, DfE" — and deterministic,
//     so a backtest replays it exactly;
//   - the SEMANTIC half is one kNN from the thread's own embedding (every held
//     note has had one since the gate shipped) to the nearest entity vector. It
//     catches the thread that is plainly about your work and happens to share no
//     vocabulary with it.
//
// ── The anchor rule, which is the whole safety story ──────────────────────
//
// Relevance measured against a graph that email FEEDS is a loop: admit a
// newsletter, it mints entities, those entities make the next newsletter look
// relevant, admit that. That is how the graph got to 8,974 junk entities the
// first time, and a scorer is a faster way back there.
//
// So a hit only counts when the entity is ANCHORED OUTSIDE EMAIL — watched, in
// a dossier, or asserted by at least one note that is not an email. Email can
// therefore corroborate what the graph knows from elsewhere; it can never
// bootstrap its own relevance. Every number here is computed against anchored
// entities only, and that is not tuning, it is the load-bearing constraint.
//
// The scored values are STORED on the note's metadata rather than computed on
// read, for the same reason every other fact is: `factsFor` stays pure, the
// queue page stays one query, and a rule can be backtested over 2,781 threads
// without a single vector probe.

import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { intelNotes } from '$lib/db/schema';
import { canonicalName, normaliseName } from './resolve/match';

/** Shape written to `intel_notes.metadata.graphRelevance`. */
export interface GraphRelevance {
  /** Distinct anchored entities this thread names. */
  hits: number;
  /** The weight of the most important one — 3 in your foreground (watched,
   *  lensed or in a dossier), 2 well corroborated, 1 merely known, 0 none. */
  topWeight: number;
  /** 1 − cosine distance to the nearest anchored entity vector, 0 when unknown. */
  similarity: number;
  /** Up to five entity names, for the queue row. Names only, never ids: the row
   *  has to read as a sentence, and an id explains nothing to anybody. */
  names: string[];
  scoredAt: string;
}

/** An entity a thread is allowed to be scored against. */
export interface AnchoredEntity {
  id: string;
  name: string;
  weight: 1 | 2 | 3;
  /** Surface forms observed elsewhere. The name itself is not repeated here. */
  aliases: string[];
}

/**
 * Single words too common to identify anything.
 *
 * A cheap first cut only. The real guard is the document-frequency pass in
 * `scoreMailRelevance` — see DF_BLOCK_SHARE. A hand-written list cannot work on
 * its own and the first production run proved it: with this list alone, 97.7% of
 * the mailbox "named something the graph knows", because the graph holds
 * entities called "time", "browser", "summer", "Privacy Policy" and — worst —
 * the owner's own name, which is in every email he has ever received.
 */
const GENERIC_SURFACES = new Set([
  'data', 'report', 'reports', 'security', 'team', 'teams', 'project', 'projects',
  'service', 'services', 'system', 'systems', 'platform', 'strategy', 'policy',
  'design', 'review', 'meeting', 'update', 'updates', 'account', 'accounts',
  'support', 'admin', 'user', 'users', 'group', 'board', 'office', 'business',
  'company', 'client', 'customer', 'product', 'programme', 'program', 'plan',
  'work', 'home', 'health', 'travel', 'news', 'search', 'chat', 'mail', 'email',
  'file', 'files', 'note', 'notes', 'page', 'site', 'web', 'app', 'api', 'test',
]);

/** A single-token surface shorter than this identifies nothing. Set at 3 so
 *  acronyms the graph is full of — DfE, IBCA, SCS — still count. */
const MIN_SINGLE_TOKEN = 3;
/** Longest name, in tokens, the sliding window will look for. */
const MAX_SURFACE_TOKENS = 6;
/** Text past this is not read. A pathological thread must not stall a sweep. */
const MAX_MATCH_CHARS = 20_000;

/**
 * Share of the corpus above which an entity stops counting as a signal.
 *
 * This is IDF, and it is the guard that actually works. An entity naming 441 of
 * 3,776 threads discriminates nothing — whatever it is, it is footer boilerplate,
 * a platform every service emails about, or the owner himself. A hand-written
 * stop-list cannot anticipate those; a frequency cut-off needs no list and
 * re-tunes itself as the mailbox changes.
 *
 * Measured on the first production run, the names above this line were:
 * "Johnkelly Main" (1,130 threads — the owner), "Email thread" (807), "time"
 * (692), "Privacy Policy" (441), "browser" (418), "summer" (290), "Run" (278),
 * "emails" (272), "Gmail" (257), "LinkedIn" (216), "credit" (209) and
 * "Facebook" (193). Everything the owner would actually want — Darlington,
 * Keystone, real correspondents — sits well below it.
 */
export const DF_BLOCK_SHARE = 0.05;
/** Below this many threads the share is meaningless, so nothing is blocked. */
const DF_MIN_CORPUS = 200;

/**
 * The text a thread is scored on.
 *
 * The note's header block and per-message routing lines are dropped, and that
 * matters more than it looks: they carry every participant's address and
 * display name, so scoring them would match an entity against the SENDER of a
 * bulk mailshot and score its whole newsletter run as relevant. The subject
 * survives — it is the single most informative line in an email — but the
 * `Subject:` label itself does not.
 */
export function relevanceTextOf(title: string | null, body: string | null): string {
  const kept: string[] = [];
  if (title) kept.push(title);
  for (const line of (body ?? '').split('\n')) {
    if (/^(Subject|Participants|Messages):/.test(line)) continue;
    // `[1] · 2026-08-01 · from Jane Doe <jane@x.com> · to John Kelly <me@x.com>`
    if (/^\[\d+\]\s*·/.test(line)) continue;
    kept.push(line);
  }
  return kept.join('\n').slice(0, MAX_MATCH_CHARS);
}

/**
 * Surfaces worth indexing for one entity, deduplicated and guarded.
 *
 * Exported and called from `buildSurfaceIndex` rather than by whoever loads the
 * entities, so the generic-name guard sits on the ONE path into the index. An
 * `AnchoredEntity` carrying its own pre-built surfaces could skip it, and the
 * guard is the difference between a scorer and a firehose.
 */
export function surfacesFor(name: string, aliases: readonly string[] = []): string[] {
  const out = new Set<string>();
  for (const raw of [name, canonicalName(name), ...aliases]) {
    const surface = normaliseName(String(raw ?? ''));
    if (!surface) continue;
    const tokens = surface.split(' ');
    if (tokens.length > MAX_SURFACE_TOKENS) continue;
    if (tokens.length === 1) {
      if (surface.length < MIN_SINGLE_TOKEN) continue;
      if (GENERIC_SURFACES.has(surface)) continue;
      // A bare number names nothing — "2026", "5a", version strings.
      if (!/[a-z]/.test(surface)) continue;
    }
    out.add(surface);
  }
  return [...out];
}

export interface SurfaceIndex {
  by: Map<string, { id: string; name: string; weight: number }>;
  /** First token of every indexed surface, and the widths that actually occur.
   *  Both exist to prune the scan — see `matchEntities`. */
  starts: Set<string>;
  widths: number[];
  size: number;
}

/**
 * Index the anchored entities by every string that names them. PURE.
 *
 * Where two entities share a surface the HIGHER weight wins: a thread naming
 * something both a watched entity and a stray one are called is more likely to
 * mean the one you watch, and under-reporting relevance is the failure that
 * loses mail.
 */
export function buildSurfaceIndex(entities: readonly AnchoredEntity[]): SurfaceIndex {
  const by = new Map<string, { id: string; name: string; weight: number }>();
  const starts = new Set<string>();
  const widths = new Set<number>();
  for (const entity of entities) {
    for (const surface of surfacesFor(entity.name, entity.aliases)) {
      const tokens = surface.split(' ');
      starts.add(tokens[0]);
      widths.add(tokens.length);
      const existing = by.get(surface);
      if (!existing || entity.weight > existing.weight) {
        by.set(surface, { id: entity.id, name: entity.name, weight: entity.weight });
      }
    }
  }
  // Widest first is presentation, not correctness: every width is tried at
  // every position and hits deduplicate by entity id, so "Keystone" and
  // "Keystone Data Strategy" both count when both are in the graph and the text
  // says the longer one. That is deliberate — they are two entities and the
  // thread does name both.
  return { by, starts, widths: [...widths].sort((a, b) => b - a), size: by.size };
}

export interface LexicalMatch {
  hits: number;
  topWeight: number;
  names: string[];
}

/**
 * Every anchored entity this text names, by id. PURE.
 *
 * A sliding window over the normalised tokens. Deduplicated by entity id, so a
 * name repeated forty times in a quoted reply chain still counts once —
 * otherwise the longest thread would always be the most relevant one.
 *
 * Pruned twice, because the naive form is 3,300 tokens x 6 widths x 3,776
 * threads and that is 75 million map lookups a night for nothing: a position
 * whose first token starts no indexed name cannot begin a match, and a width no
 * stored name actually has is never worth slicing for.
 *
 * Separate from `matchEntities` so the document-frequency pass can count raw
 * hits before anything has been blocked — the block list is derived FROM these
 * counts, so it cannot also be an input to them.
 */
export function matchedEntities(
  text: string,
  index: SurfaceIndex,
): Map<string, { name: string; weight: number }> {
  const tokens = normaliseName(text).split(' ').filter(Boolean);
  const found = new Map<string, { name: string; weight: number }>();

  for (let i = 0; i < tokens.length; i++) {
    if (!index.starts.has(tokens[i])) continue;
    for (const width of index.widths) {
      if (i + width > tokens.length) continue;
      const hit = index.by.get(width === 1 ? tokens[i] : tokens.slice(i, i + width).join(' '));
      if (hit && !found.has(hit.id)) found.set(hit.id, { name: hit.name, weight: hit.weight });
    }
  }
  return found;
}

export interface MatchOptions {
  /** Entity ids the document-frequency pass has ruled out. */
  blocked?: ReadonlySet<string>;
  sampleLimit?: number;
}

/** The summary a note is scored on: how many, how important, and which. PURE. */
export function matchEntities(text: string, index: SurfaceIndex, opts: MatchOptions = {}): LexicalMatch {
  const sampleLimit = opts.sampleLimit ?? 5;
  const found = matchedEntities(text, index);
  if (opts.blocked?.size) {
    for (const id of found.keys()) if (opts.blocked.has(id)) found.delete(id);
  }

  const matches = [...found.values()].sort((a, b) => b.weight - a.weight);
  return {
    hits: matches.length,
    topWeight: matches[0]?.weight ?? 0,
    names: matches.slice(0, sampleLimit).map((m) => m.name),
  };
}

/** Postgres costs a random page at 4.0 by default — a spinning-disk number that
 *  makes the planner ignore every HNSW index here. See the same treatment, and
 *  the 172s → 3.6s measurement behind it, in ./resolve/merge.ts. */
const SSD_RANDOM_PAGE_COST = 1.1;
/** Neighbours fetched per thread before the anchor filter is applied in code.
 *  Filtering inside the query would need a 4,000-id array and cost the index. */
const KNN_K = 25;
/** Notes per similarity probe and per write. */
const CHUNK = 400;

/**
 * Every entity a thread may be scored against, with its weight.
 *
 * Three queries rather than correlated EXISTS: the two anchor sets are small
 * and read once, where an EXISTS per entity is 4,500 probes into two tables to
 * answer the same question.
 */
export async function loadAnchoredEntities(): Promise<AnchoredEntity[]> {
  const [entities, dossiered, offEmail] = await Promise.all([
    db.execute(sql`
      SELECT e.id, e.name, e.aliases, e.watched, e.lens, e.corroboration, e.confidence_score
      FROM intel_entities e
      WHERE e.merged_into_id IS NULL AND e.name IS NOT NULL
    `),
    db.execute(sql`SELECT DISTINCT ref_id FROM intel_dossier_items WHERE kind = 'entity' AND ref_id IS NOT NULL`),
    db.execute(sql`
      SELECT DISTINCT ne.entity_id
      FROM intel_note_entities ne
      JOIN intel_notes n ON n.id = ne.note_id
      -- IS DISTINCT FROM, not <>. A NULL source makes the inequality evaluate
      -- to NULL, so the row drops out -- and NULL sources are real here: notes
      -- that predate the column and anything hand-created. Those are the most
      -- likely to be the owner's own material, so the plain inequality would
      -- exclude from the anchor set precisely the entities that most belong.
      WHERE n.source IS DISTINCT FROM 'email'
    `),
  ]);

  const inDossier = new Set((dossiered.rows as Array<Record<string, unknown>>).map((r) => String(r.ref_id)));
  const anchoredElsewhere = new Set((offEmail.rows as Array<Record<string, unknown>>).map((r) => String(r.entity_id)));

  const out: AnchoredEntity[] = [];
  for (const row of entities.rows as Array<Record<string, unknown>>) {
    const id = String(row.id);
    // The owner's own foreground — the three markers the mail-gate purge
    // deliberately preserved when it deleted 8,974 machine-asserted entities.
    // `confirmed` is NOT among them and must never be added: it is written by
    // graph.ts on any high-confidence re-assertion, so 5,875 of those 8,974 junk
    // entities carried it.
    //
    // On production all three are currently EMPTY (0 watched, 0 dossiered, 0
    // lensed as of 2026-09-06), so nothing scores weight 3 yet. That is why no
    // seed rule requires it: the top rung has to be worth something the day the
    // first entity is watched, without being a rule that silently matches
    // nothing until then.
    const foreground = row.watched === true || row.lens != null || inDossier.has(id);
    // The anchor rule. An entity known only from email cannot make more email
    // look relevant — see the header.
    if (!foreground && !anchoredElsewhere.has(id)) continue;

    const corroboration = Number(row.corroboration ?? 0);
    const confidence = row.confidence_score == null ? 0 : Number(row.confidence_score);
    const weight: 1 | 2 | 3 = foreground ? 3 : corroboration >= 3 || confidence >= 0.7 ? 2 : 1;

    const name = String(row.name ?? '');
    const aliases = Array.isArray(row.aliases) ? row.aliases.map((a) => String(a)) : [];
    if (surfacesFor(name, aliases).length) out.push({ id, name, weight, aliases });
  }
  return out;
}

/**
 * Nearest anchored entity vector for each of these notes.
 *
 * The kNN runs UNFILTERED and the anchor test is applied to the results, so the
 * probe stays index-shaped. A thread whose 25 nearest entities are all
 * email-derived scores 0, which is the honest answer rather than a reach down
 * the list for something that qualifies.
 */
async function nearestAnchored(noteIds: string[], anchored: Set<string>): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!noteIds.length) return out;

  const res = await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL random_page_cost = ${sql.raw(String(SSD_RANDOM_PAGE_COST))}`);
    return tx.execute(sql`
      SELECT n.id AS note_id, k.entity_id, k.dist
      FROM intel_notes n
      CROSS JOIN LATERAL (
        SELECT o.id AS entity_id, (n.embedding <=> o.embedding) AS dist
        FROM intel_entities o
        WHERE o.merged_into_id IS NULL AND o.embedding IS NOT NULL
        ORDER BY n.embedding <=> o.embedding
        LIMIT ${KNN_K}
      ) k
      WHERE n.id IN (${sql.join(noteIds.map((id) => sql`${id}`), sql`, `)})
        AND n.embedding IS NOT NULL
    `);
  });

  for (const row of res.rows as Array<Record<string, unknown>>) {
    const entityId = String(row.entity_id);
    if (!anchored.has(entityId)) continue;
    const noteId = String(row.note_id);
    const similarity = 1 - Number(row.dist ?? 1);
    const best = out.get(noteId);
    if (best === undefined || similarity > best) out.set(noteId, similarity);
  }
  return out;
}

export interface ScoreResult {
  /** Threads read. */
  scanned: number;
  /** Threads whose score changed or was written for the first time. */
  scored: number;
  /** Threads naming at least one anchored entity. */
  withHits: number;
  /** Threads inside `states` the limit did not reach. Anything but 0 means part
   *  of the queue is answering a topical rule on stale or absent numbers, which
   *  is invisible from `scanned` alone. */
  remaining: number;
  /** Anchored entities the matcher was built from — 0 means the graph has
   *  nothing to score against and every thread will read as irrelevant. */
  entities: number;
  /** Of those, how many are in the owner's foreground: watched, lensed or in a
   *  dossier. 0 means no thread can ever reach topWeight 3, so a rule keyed on
   *  the foreground matches nothing — which is correct, and needs saying out
   *  loud rather than looking like a quiet mailbox. */
  foreground: number;
  /** True when the vector half could not run. The lexical half still did. */
  similarityFailed: boolean;
  /** Entities the document-frequency pass stopped counting, and the worst
   *  offenders by name. Reported rather than silent: "this thread names
   *  nothing" and "everything it names is boilerplate" are different answers
   *  and the second one is the interesting one. */
  blocked: number;
  blockedNames: string[];
  /** Hit counts across the run, for the page and the run log. */
  distribution: Record<string, number>;
}

export interface ScoreOptions {
  /** Which states to score. Pending is the queue; admitted is scored too so the
   *  rule engine's backtest can compare like with like against decided mail. */
  states?: string[];
  limit?: number;
  now?: number;
}

/**
 * Score held mail against the graph.
 *
 * Rescores everything in range rather than only what is unscored: the matcher
 * changes whenever an entity is watched, merged or pinned to a dossier, and a
 * score computed against last month's graph is a stale answer that looks
 * exactly like a fresh one.
 */
export async function scoreMailRelevance(opts: ScoreOptions = {}): Promise<ScoreResult> {
  const states = opts.states ?? ['pending'];
  const limit = opts.limit ?? 5000;
  const scoredAt = new Date(opts.now ?? Date.now()).toISOString();
  const out: ScoreResult = {
    scanned: 0,
    scored: 0,
    withHits: 0,
    remaining: 0,
    entities: 0,
    foreground: 0,
    blocked: 0,
    blockedNames: [],
    similarityFailed: false,
    distribution: {},
  };

  const anchored = await loadAnchoredEntities();
  out.entities = anchored.length;
  out.foreground = anchored.filter((e) => e.weight === 3).length;
  if (!anchored.length) {
    console.warn('[intel:mail-relevance] no anchored entities — nothing to score against');
    return out;
  }
  const index = buildSurfaceIndex(anchored);
  const anchoredIds = new Set(anchored.map((e) => e.id));

  const notes = await db
    .select({
      id: intelNotes.id,
      title: intelNotes.title,
      rawContent: intelNotes.rawContent,
      metadata: intelNotes.metadata,
    })
    .from(intelNotes)
    .where(and(eq(intelNotes.source, 'email'), inArray(intelNotes.graphState, states)))
    // Newest first, matching the sweep and the queue. A LIMIT with no ORDER BY
    // takes an arbitrary slice, so on a corpus past the limit a different set of
    // threads would be scored each night and some would never be scored at all —
    // silently, since an unscored thread reports 0 exactly like an irrelevant one.
    .orderBy(desc(sql`coalesce(${intelNotes.observedAt}, ${intelNotes.createdAt})`))
    .limit(limit + 1);

  // One row over the limit was fetched purely to answer "is there more?".
  out.remaining = Math.max(0, notes.length - limit);
  const inRange = notes.slice(0, limit);

  // ── Pass one: document frequency ──
  //
  // Count how many threads each entity appears in, then stop counting the ones
  // that appear nearly everywhere. Matching is in-memory and already indexed, so
  // a second pass costs a fraction of a second and buys the only guard that
  // actually holds: without it the first production run scored 97.7% of the
  // mailbox as naming something, on the strength of "Privacy Policy", "browser"
  // and the owner's own name.
  const texts = inRange.map((n) => relevanceTextOf(n.title, n.rawContent));
  const blocked = new Set<string>();
  if (inRange.length >= DF_MIN_CORPUS) {
    const df = new Map<string, { name: string; n: number }>();
    for (const text of texts) {
      for (const [id, hit] of matchedEntities(text, index)) {
        const seen = df.get(id);
        if (seen) seen.n++;
        else df.set(id, { name: hit.name, n: 1 });
      }
    }
    const ceiling = inRange.length * DF_BLOCK_SHARE;
    const over = [...df.entries()].filter(([, v]) => v.n > ceiling).sort((a, b) => b[1].n - a[1].n);
    for (const [id] of over) blocked.add(id);
    out.blocked = over.length;
    out.blockedNames = over.slice(0, 15).map(([, v]) => `${v.name} (${v.n})`);
    if (over.length) {
      console.log(
        `[intel:mail-relevance] ${over.length} entities appear in more than ` +
          `${Math.round(DF_BLOCK_SHARE * 100)}% of threads and no longer count: ${out.blockedNames.join(', ')}`,
      );
    }
  }

  for (let start = 0; start < inRange.length; start += CHUNK) {
    const chunk = inRange.slice(start, start + CHUNK);
    let nearest = new Map<string, number>();
    try {
      nearest = await nearestAnchored(chunk.map((n) => n.id), anchoredIds);
    } catch (err) {
      // The lexical half is the primary signal and does not need vectors. A
      // missing index or an unembedded corpus degrades the score; it must not
      // lose the run. Reported rather than swallowed — a similarity of 0 across
      // a whole mailbox is otherwise indistinguishable from a boring one.
      out.similarityFailed = true;
      console.error(
        '[intel:mail-relevance] similarity pass unavailable:',
        err instanceof Error ? err.message : err,
      );
    }

    const writes: Array<{ id: string; relevance: GraphRelevance }> = [];
    for (let i = 0; i < chunk.length; i++) {
      const note = chunk[i];
      out.scanned++;
      // Reuses the text pass one already built, and applies the block list it
      // derived. Pass two is the only one whose numbers are stored.
      const match = matchEntities(texts[start + i], index, { blocked });
      const relevance: GraphRelevance = {
        hits: match.hits,
        topWeight: match.topWeight,
        similarity: Math.max(0, Math.round((nearest.get(note.id) ?? 0) * 1000) / 1000),
        names: match.names,
        scoredAt,
      };
      if (match.hits > 0) out.withHits++;
      const bucket = match.hits === 0 ? '0' : match.hits === 1 ? '1' : match.hits <= 3 ? '2-3' : match.hits <= 7 ? '4-7' : '8+';
      out.distribution[bucket] = (out.distribution[bucket] ?? 0) + 1;

      const prior = (note.metadata as Record<string, unknown> | null)?.graphRelevance as GraphRelevance | undefined;
      if (
        prior &&
        prior.hits === relevance.hits &&
        prior.topWeight === relevance.topWeight &&
        prior.similarity === relevance.similarity
      ) {
        continue;
      }
      writes.push({ id: note.id, relevance });
    }

    if (writes.length) {
      // One statement per chunk, and deliberately NOT touching `updated_at`: a
      // derived score is not a change to the note, and bumping it nightly on
      // thousands of rows would make every recency reader think the whole
      // mailbox had just moved.
      await db.execute(sql`
        UPDATE intel_notes AS n
        SET metadata = coalesce(n.metadata, '{}'::jsonb) || jsonb_build_object('graphRelevance', v.rel::jsonb)
        FROM (VALUES ${sql.join(
          writes.map((w) => sql`(${w.id}::text, ${JSON.stringify(w.relevance)}::text)`),
          sql`, `,
        )}) AS v(id, rel)
        WHERE n.id = v.id
      `);
      out.scored += writes.length;
    }
  }

  console.log(
    `[intel:mail-relevance] ${out.scanned} threads scored against ${out.entities} anchored entities — ` +
      `${out.withHits} name at least one, ${out.scored} changed` +
      (out.remaining ? `, ${out.remaining} past the limit` : '') +
      (out.similarityFailed ? ' (similarity unavailable)' : ''),
  );
  return out;
}

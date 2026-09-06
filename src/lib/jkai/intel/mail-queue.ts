// The admission queue — 2,781 held threads made decidable.
//
// A list of 2,781 emails is not a queue, it is a refusal to help. The whole
// value of this module is that almost none of those threads deserve an
// individual judgement: a mailbox is enormously repetitive, and the decisions
// that matter are about GROUPS. 204 sender domains cover the corpus, and inside
// a domain the subjects repeat — "Your order #204-3656 has shipped" and "Your
// order #887-1120 has shipped" are one decision and two hundred emails.
//
// So the queue offers three ways in, cheapest first:
//
//   1. **Suggestions** — a ranked shortlist of threads that look like they
//      matter, so there is somewhere obvious to start.
//   2. **Clusters** — by sender, and by subject family within a sender. One
//      keystroke settles a hundred threads.
//   3. **Individual threads** — for the ones that genuinely are one-offs.
//
// Clustering is deterministic and free: no model, no vectors, no clock. Topic
// grouping by EMBEDDING exists too but is deliberately on-demand
// (`similarPending`), one kNN query when the owner asks "what else looks like
// this" — clustering 2,781 vectors pairwise up front would cost minutes of
// database time to produce groups that subject families already describe well.
//
// The ranking and grouping functions are PURE and exported for their tests; the
// two functions at the bottom are the only ones that touch the database.

import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { intelNotes } from '$lib/db/schema';
import { factsFor, subjectFamily, type MailFacts, type NoteForFacts } from './mail-facts';

export interface QueueNote extends NoteForFacts {
  id: string;
  graphState: string;
}

export interface QueueRow {
  id: string;
  subject: string;
  senderDomain: string;
  emailKind: string;
  important: boolean;
  ownerReplied: boolean;
  twoWay: boolean;
  hasAttachments: boolean;
  messageCount: number;
  bodyChars: number;
  observedAt: string | null;
  /** True when the note is a header-only stub the sweep never captured a body
   *  for. Admission re-reads the thread from Gmail, so it is still admittable —
   *  but the queue must not show an empty preview and call it the email. */
  captured: boolean;
  score: number;
  /** Why it scored — shown on the row so a suggestion is never a black box. */
  reasons: string[];
  gmailUrl: string | null;
  /** Anchored entities this thread names, from ./mail-relevance. Empty until
   *  the thread has been scored, and empty is also the honest answer for a
   *  thread that names nothing the graph knows. */
  graphNames: string[];
  graphHits: number;
  graphSimilarity: number;
}

/**
 * Similarity at which a thread reads as being about the graph's own material.
 *
 * MEASURED, not chosen. Over 300 pending threads on production, nearest-entity
 * similarity runs: min 0.343, p25 0.469, median 0.505, p75 0.554, p90 0.602,
 * max 0.715 (2026-09-06). The first draft of this constant was 0.55 — which is
 * the p75 mark, so it would have fired on a QUARTER of the entire queue while
 * reading like a strong signal.
 *
 * 0.60 is the top decile. Note that the whole range is narrow: a note embeds
 * prose and an entity embeds a name plus a short summary, so the comparison is
 * compressed and carries far less signal than the lexical half. It is worth one
 * point of nudge and no more, and no seed rule admits on it alone.
 */
export const STRONG_SIMILARITY = 0.6;

/**
 * How much this thread looks like something worth having in the graph.
 *
 * Weighted rather than boolean, and every weight is explained on the row. The
 * signals are ordered by how much they proved to be worth on the live mailbox:
 * whether YOU replied is the strongest single indicator that a thread was a
 * conversation, and Gmail's own IMPORTANT flag is the strongest indicator that
 * arrived free — it is trained on years of what this mailbox actually reads.
 *
 * PURE.
 */
export function scoreThread(facts: MailFacts): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const add = (n: number, why: string) => {
    score += n;
    reasons.push(why);
  };

  if (facts.ownerReplied) add(4, 'you replied');
  if (facts.twoWay) add(3, 'two-way conversation');
  if (facts.gmailImportant) add(3, 'Gmail marked it important');

  // What it has to do with the graph. Weighted to sit alongside "you replied"
  // rather than above it: naming something you watch is strong evidence, but a
  // conversation you took part in is still the surest thing in the mailbox.
  //
  // The IMPORTANCE of the hit leads, not the count. Forty mentions of one
  // passing entity is a mailshot; two mentions of something on the watchlist is
  // the email this whole axis exists to find.
  if (facts.graphTopHitWeight >= 3) add(4, 'names something you watch');
  else if (facts.graphTopHitWeight === 2) add(2, 'names a well-corroborated entity');
  else if (facts.graphTopHitWeight === 1) add(1, 'names something in the graph');
  if (facts.graphEntityHits >= 3) add(2, `names ${facts.graphEntityHits} things in the graph`);
  if (facts.graphSimilarity >= STRONG_SIMILARITY) add(1, 'reads like material already in the graph');

  if (facts.emailKind === 'correspondence') add(2, 'from an ordinary address');
  else if (facts.emailKind === 'bulk') add(-3, 'bulk sender');
  else if (facts.emailKind === 'notification') add(-1, 'automated notification');

  if (facts.hasAttachments) add(1, 'has attachments');
  if (facts.bodyChars > 1500) add(1, 'substantial text');
  else if (facts.bodyChars < 200) add(-2, 'almost no text');

  if (facts.ageDays <= 30) add(1, 'recent');
  else if (facts.ageDays > 60) add(-1, 'older than two months');

  // A thread with two to five people is a working conversation. Fifty is a
  // distribution list, and its participants are an audience, not a network.
  if (facts.participantCount >= 2 && facts.participantCount <= 5) add(1, 'small group');
  else if (facts.participantCount > 20) add(-2, 'broadcast to a large list');

  return { score, reasons };
}

/** Turn a stored note into the row the queue renders. PURE. */
export function toQueueRow(note: QueueNote, now: number): QueueRow {
  const facts = factsFor(note, now);
  const { score, reasons } = scoreThread(facts);
  const meta = note.metadata ?? {};
  const threadId = typeof meta.gmailThreadId === 'string' ? meta.gmailThreadId : null;
  const observed = note.observedAt ?? note.createdAt;
  return {
    id: note.id,
    subject: note.title ?? '(no subject)',
    senderDomain: facts.senderDomain || 'unknown',
    emailKind: facts.emailKind,
    important: facts.gmailImportant,
    ownerReplied: facts.ownerReplied,
    twoWay: facts.twoWay,
    hasAttachments: facts.hasAttachments,
    messageCount: facts.messageCount,
    bodyChars: facts.bodyChars,
    observedAt: observed ? new Date(observed).toISOString() : null,
    captured: meta.structuralOnly !== true && facts.bodyChars >= 200,
    score,
    reasons,
    gmailUrl: threadId ? `https://mail.google.com/mail/u/0/#all/${threadId}` : null,
    graphNames: Array.isArray((meta.graphRelevance as { names?: unknown } | undefined)?.names)
      ? ((meta.graphRelevance as { names: unknown[] }).names.map((n) => String(n)))
      : [],
    graphHits: facts.graphEntityHits,
    graphSimilarity: facts.graphSimilarity,
  };
}

export type ClusterKind = 'sender' | 'subject';

export interface QueueCluster {
  /** Stable id for the admit-all call: `sender:linkedin.com`. */
  key: string;
  kind: ClusterKind;
  label: string;
  /** Sender domain for a sender cluster; the parent domain for a subject one. */
  domain: string;
  count: number;
  /** Threads in this cluster Gmail marked important. */
  importantCount: number;
  /** Threads the owner replied to. The number that says "look at this one". */
  repliedCount: number;
  /** Median score, so a cluster can be ordered by how promising it is. */
  score: number;
  oldest: string | null;
  newest: string | null;
  /** Up to five subjects, for the card. */
  samples: string[];
  noteIds: string[];
}

function medianOf(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 10) / 10;
}

function buildCluster(key: string, kind: ClusterKind, label: string, domain: string, rows: QueueRow[]): QueueCluster {
  const dates = rows.map((r) => r.observedAt).filter((d): d is string => !!d).sort();
  return {
    key,
    kind,
    label,
    domain,
    count: rows.length,
    importantCount: rows.filter((r) => r.important).length,
    repliedCount: rows.filter((r) => r.ownerReplied).length,
    score: medianOf(rows.map((r) => r.score)),
    oldest: dates[0] ?? null,
    newest: dates[dates.length - 1] ?? null,
    samples: rows.slice(0, 5).map((r) => r.subject),
    noteIds: rows.map((r) => r.id),
  };
}

/** A subject family needs at least this many threads to be worth offering as
 *  its own decision; below it the sender cluster already covers them. */
export const MIN_SUBJECT_CLUSTER = 3;

/**
 * Group the queue. PURE.
 *
 * Sender clusters always; subject-family clusters WITHIN a sender, but only
 * where the family is big enough to be a decision of its own. The two are
 * returned as one list rather than nested, because the question the owner is
 * answering is the same either way — "do these belong in the graph?" — and a
 * tree would make them navigate a hierarchy to answer it.
 */
export function clusterQueue(rows: QueueRow[]): QueueCluster[] {
  const byDomain = new Map<string, QueueRow[]>();
  for (const row of rows) {
    const list = byDomain.get(row.senderDomain);
    if (list) list.push(row);
    else byDomain.set(row.senderDomain, [row]);
  }

  const clusters: QueueCluster[] = [];
  for (const [domain, domainRows] of byDomain) {
    const byFamily = new Map<string, QueueRow[]>();
    for (const row of domainRows) {
      const family = subjectFamily(row.subject);
      if (!family) continue;
      const list = byFamily.get(family);
      if (list) list.push(row);
      else byFamily.set(family, [row]);
    }

    const claimed = new Set<string>();
    for (const [family, familyRows] of byFamily) {
      if (familyRows.length < MIN_SUBJECT_CLUSTER) continue;
      // A family that IS the whole sender adds nothing over the sender cluster.
      if (familyRows.length === domainRows.length) continue;
      clusters.push(
        buildCluster(`subject:${domain}:${family}`, 'subject', family, domain, familyRows),
      );
      for (const row of familyRows) claimed.add(row.id);
    }

    // The sender cluster covers everything from that sender, including threads
    // a subject cluster also claims. Deliberately overlapping: "all of
    // linkedin.com" and "the connection invitations" are both decisions the
    // owner might want, and forcing them to be disjoint would make the first
    // one mean something other than what it says.
    clusters.push(buildCluster(`sender:${domain}`, 'sender', domain, domain, domainRows));
  }

  // Biggest first — the queue drains fastest from the top, and a 300-thread
  // sender is where a single keystroke is worth the most.
  return clusters.sort((a, b) => b.count - a.count || b.score - a.score);
}

export interface MailQueue {
  pending: number;
  admitted: number;
  rejected: number;
  /** Highest-scoring pending threads, for the shortlist. */
  suggestions: QueueRow[];
  clusters: QueueCluster[];
  /** Every pending row, for the "all threads" tab. Bounded. */
  rows: QueueRow[];
  truncated: boolean;
}

/** Bounded so one enormous backlog cannot make the page a 30 MB payload. */
const MAX_ROWS = 4000;
const SUGGESTION_COUNT = 25;

/** Load and shape the whole queue. The only DB read the page needs. */
export async function loadMailQueue(now = Date.now()): Promise<MailQueue> {
  const [counts] = await db
    .select({
      pending: sql<number>`count(*) filter (where ${intelNotes.graphState} = 'pending')::int`,
      admitted: sql<number>`count(*) filter (where ${intelNotes.graphState} = 'admitted')::int`,
      rejected: sql<number>`count(*) filter (where ${intelNotes.graphState} = 'rejected')::int`,
    })
    .from(intelNotes)
    .where(eq(intelNotes.source, 'email'));

  const notes = await db
    .select({
      id: intelNotes.id,
      title: intelNotes.title,
      rawContent: intelNotes.rawContent,
      metadata: intelNotes.metadata,
      observedAt: intelNotes.observedAt,
      createdAt: intelNotes.createdAt,
      graphState: intelNotes.graphState,
    })
    .from(intelNotes)
    .where(and(eq(intelNotes.source, 'email'), eq(intelNotes.graphState, 'pending')))
    .orderBy(desc(sql`coalesce(${intelNotes.observedAt}, ${intelNotes.createdAt})`))
    .limit(MAX_ROWS + 1);

  const truncated = notes.length > MAX_ROWS;
  const rows = notes.slice(0, MAX_ROWS).map((n) => toQueueRow(n as QueueNote, now));

  return {
    pending: Number(counts?.pending) || 0,
    admitted: Number(counts?.admitted) || 0,
    rejected: Number(counts?.rejected) || 0,
    suggestions: [...rows].sort((a, b) => b.score - a.score).slice(0, SUGGESTION_COUNT),
    clusters: clusterQueue(rows),
    rows,
    truncated,
  };
}

/**
 * Embed email threads that have no vector yet — held or admitted.
 *
 * The gated sweep embeds what it captures, which leaves a gap nothing else
 * would ever close: a thread captured BEFORE the gate existed already has a
 * `contentHash`, so the sweep answers 'unchanged' and never touches it again —
 * and 418 of the first 2,781 held threads had a hash and no embedding. They
 * cluster by sender and subject perfectly well; what they drop out of is
 * `similarPending`, silently, for ever.
 *
 * Bounded per call so one request cannot walk the whole corpus, and skipped for
 * anything too short to embed usefully — a 124-character structural stub has no
 * topic to find.
 */
export async function backfillPendingEmbeddings(limit = 400): Promise<{
  scanned: number;
  embedded: number;
  failed: number;
  remaining: number;
  /** True when the run gave up early because the embedding provider is refusing
   *  on credit or credentials. Distinguishes "nothing to do" from "could not". */
  stopped: boolean;
}> {
  const out = { scanned: 0, embedded: 0, failed: 0, remaining: 0, stopped: false };
  const { embedNote } = await import('./embed');
  const { isCreditOrAuthFailure } = await import('$lib/llm/client');

  const rows = await db
    .select({ id: intelNotes.id })
    .from(intelNotes)
    .where(
      and(
        eq(intelNotes.source, 'email'),
        // Pending AND admitted, not pending alone.
        //
        // An admitted note gets its embedding from `extractIntoIntel`, where the
        // call is deliberately non-fatal — an embedding outage must not undo an
        // admission that succeeded. The consequence is that a thread admitted
        // during an outage keeps its entities and never gets a vector, and
        // filtering this backfill to `pending` meant nothing ever went back for
        // it. Six of the first twelve admissions ended up in exactly that state.
        //
        // `rejected` is excluded on purpose: refused mail is never searched and
        // never clustered, so a vector for it would be paid for and never read.
        inArray(intelNotes.graphState, ['pending', 'admitted']),
        sql`${intelNotes.embedding} IS NULL`,
        sql`length(coalesce(${intelNotes.rawContent}, '')) >= 200`,
      ),
    )
    .orderBy(desc(sql`coalesce(${intelNotes.observedAt}, ${intelNotes.createdAt})`))
    .limit(limit + 1);

  out.remaining = Math.max(0, rows.length - limit);
  for (const row of rows.slice(0, limit)) {
    out.scanned++;
    try {
      await embedNote(row.id);
      out.embedded++;
    } catch (err) {
      // A credit or credential refusal will refuse every remaining note too, so
      // carrying on means 400 futile round trips and 400 identical log lines.
      // Any OTHER failure is about this note, and the batch continues.
      if (isCreditOrAuthFailure(err)) {
        out.stopped = true;
        out.remaining += rows.slice(0, limit).length - out.scanned;
        console.warn(
          `[intel:mail-queue] embedding provider refused — stopping with ${out.embedded} done:`,
          err instanceof Error ? err.message : err,
        );
        break;
      }
      out.failed++;
      console.warn(`[intel:mail-queue] could not embed ${row.id}:`, err instanceof Error ? err.message : err);
    }
  }
  console.log(`[intel:mail-queue] embedded ${out.embedded}/${out.scanned} held threads, ${out.remaining} still to do`);
  return out;
}

/**
 * Pending threads that read like this one — the topic axis.
 *
 * One kNN query against the note embeddings the gated sweep already paid for,
 * run when the owner asks rather than for every thread up front. Subject
 * families catch the repetitive mail; this catches the case they cannot, where
 * the same subject matter arrives under a dozen different subject lines.
 */
export async function similarPending(noteId: string, limit = 40): Promise<string[]> {
  const { rows } = await db.execute(sql`
    SELECT n.id
    FROM intel_notes n
    WHERE n.id <> ${noteId}
      AND n.source = 'email'
      AND n.graph_state = 'pending'
      AND n.embedding IS NOT NULL
      AND (SELECT embedding FROM intel_notes WHERE id = ${noteId}) IS NOT NULL
      AND (n.embedding <=> (SELECT embedding FROM intel_notes WHERE id = ${noteId})) < 0.35
    ORDER BY n.embedding <=> (SELECT embedding FROM intel_notes WHERE id = ${noteId})
    LIMIT ${limit}
  `);
  return (rows as Array<Record<string, unknown>>).map((r) => String(r.id));
}

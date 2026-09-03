// src/lib/daydream/refutations.ts
//
// A claim built from the same rows as one already refuted is the same claim.
//
// ── The gap this fills ─────────────────────────────────────────────────────
//
// `adjudicate.ts` decides whether a claim is true and `rulings.ts` writes what
// it decided somewhere the ponder pack will read again. Both are model-facing,
// and both can be talked past by the simplest move available to a model that
// has been told not to say something: say it in different words.
//
// That is not hypothetical. Production ran the Canva false alarm eight times
// under eight slugs — `canva-duplicate-charge`, `canva-double-debit-aug28`,
// `canva-two-charges-same-day`, `duplicate-canva-charge-check` — and because
// `dedupeKey` is `musing:<slug>`, every rename was a brand new thought, a brand
// new row, and another xhigh review that reached the same conclusion as the six
// before it. Six refutations of one misreading.
//
// The titles differ. **The evidence does not.** Every one of those eight cited
// the same two spend rows — an invoice and a bank line that are one £13 payment
// seen from two sides. The rows are the identity of a claim in a way its
// phrasing can never be, which is the same argument `hypothesisKey` makes for a
// metric pair and `dedupeKey` makes for a place.
//
// So this is the deterministic backstop underneath the prompt: not "please do
// not raise this again" but "a candidate resting on rows already ruled on does
// not get written as new". It is arithmetic over two sets of ids, it needs no
// model, and a rename buys nothing.
//
// ── Suppressed, never dropped ──────────────────────────────────────────────
//
// The candidate still lands, with `already_refuted` as its reason, exactly like
// a sub-threshold one. `reference_daydream_review_stage` is explicit that a
// refutation is silent and not deleted, and the same has to hold for the echo
// of one: a guard whose work is invisible is a guard nobody can tell has
// misfired.

import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamThoughts } from '$lib/db/schema';
import type { EvidenceRef } from './snapshot-types';

/**
 * Evidence kinds that identify nothing.
 *
 * The pack's own aggregate cards ride in the evidence list beside real rows —
 * `features:spend7` is "evidenced spend last 7 days", and it appears under that
 * one id on every money musing ever written. Counting it as shared evidence
 * would make every money claim the same claim as every other.
 */
const GENERIC_KINDS: ReadonlySet<string> = new Set(['features']);

/** How many shared rows before two claims are the same claim. One row in
 *  common is a coincidence; a claim is rarely built on fewer than two. */
export const MIN_SHARED_REFS = 2;

/** Refutations older than this stop guarding. Matches `rulingCards`, so the
 *  prompt and the backstop go quiet on the same day. */
export const REFUTATION_WINDOW_DAYS = 120;

/**
 * The rows a claim rests on, as a comparable set.
 *
 * Pure, and separate from the query, because the thing that must not drift is
 * what counts as "the same evidence" — a set that silently started including
 * the aggregate cards would suppress the entire Money family.
 */
export function claimRefs(evidence: unknown): Set<string> {
  const out = new Set<string>();
  if (!Array.isArray(evidence)) return out;
  for (const raw of evidence) {
    const e = raw as Partial<EvidenceRef> | null;
    if (!e || typeof e.kind !== 'string' || typeof e.id !== 'string') continue;
    if (GENERIC_KINDS.has(e.kind)) continue;
    if (!e.id.trim()) continue;
    out.add(`${e.kind}:${e.id}`);
  }
  return out;
}

/**
 * Is this the claim that was already refuted, wearing a different sentence?
 *
 * Containment either way, not overlap. A new claim that adds a source to the
 * settled pair is still about the settled pair (the eighth Canva musing cited
 * both spend rows plus the email that announced them); one that drops a source
 * is a narrower reading of the same rows. What is NOT a match is two claims
 * that merely brush past each other — a shared row and a different row each is
 * a different question, and the floor of `MIN_SHARED_REFS` is what keeps it so.
 */
export function isSameClaim(candidate: Set<string>, refuted: Set<string>): boolean {
  if (refuted.size === 0 || candidate.size === 0) return false;
  let shared = 0;
  const [small, large] = candidate.size <= refuted.size ? [candidate, refuted] : [refuted, candidate];
  for (const ref of small) if (large.has(ref)) shared++;
  if (shared < MIN_SHARED_REFS) return false;
  // Containment: every row of the smaller set appears in the larger.
  return shared === small.size;
}

export interface RefutedClaim {
  id: string;
  dedupeKey: string;
  title: string;
  refs: Set<string>;
}

/**
 * The first refuted claim this candidate is an echo of, or null.
 *
 * The candidate's own `dedupeKey` is skipped: a detector re-firing on its own
 * refuted row is already handled in `persistCandidates`, which updates the
 * existing row and keeps it suppressed. This guard exists for the other case —
 * a NEW key over the same rows — and double-handling the first one would report
 * a suppression that was never in doubt.
 */
export function echoOf(
  candidate: { dedupeKey: string; evidence: unknown },
  refuted: RefutedClaim[],
): RefutedClaim | null {
  const refs = claimRefs(candidate.evidence);
  if (refs.size === 0) return null;
  for (const r of refuted) {
    if (r.dedupeKey === candidate.dedupeKey) continue;
    if (isSameClaim(refs, r.refs)) return r;
  }
  return null;
}

/**
 * Every claim a reviewer has refuted inside the window, with its rows.
 *
 * Read off `daydream_thoughts` for the same reason `listRulings` is: the
 * verdict, the claim and the evidence all already sit on that row, and the
 * memory table stores the sentence rather than the set.
 */
export async function loadRefutedClaims(limit = 60): Promise<RefutedClaim[]> {
  const since = new Date(Date.now() - REFUTATION_WINDOW_DAYS * 86_400_000);
  const rows = await db
    .select({
      id: daydreamThoughts.id,
      dedupeKey: daydreamThoughts.dedupeKey,
      title: daydreamThoughts.title,
      evidence: daydreamThoughts.evidence,
    })
    .from(daydreamThoughts)
    .where(
      and(
        eq(daydreamThoughts.reviewVerdict, 'refuted'),
        isNotNull(daydreamThoughts.reviewAt),
        sql`${daydreamThoughts.reviewAt} >= ${since}`,
      ),
    )
    .orderBy(desc(daydreamThoughts.reviewAt))
    .limit(Math.max(1, Math.min(200, limit)));

  return rows.map((r) => ({
    id: r.id,
    dedupeKey: r.dedupeKey,
    title: r.title,
    refs: claimRefs(r.evidence),
  }));
}

// ── The same claim, still LIVE ────────────────────────────────────────────
//
// The refuted guard above stops a settled claim being made again. This stops
// an UNSETTLED one being made twice: two unfiled rows on the same evidence
// were both live on the feed ("A clear window before school resumes" under
// two musing kinds), because nothing compared a candidate with anything but
// refuted rows. Same containment rule, applied to what is live.

/**
 * Trigram similarity of two titles, 0..1 (Jaccard over character trigrams
 * of the lower-cased letters and digits). In code rather than `pg_trgm` so
 * it costs one query for the live rows and no round trip per candidate, and
 * so the threshold is testable.
 */
export function titleSimilarity(a: string, b: string): number {
  const grams = (t: string): Set<string> => {
    const clean = ` ${t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
    const out = new Set<string>();
    for (let i = 0; i + 3 <= clean.length; i++) out.add(clean.slice(i, i + 3));
    return out;
  };
  const ga = grams(a);
  const gb = grams(b);
  if (ga.size === 0 || gb.size === 0) return 0;
  let shared = 0;
  for (const g of ga) if (gb.has(g)) shared++;
  return shared / (ga.size + gb.size - shared);
}

/** Two musings whose titles read as one claim. 0.6 is where "A clear window
 *  before school resumes" and "A clear window before the school term" meet
 *  and "A clear window" and "A clear diary" do not. */
export const TITLE_ECHO_SIMILARITY = 0.6;
export const TITLE_ECHO_WINDOW_DAYS = 7;
export const LIVE_CLAIM_WINDOW_DAYS = 30;

export interface LiveClaim {
  id: string;
  dedupeKey: string;
  kind: string;
  title: string;
  score: number;
  status: string;
  createdAt: Date;
  refs: Set<string>;
}

/**
 * The live row this candidate would duplicate, or null.
 *
 * Two tests, in order: the evidence containment the refuted guard uses, and —
 * for a candidate in the same family within a week — a title that reads as
 * the same claim. The second exists because a money musing resting on
 * aggregates plus one row falls under `MIN_SHARED_REFS` and would otherwise
 * be a fresh card every time the model re-slugged it.
 */
export function liveEchoOf(
  candidate: { dedupeKey: string; kind: string; title: string; evidence: unknown },
  live: LiveClaim[],
  familyOf: (kind: string) => string,
  now = new Date(),
): LiveClaim | null {
  const refs = claimRefs(candidate.evidence);
  const fam = familyOf(candidate.kind);
  const weekAgo = now.getTime() - TITLE_ECHO_WINDOW_DAYS * 86_400_000;
  for (const r of live) {
    if (r.dedupeKey === candidate.dedupeKey) continue;
    if (refs.size && isSameClaim(refs, r.refs)) return r;
  }
  for (const r of live) {
    if (r.dedupeKey === candidate.dedupeKey) continue;
    if (familyOf(r.kind) !== fam) continue;
    if (r.createdAt.getTime() < weekAgo) continue;
    if (titleSimilarity(candidate.title, r.title) >= TITLE_ECHO_SIMILARITY) return r;
  }
  return null;
}

/** Every unfiled row inside the window, with its rows. */
export async function loadLiveClaims(limit = 300): Promise<LiveClaim[]> {
  const since = new Date(Date.now() - LIVE_CLAIM_WINDOW_DAYS * 86_400_000);
  const rows = await db
    .select({
      id: daydreamThoughts.id,
      dedupeKey: daydreamThoughts.dedupeKey,
      kind: daydreamThoughts.kind,
      title: daydreamThoughts.title,
      score: daydreamThoughts.score,
      status: daydreamThoughts.status,
      evidence: daydreamThoughts.evidence,
      createdAt: daydreamThoughts.createdAt,
    })
    .from(daydreamThoughts)
    .where(
      and(
        inArray(daydreamThoughts.status, ['new', 'delivered', 'seen', 'suppressed']),
        sql`${daydreamThoughts.createdAt} >= ${since}`,
        // A row already refuted is the OTHER guard's business.
        sql`coalesce(${daydreamThoughts.reviewVerdict}, '') <> 'refuted'`,
      ),
    )
    .orderBy(desc(daydreamThoughts.createdAt))
    .limit(Math.max(1, Math.min(1000, limit)));
  return rows.map((r) => ({
    id: r.id,
    dedupeKey: r.dedupeKey,
    kind: r.kind,
    title: r.title,
    score: r.score,
    status: r.status,
    createdAt: r.createdAt,
    refs: claimRefs(r.evidence),
  }));
}

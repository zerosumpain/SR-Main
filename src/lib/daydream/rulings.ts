// src/lib/daydream/rulings.ts
//
// What the reviewer learned, written somewhere it will be read again.
//
// ── The gap this fills ─────────────────────────────────────────────────────
//
// `adjudicate.ts` already answers the hard question — is the claim actually
// true — and writes its verdict to `review_verdict`. That stopped a wrong thing
// being SENT. It did nothing at all to stop the same wrong thing being THOUGHT
// again tomorrow: the detector fires on the same two rows, the reviewer spends
// another xhigh pass discovering the same thing, and the ledger accumulates
// forty refutations of one misreading.
//
// The owner's words: "I don't expect it to say there's been 2 charges for Canva
// any more, now it knows and has realised they're the same thing." Knowing, in
// this codebase, means a `jkai_memories` row — the store `snapshot.ts` sweeps
// and every other part of jkai already reads. `notes.ts` settled this argument
// once for something the owner typed; this is the same argument for something
// the reviewer concluded.
//
// ── Why the caller writes it, and not the model ────────────────────────────
//
// `adjudicate.ts` rule 2 is that the reviewer decides and never acts — it
// returns a verdict, a likelihood and prose, and can reach nothing with a side
// effect. That rule is load-bearing: the reviewer is the ONE stage in daydream
// deliberately allowed to read text other people wrote (an invoice, an email),
// so a merchant who wanted to could write something designed to argue with it.
// Its blast radius has to stay "one wrong verdict on one thought".
//
// So the memory is composed HERE, deterministically, out of fields the reviewer
// already returned. The model does not choose to write a memory, does not
// choose what it says, and cannot write one about anything other than the claim
// it was handed. A poisoned invoice can still produce a wrong verdict; it
// cannot produce a memory of its own devising.
//
// ── Every verdict is recorded, not just the refutations ────────────────────
//
// A memory of only the mistakes teaches the engine to be timid — the pack would
// read as a list of things it got wrong with nothing it got right beside them.
// `verified` and `uncertain` are recorded in the same shape and the same
// vocabulary, and the phrasing carries the verdict rather than burying it.

import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamThoughts, jkaiMemories } from '$lib/db/schema';

export type RulingVerdict = 'verified' | 'refuted' | 'uncertain';

/** Long enough for the claim plus two sentences of reasoning. */
export const MAX_RULING_CHARS = 900;

export interface RulingInput {
  kind: string;
  title: string;
  verdict: RulingVerdict;
  likelihood: number | null;
  reasoning: string;
  sources: string[];
}

/**
 * The memory's text.
 *
 * Pure, so the wording is testable without a database. Three requirements it
 * has to meet at once, because this string is read months later with none of
 * its context:
 *
 *   - it QUOTES the claim, or "one payment seen twice" is unintelligible;
 *   - it says plainly which way the ruling went, in words rather than a slug,
 *     because the pack is prose and a bare `refuted` reads as a category;
 *   - it says what was actually checked, so a confident line resting on nothing
 *     is visible as such — the same discipline `validate` applies upstream.
 */
export function rulingContent(r: RulingInput): string {
  const outcome =
    r.verdict === 'verified'
      ? 'Checked, and it holds up'
      : r.verdict === 'refuted'
        ? 'Checked, and it does NOT hold — do not raise this again'
        : 'Checked, and the sources could not settle it';

  const parts = [`On the daydream claim “${r.title}” (${r.kind}): ${outcome}.`];
  if (r.reasoning.trim()) parts.push(r.reasoning.trim());
  if (typeof r.likelihood === 'number' && Number.isFinite(r.likelihood)) {
    parts.push(`Probability the claim is true: ${Math.round(r.likelihood * 100)}%.`);
  }
  const sources = r.sources.filter((s) => s.trim()).slice(0, 6);
  parts.push(sources.length ? `Checked: ${sources.join('; ')}.` : 'Nothing external was read.');
  return parts.join(' ').slice(0, MAX_RULING_CHARS);
}

export interface RulingResult {
  memoryId: string;
  content: string;
}

/**
 * Record a ruling as a memory and link it to the thought.
 *
 * Re-ruling supersedes rather than contradicting: the `supersededBy` chain the
 * table already has, used exactly as `addNote` and `confirmPlace` use it, so
 * the snapshot sweep (which filters on `supersededBy is null`) reads one
 * current ruling per thought and never two opposite ones.
 */
export async function recordRulingMemory(
  thoughtId: string,
  r: RulingInput,
): Promise<RulingResult> {
  const [thought] = await db
    .select({ id: daydreamThoughts.id, reviewMemoryId: daydreamThoughts.reviewMemoryId })
    .from(daydreamThoughts)
    .where(eq(daydreamThoughts.id, thoughtId))
    .limit(1);
  if (!thought) throw new Error(`no such thought: ${thoughtId}`);

  const content = rulingContent(r);

  const [memory] = await db
    .insert(jkaiMemories)
    .values({
      category: 'situations',
      content,
      // A ruling the reviewer could not settle is not a high-confidence fact
      // about the world, and marking it as one would let an "I could not tell"
      // outrank a thing that was actually checked.
      confidence: r.verdict === 'uncertain' ? 'medium' : 'high',
    })
    .returning({ id: jkaiMemories.id });

  if (thought.reviewMemoryId) {
    await db
      .update(jkaiMemories)
      .set({ supersededBy: memory.id, updatedAt: new Date() })
      .where(eq(jkaiMemories.id, thought.reviewMemoryId));
  }

  await db
    .update(daydreamThoughts)
    .set({ reviewMemoryId: memory.id, updatedAt: new Date() })
    .where(eq(daydreamThoughts.id, thoughtId));

  return { memoryId: memory.id, content };
}

export interface RulingRow {
  id: string;
  kind: string;
  title: string;
  verdict: string | null;
  likelihood: number | null;
  reasoning: string | null;
  sources: string[];
  model: string | null;
  memoryId: string | null;
  ruledAt: string | null;
}

/**
 * The rulings, newest first — "that list of memories should be accessible
 * somewhere".
 *
 * Read off `daydream_thoughts` rather than off `jkai_memories`, because the row
 * is where the claim, the verdict, the likelihood and the link back to the card
 * all already sit; querying the memory table would mean parsing the sentence
 * this module just assembled to get them back. The memory id rides along so the
 * page can say the ruling really is in the store the engine reads.
 */
export async function listRulings(limit = 50): Promise<RulingRow[]> {
  const rows = await db
    .select({
      id: daydreamThoughts.id,
      kind: daydreamThoughts.kind,
      title: daydreamThoughts.title,
      verdict: daydreamThoughts.reviewVerdict,
      likelihood: daydreamThoughts.reviewLikelihood,
      reasoning: daydreamThoughts.reviewReasoning,
      sources: daydreamThoughts.reviewSources,
      model: daydreamThoughts.reviewModel,
      memoryId: daydreamThoughts.reviewMemoryId,
      ruledAt: daydreamThoughts.reviewAt,
    })
    .from(daydreamThoughts)
    .where(isNotNull(daydreamThoughts.reviewAt))
    .orderBy(desc(daydreamThoughts.reviewAt))
    .limit(Math.max(1, Math.min(200, limit)));

  return rows.map((r) => ({
    ...r,
    sources: (r.sources ?? []) as string[],
    ruledAt: r.ruledAt ? r.ruledAt.toISOString() : null,
  }));
}

/**
 * Rulings as pack cards, for the ponder cycle.
 *
 * This is the half that makes the loop close. A memory sitting in the table is
 * only read by the snapshot's 200-row sweep, which has no ordering guarantee —
 * the same reason `noteCards` exists rather than trusting that sweep. A
 * refutation of the exact claim the engine is about to make again is the most
 * valuable card in the pack and must not be competing for a slot with a
 * two-year-old note about coffee.
 *
 * Refutations first, deliberately: they are the ones that change what gets
 * said. A confirmation only tells the engine to carry on.
 */
export async function rulingCards(limit = 12, withinDays = 120) {
  const since = new Date(Date.now() - withinDays * 86_400_000);
  const rows = await db
    .select({
      id: daydreamThoughts.id,
      title: daydreamThoughts.title,
      verdict: daydreamThoughts.reviewVerdict,
      reasoning: daydreamThoughts.reviewReasoning,
    })
    .from(daydreamThoughts)
    .where(
      and(
        isNotNull(daydreamThoughts.reviewMemoryId),
        sql`${daydreamThoughts.reviewAt} >= ${since}`,
      ),
    )
    .orderBy(
      sql`case when ${daydreamThoughts.reviewVerdict} = 'refuted' then 0 else 1 end`,
      desc(daydreamThoughts.reviewAt),
    )
    .limit(limit);
  return rows;
}

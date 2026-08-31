// src/lib/daydream/weave.ts
//
// The return leg: a thought the owner called useful becomes graph.
//
// ── Why this is a separate module from intel-bridge.ts ─────────────────────
//
// `intel-bridge.ts` carries findings from the knowledge graph INTO daydream as
// candidates. This carries endorsed thoughts back OUT. They look symmetrical
// and they are not, because their trust models are opposite:
//
//   bridge  — an insight is a PROPOSAL. It clears scoring, threshold, mute,
//             cooldown and delivery before anyone sees it, because "interesting
//             about the graph" is not yet "worth interrupting anyone about".
//   weave   — a thought is an ENDORSEMENT. The owner has read it and said it
//             was useful, which is the strongest admission signal this codebase
//             has. It goes straight in.
//
// Putting both in one module would mean one place deciding two questions with
// one set of rules, and the rule that is right for a proposal is exactly wrong
// for an endorsement.
//
// ── What it actually does ──────────────────────────────────────────────────
//
// Nothing new. `extractIntoIntel` has grown the graph from files, research
// sessions and chat threads for months — extract → persist → embed, idempotent
// per (kind, refId, contentHash), one derived note per source item. This adds a
// fourth `AutoKind` and builds the text. That is the whole of it, and it is the
// point: a second extraction pipeline for daydream would be a second place to
// forget the graph gate.

import { eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { db } from '$lib/db';
import { daydreamThoughts } from '$lib/db/schema';
import { MIN_EXTRACT_CHARS, extractIntoIntel } from '$lib/jkai/intel/auto-extract';
import { resolveEvidence } from './evidence';
import { errMsg } from './types';

export interface WeavableThought {
  id: string;
  kind: string;
  title: string;
  explanation: string;
  narrative: string | null;
  note: string | null;
  reviewVerdict: string | null;
  reviewReasoning: string | null;
  evidence: Array<{ kind: string; id: string; note?: string }> | null;
}

/**
 * The text the extractor reads.
 *
 * Assembled rather than concatenated, and in this order for a reason. The
 * extractor's job is to find entities and relationships, and it does that best
 * from prose that names things: the narrative and the owner's own note carry
 * proper nouns, the components bag carries none. So the numbers stay out and
 * the sentences go in.
 *
 * `evidenceLines` is where the names usually live — a merchant, a place, a
 * correspondent — which is why an empty evidence list is the commonest reason a
 * thought is too thin to weave.
 */
export function weaveText(t: WeavableThought, evidenceLines: string[]): string {
  const parts = [
    `${t.title}`,
    '',
    t.explanation,
    t.narrative ? `\n${t.narrative}` : '',
    t.note ? `\nJohn said: ${t.note}` : '',
    t.reviewVerdict && t.reviewReasoning
      ? `\nA reviewer checked this and found it ${t.reviewVerdict}: ${t.reviewReasoning}`
      : '',
    evidenceLines.length ? `\nWhat it rests on:\n${evidenceLines.join('\n')}` : '',
  ];
  return parts.filter((p) => p !== '').join('\n').trim();
}

/** Idempotency key. Changes when the text changes, so re-voting an unchanged
 *  thought costs no model call — the same gate the file path uses. */
export function weaveHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 32);
}

export type WeaveOutcome =
  | { status: 'woven'; noteId: string; entityCount: number }
  | { status: 'unchanged'; noteId: string }
  | { status: 'too-thin'; chars: number }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; error: string };

/**
 * Weave one thought into the graph.
 *
 * NEVER throws. This runs behind a vote, and a graph that is busy, disabled or
 * mid-migration must not cost the owner his verdict — the vote is the thing the
 * whole learning loop is starved of. Every failure comes back as a status the
 * caller can report and the page can print.
 */
export async function weaveThought(thoughtId: string): Promise<WeaveOutcome> {
  try {
    const [row] = await db
      .select({
        id: daydreamThoughts.id,
        kind: daydreamThoughts.kind,
        title: daydreamThoughts.title,
        explanation: daydreamThoughts.explanation,
        narrative: daydreamThoughts.narrative,
        note: daydreamThoughts.note,
        reviewVerdict: daydreamThoughts.reviewVerdict,
        reviewReasoning: daydreamThoughts.reviewReasoning,
        evidence: daydreamThoughts.evidence,
      })
      .from(daydreamThoughts)
      .where(eq(daydreamThoughts.id, thoughtId))
      .limit(1);
    if (!row) return { status: 'skipped', reason: `no such thought: ${thoughtId}` };

    // The evidence, resolved to what it actually points at — the same call the
    // reviewer makes, for the same reason: the refs are ids, and the names the
    // graph wants are in the rows behind them.
    let evidenceLines: string[] = [];
    try {
      const resolved = await resolveEvidence(row.evidence ?? []);
      evidenceLines = resolved
        .filter((r) => !r.missing)
        .map((r) => `- ${r.title}: ${r.lines.join(' ')}`.slice(0, 400));
    } catch {
      // A weave without evidence lines is thinner, not wrong.
      evidenceLines = [];
    }

    const text = weaveText(row as WeavableThought, evidenceLines);
    if (text.length < MIN_EXTRACT_CHARS) return { status: 'too-thin', chars: text.length };

    const outcome = await extractIntoIntel({
      kind: 'daydream',
      refId: row.id,
      title: row.title.slice(0, 200),
      text,
      contentHash: weaveHash(text),
      source: 'daydream',
      metadata: { daydreamKind: row.kind, daydreamThoughtId: row.id },
    });

    if (outcome.status === 'extracted') {
      await db
        .update(daydreamThoughts)
        .set({ intelNoteId: outcome.noteId, intelWovenAt: new Date(), updatedAt: new Date() })
        .where(eq(daydreamThoughts.id, thoughtId));
      return { status: 'woven', noteId: outcome.noteId, entityCount: outcome.entityCount };
    }
    if (outcome.status === 'unchanged' && outcome.noteId) {
      // Already in the graph and unchanged. Still worth recording the link, in
      // case the column was added after the note was.
      await db
        .update(daydreamThoughts)
        .set({ intelNoteId: outcome.noteId, updatedAt: new Date() })
        .where(eq(daydreamThoughts.id, thoughtId));
      return { status: 'unchanged', noteId: outcome.noteId };
    }
    if (outcome.status === 'too-short') return { status: 'too-thin', chars: text.length };
    return { status: 'skipped', reason: outcome.status };
  } catch (err) {
    return { status: 'failed', error: errMsg(err).slice(0, 300) };
  }
}

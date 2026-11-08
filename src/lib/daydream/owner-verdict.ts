// src/lib/daydream/owner-verdict.ts
//
// The owner telling a note it is wrong, and why — or that a "wrong" was itself
// wrong. His words are the lesson, verbatim: he is the authority on his own
// life, and a model paraphrase of a correction is a second chance to get it
// wrong (`profile.ts` makes the same call for his notes).
//
// Deliberately separate from feedback. "Not for me" says he does not want this
// KIND of note; "wrong" says this note's CLAIM is false. A wrong money note is
// still the kind he wants — the next one just has to be right.

import { sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { OWNER_REVIEWER } from './lessons';
import { recordRuling } from './rulings.server';

export type OwnerVerdict = 'wrong' | 'right';
export const MAX_WHY_CHARS = 1000;

export function parseOwnerVerdict(body: unknown):
  | { ok: true; thoughtId: string; verdict: OwnerVerdict; why: string }
  | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Body must be a JSON object' };
  const b = body as Record<string, unknown>;
  const thoughtId = typeof b.thoughtId === 'string' ? b.thoughtId.trim() : typeof b.id === 'string' ? b.id.trim() : '';
  if (!thoughtId || thoughtId.length > 200) return { ok: false, error: 'thoughtId is required' };
  const verdict = b.verdict === 'wrong' || b.verdict === 'right' ? b.verdict : null;
  if (!verdict) return { ok: false, error: 'verdict must be wrong or right' };
  const why = typeof b.why === 'string' ? b.why.replace(/\s+/g, ' ').trim().slice(0, MAX_WHY_CHARS) : '';
  // The reason is the whole value of a "wrong": without it there is nothing
  // to learn, only a down-vote.
  if (verdict === 'wrong' && why.length < 3) return { ok: false, error: 'Say why it is wrong — that is what it learns from.' };
  return { ok: true, thoughtId, verdict, why };
}

export async function recordOwnerVerdict(thoughtId: string, verdict: OwnerVerdict, why: string) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`daydream-ruling:${thoughtId}`}))`);
    return recordRuling(tx, {
      thoughtId,
      verdict: verdict === 'wrong' ? 'refuted' : 'verified',
      likelihood: verdict === 'wrong' ? 0.02 : 0.95,
      reasoning: why || (verdict === 'right' ? 'He confirmed it.' : ''),
      lesson: verdict === 'wrong' ? why : null,
      reviewer: OWNER_REVIEWER,
    });
  });
}

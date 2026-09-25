// src/lib/daydream/think/profile.ts (was ponder/profile.ts)
//
// "Your shadow" — the behaviour profile that rides in the think prompt so
// the model muses like John's second brain rather than a generic assistant.
//
// Deliberately DETERMINISTIC in v1: assembled from the feedback ledger, his
// recent asks, and his confirmed memories by code, never by a model. A
// model-written self-portrait would be a second fabrication surface sitting
// upstream of the thing the citation audit protects; a code-built one is just
// a query. If a distilled prose profile ever earns its place, it goes through
// the same propose-as-data → owner-approves gate as everything else.

import { desc, eq, gte, and, notIlike, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamThoughts, orchestratorChats } from '$lib/db/schema';
import { loadFeedback, mutedKinds } from '../thought-store';
import { tallyFeedback } from '../scoring';

export interface ProfileInputs {
  feedback: Array<{ kind: string; up: number; down: number }>;
  muted: string[];
  recentAsks: string[];
  /**
   * What he has written back, in his own words, about specific thoughts.
   *
   * Seven notes existed on production on 2026-09-17 and they are the highest
   * information in the whole database — two of them corrections to the
   * engine's model of the world ("what the calendar suggests needs to be
   * verified by the location through life360 of the family", "the hair
   * appointment flagged as today, but it's tomorrow") and one explaining a
   * health reading outright ("I had a beer last night impacting my
   * readiness").
   *
   * Every one of them became a memory card and changed nothing structural. A
   * card competes with a hundred and ninety others; a correction should bind.
   * So they ride HERE, in the profile, which is a constraint block — the same
   * move that fixed leads and refuted claims.
   */
  corrections?: string[];
}

/** Pure: inputs → prompt lines. */
export function assembleProfile(inputs: ProfileInputs): string[] {
  const lines: string[] = [];

  const rated = inputs.feedback.filter((f) => f.up + f.down > 0);
  if (rated.length) {
    const liked = rated.filter((f) => f.up > f.down).map((f) => `${f.kind} (${f.up}↑)`);
    const disliked = rated.filter((f) => f.down >= f.up && f.down > 0).map((f) => `${f.kind} (${f.down}↓)`);
    if (liked.length) lines.push(`He has found useful: ${liked.join(', ')}.`);
    if (disliked.length) lines.push(`He has NOT found useful: ${disliked.join(', ')}.`);
  } else {
    lines.push('No thought feedback yet — err towards fewer, sharper musings.');
  }
  if (inputs.muted.length) {
    lines.push(`Permanently muted kinds (never produce these themes' shapes): ${inputs.muted.join(', ')}.`);
  }
  if (inputs.recentAsks.length) {
    lines.push('What he has actually been asking about lately:');
    for (const a of inputs.recentAsks) lines.push(`  • ${a}`);
  }
  if (inputs.corrections?.length) {
    lines.push(
      'WHAT HE HAS CORRECTED, IN HIS OWN WORDS. These are standing instructions about how to read his data, not anecdotes. Where one of these applies to what you are looking at, it overrides the cards:',
    );
    for (const c of inputs.corrections) lines.push(`  • "${c}"`);
  }
  return lines;
}

/** How many recent asks ride in the prompt. */
export const RECENT_ASKS = 10;

/** How many of his corrections ride in the prompt, and how far back they
 *  count. Deliberately generous on time: a correction about how to read the
 *  calendar does not expire because a fortnight passed. */
export const CORRECTIONS_IN_PROFILE = 12;
export const CORRECTION_WINDOW_DAYS = 180;

export async function buildProfileLines(now = new Date()): Promise<string[]> {
  const [feedbackRows, muted] = await Promise.all([loadFeedback(), mutedKinds()]);
  // tallyFeedback is a global count; the profile wants it per kind.
  const byKind = new Map<string, typeof feedbackRows>();
  for (const r of feedbackRows) {
    const list = byKind.get(r.kind) ?? [];
    list.push(r);
    byKind.set(r.kind, list);
  }
  const feedback = [...byKind.entries()].map(([kind, rows]) => {
    const t = tallyFeedback(rows, now);
    return { kind, up: Math.round(t.useful), down: Math.round(t.notUseful) };
  });

  // His own words, briefly. User turns only, newest first, minus the obvious
  // machine noise; each truncated hard — this is a scent of what he cares
  // about, not a transcript.
  let recentAsks: string[] = [];
  try {
    const since = new Date(now.getTime() - 14 * 86_400_000);
    const rows = await db
      .select({ content: orchestratorChats.content })
      .from(orchestratorChats)
      .where(
        and(
          eq(orchestratorChats.role, 'user'),
          gte(orchestratorChats.createdAt, since),
          notIlike(orchestratorChats.content, '/model%'),
        ),
      )
      .orderBy(desc(orchestratorChats.createdAt))
      .limit(60);
    const seen = new Set<string>();
    for (const r of rows) {
      const line = r.content.replace(/\s+/g, ' ').trim().slice(0, 110);
      if (line.length < 8) continue; // "yes", "crack on" — throttle, not topics
      const key = line.toLowerCase().slice(0, 40);
      if (seen.has(key)) continue;
      seen.add(key);
      recentAsks.push(line);
      if (recentAsks.length >= RECENT_ASKS) break;
    }
  } catch {
    recentAsks = [];
  }

  // The corrections. Read straight off the thought rows rather than waiting
  // for the nightly consolidator: a note is a correction the moment it is
  // typed, and the consolidation path exists to make it DURABLE, not to decide
  // whether it counts.
  let corrections: string[] = [];
  try {
    const since = new Date(now.getTime() - CORRECTION_WINDOW_DAYS * 86_400_000);
    const rows = await db
      .select({ note: daydreamThoughts.note, title: daydreamThoughts.title })
      .from(daydreamThoughts)
      .where(and(sql`${daydreamThoughts.note} is not null`, gte(daydreamThoughts.noteAt, since)))
      .orderBy(desc(daydreamThoughts.noteAt))
      .limit(CORRECTIONS_IN_PROFILE * 2);
    const seen = new Set<string>();
    for (const r of rows) {
      const line = (r.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
      if (line.length < 5) continue;
      const key = line.toLowerCase().slice(0, 60);
      if (seen.has(key)) continue;
      seen.add(key);
      corrections.push(line);
      if (corrections.length >= CORRECTIONS_IN_PROFILE) break;
    }
  } catch {
    corrections = [];
  }

  return assembleProfile({ feedback, muted: [...muted], recentAsks, corrections });
}

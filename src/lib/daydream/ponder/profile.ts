// src/lib/daydream/ponder/profile.ts
//
// "Your shadow" — the behaviour profile that rides in the ponder prompt so
// the model muses like John's second brain rather than a generic assistant.
//
// Deliberately DETERMINISTIC in v1: assembled from the feedback ledger, his
// recent asks, and his confirmed memories by code, never by a model. A
// model-written self-portrait would be a second fabrication surface sitting
// upstream of the thing the citation audit protects; a code-built one is just
// a query. If a distilled prose profile ever earns its place, it goes through
// the same propose-as-data → owner-approves gate as everything else.

import { desc, eq, gte, and, notIlike } from 'drizzle-orm';
import { db } from '$lib/db';
import { orchestratorChats } from '$lib/db/schema';
import { loadFeedback, mutedKinds } from '../thought-store';
import { tallyFeedback } from '../scoring';

export interface ProfileInputs {
  feedback: Array<{ kind: string; up: number; down: number }>;
  muted: string[];
  recentAsks: string[];
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
  return lines;
}

/** How many recent asks ride in the prompt. */
export const RECENT_ASKS = 10;

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

  return assembleProfile({ feedback, muted: [...muted], recentAsks });
}

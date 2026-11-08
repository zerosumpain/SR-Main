// src/lib/daydream/rulings.server.ts
//
// Recording a verdict on a note — the double-check's or the owner's — in the
// two places it has to live:
//
//   • the thought row's `review_*` columns, which the feed shows, the
//     refutation guard reads (`refutations.ts`), and the lessons block is
//     built from (`lessons.server.ts`, `review_narrative` = the lesson);
//   • a `ruling` memory, the durable record the rest of jkai reads, written
//     only when there is something to learn: a note found wrong, or a wrong
//     verdict taken back. Re-ruling supersedes the earlier memory instead of
//     leaving two that disagree.
//
// The old reviewer's third fault (`reference_daydream_review_stage`) was a
// verdict nobody remembered: 66 rulings, 1 memory. So this is one function, and
// every caller goes through it.

import { eq } from 'drizzle-orm';
import { daydreamThoughts } from '$lib/db/schema';
import type { DbExecutor } from '$lib/db';
import { writeMemory } from '$lib/jkai/memory/service.server';
import { OWNER_REVIEWER } from './lessons';

export interface Ruling {
  thoughtId: string;
  verdict: 'verified' | 'refuted' | 'uncertain';
  likelihood: number;
  /** Why, in plain English. */
  reasoning: string;
  /** When refuted: the rule to carry forward. */
  lesson: string | null;
  /** The model id, or `OWNER_REVIEWER`. */
  reviewer: string;
  sources?: string[];
  tokens?: { prompt: number; completion: number };
}

export async function recordRuling(tx: DbExecutor, r: Ruling): Promise<{ memoryId: string | null }> {
  const [thought] = await tx
    .select({ title: daydreamThoughts.title, verdict: daydreamThoughts.reviewVerdict, memoryId: daydreamThoughts.reviewMemoryId })
    .from(daydreamThoughts)
    .where(eq(daydreamThoughts.id, r.thoughtId))
    .limit(1);
  if (!thought) throw new Error(`no such thought: ${r.thoughtId}`);

  const owner = r.reviewer === OWNER_REVIEWER;
  let content: string | null = null;
  if (r.verdict === 'refuted') {
    content = `On the daydream claim "${thought.title}": ${owner ? 'John says it is wrong' : 'a double-check found it wrong'}. ${r.reasoning}${
      r.lesson && r.lesson !== r.reasoning ? ` Lesson: ${r.lesson}` : ''
    }`;
  } else if (thought.verdict === 'refuted' && thought.memoryId) {
    // Taking back a "wrong": the old lesson must not keep steering.
    content = `On the daydream claim "${thought.title}": ${owner ? 'John says it was right after all' : 'a later double-check found it holds'}. ${r.reasoning}`;
  }

  let memoryId: string | null = thought.memoryId;
  if (content) {
    const memory = await writeMemory(
      {
        category: 'patterns',
        content: content.slice(0, 2000),
        daydreamOrigin: 'ruling',
        replacesId: thought.memoryId,
        provenance: { origin: 'daydream-ruling', sourceId: r.thoughtId, assertion: owner ? 'stated' : 'inferred' },
      },
      tx,
    );
    memoryId = memory.id;
  }

  await tx
    .update(daydreamThoughts)
    .set({
      reviewVerdict: r.verdict,
      reviewLikelihood: r.likelihood,
      reviewReasoning: r.reasoning.slice(0, 2000),
      // The lesson, read back by `loadLessons`. Cleared when not refuted so a
      // taken-back lesson stops binding the prompt at once.
      reviewNarrative: r.verdict === 'refuted' ? (r.lesson ?? r.reasoning).slice(0, 600) : null,
      reviewSources: r.sources ?? [],
      reviewModel: r.reviewer,
      reviewAt: new Date(),
      reviewPromptTokens: r.tokens?.prompt ?? 0,
      reviewCompletionTokens: r.tokens?.completion ?? 0,
      reviewMemoryId: memoryId,
      updatedAt: new Date(),
    })
    .where(eq(daydreamThoughts.id, r.thoughtId));
  return { memoryId: content ? memoryId : null };
}

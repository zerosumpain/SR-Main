// src/lib/daydream/memories.server.ts
//
// The query behind the Memory room. Split from `memories.ts` because the page
// imports that module's pure half, and anything reaching `$lib/db` from a
// component fails the BUILD (not the type-check) on
// `$env/dynamic/private` in the browser bundle.

import { desc, eq, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamPlaces, daydreamThoughts, jkaiMemories } from '$lib/db/schema';
import type { DaydreamMemory, MemoryOrigin } from './memories';

/**
 * Every live memory, newest first, with where it came from.
 *
 * `supersededBy is null` is the same filter the snapshot sweep applies, so this
 * list is exactly the population a pack draws from — a page showing superseded
 * rows would be describing memories the engine can no longer read.
 *
 * Three left joins rather than three queries: the tables are small, the links
 * are indexed primary keys, and one round trip keeps this off the critical path
 * of a page load that already runs sixteen reads in parallel.
 */
export async function listDaydreamMemories(limit = 200): Promise<DaydreamMemory[]> {
  const rows = await db
    .select({
      id: jkaiMemories.id,
      category: jkaiMemories.category,
      content: jkaiMemories.content,
      confidence: jkaiMemories.confidence,
      createdAt: jkaiMemories.createdAt,
      sourceConversationId: jkaiMemories.sourceConversationId,
      ruledId: daydreamThoughts.id,
      ruledTitle: daydreamThoughts.title,
      ruledKind: daydreamThoughts.kind,
      verdict: daydreamThoughts.reviewVerdict,
      likelihood: daydreamThoughts.reviewLikelihood,
      reviewMemoryId: daydreamThoughts.reviewMemoryId,
      noteMemoryId: daydreamThoughts.noteMemoryId,
      // The JOIN's own key, not the label. A place is detected by the join
      // having MATCHED; testing `label != null` instead reads an unnamed place
      // as "from a conversation", which is wrong even though `confirmPlace`
      // always sets a label — the row is the fact, the label is a field on it.
      placeId: daydreamPlaces.id,
      placeLabel: daydreamPlaces.label,
    })
    .from(jkaiMemories)
    .leftJoin(
      daydreamThoughts,
      sql`${daydreamThoughts.reviewMemoryId} = ${jkaiMemories.id} or ${daydreamThoughts.noteMemoryId} = ${jkaiMemories.id}`,
    )
    .leftJoin(daydreamPlaces, eq(daydreamPlaces.memoryId, jkaiMemories.id))
    .where(sql`${jkaiMemories.supersededBy} is null`)
    .orderBy(desc(jkaiMemories.createdAt))
    .limit(Math.max(1, Math.min(500, limit)));

  return rows.map((r) => {
    // Order matters: a row can only be one of these, and the link that
    // MATCHED is what says which. A thought carries both a review memory and a
    // note memory, so testing the column rather than the join is the only way
    // to tell a ruling from a note on the same card.
    const origin: MemoryOrigin =
      r.reviewMemoryId === r.id
        ? 'ruling'
        : r.noteMemoryId === r.id
          ? 'note'
          : r.placeId != null
            ? 'place'
            : 'elsewhere';
    return {
      id: r.id,
      category: r.category,
      content: r.content,
      confidence: r.confidence,
      createdAt: r.createdAt.toISOString(),
      origin,
      thoughtId: origin === 'ruling' || origin === 'note' ? r.ruledId : null,
      thoughtTitle: origin === 'ruling' || origin === 'note' ? r.ruledTitle : null,
      thoughtKind: origin === 'ruling' || origin === 'note' ? r.ruledKind : null,
      verdict: origin === 'ruling' ? r.verdict : null,
      likelihood: origin === 'ruling' ? r.likelihood : null,
      placeLabel: origin === 'place' ? r.placeLabel : null,
    };
  });
}

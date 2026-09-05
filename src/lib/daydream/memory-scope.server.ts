// src/lib/daydream/memory-scope.server.ts
//
// The shared jkai memory table is not the Daydream memory queue. Daydream may
// learn only from its own reviewer findings and from notes the owner attached
// to a Daydream thought. This module is the single admission boundary used by
// the Memory room, the snapshot, and nightly consolidation.

import { and, eq, inArray, isNotNull, isNull, like, notInArray, or, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import {
  daydreamMemoryThemes,
  daydreamMemoryThemeSources,
  daydreamThoughts,
  jkaiMemories,
} from '$lib/db/schema';

export const DAYDREAM_MEMORY_ORIGINS = ['ruling', 'note', 'place'] as const;
export type DaydreamMemoryOrigin = (typeof DAYDREAM_MEMORY_ORIGINS)[number];

/** Admit a raw row to Daydream only when a Daydream writer labelled it. */
export function isDaydreamFindingMemory() {
  return inArray(jkaiMemories.daydreamOrigin, [...DAYDREAM_MEMORY_ORIGINS]);
}

function isOutsideDaydreamMemoryScope() {
  return or(
    isNull(jkaiMemories.daydreamOrigin),
    notInArray(jkaiMemories.daydreamOrigin, [...DAYDREAM_MEMORY_ORIGINS]),
  );
}

/**
 * A theme is safe to read only when it has sources and every source was
 * admitted through the Daydream finding boundary. This immediately hides any
 * theme created by the original site-wide query, even before repair runs.
 */
export function isDaydreamFindingTheme() {
  return sql<boolean>`
    exists (
      select 1
      from ${daydreamMemoryThemeSources}
      inner join ${jkaiMemories}
        on ${jkaiMemories.id} = ${daydreamMemoryThemeSources.memoryId}
      where ${daydreamMemoryThemeSources.themeId} = ${daydreamMemoryThemes.id}
        and ${jkaiMemories.daydreamOrigin} in ('ruling', 'note', 'place')
    )
    and not exists (
      select 1
      from ${daydreamMemoryThemeSources}
      inner join ${jkaiMemories}
        on ${jkaiMemories.id} = ${daydreamMemoryThemeSources.memoryId}
      where ${daydreamMemoryThemeSources.themeId} = ${daydreamMemoryThemes.id}
        and (
          ${jkaiMemories.daydreamOrigin} is null
          or ${jkaiMemories.daydreamOrigin} not in ('ruling', 'note', 'place')
          or ${jkaiMemories.supersededBy} is not null
        )
    )
  `;
}

export interface DaydreamMemoryScopeRepair {
  originsBackfilled: number;
  themesRemoved: number;
  memoriesRequeued: number;
  foreignMarkersCleared: number;
}

/**
 * Repair data written before the Daydream-origin boundary existed.
 *
 * The deterministic prefixes cover superseded historical rows whose thought
 * now points at a newer memory. Current rows are also recovered through their
 * explicit reverse links. A contaminated theme is removed in full rather than
 * retaining prose influenced by an out-of-scope memory; its valid Daydream
 * sources are requeued so the next pass can derive a clean replacement.
 */
export async function repairDaydreamMemoryScope(): Promise<DaydreamMemoryScopeRepair> {
  const [rulings, notes] = await db.transaction(async (tx) => {
    const rulingRows = await tx
      .update(jkaiMemories)
      // Every legacy finding is re-reviewed in the now-correctly-scoped batch,
      // including one the old mixed batch marked archive-only with no theme.
      .set({ daydreamOrigin: 'ruling', consolidatedAt: null })
      .where(
        and(
          isNull(jkaiMemories.daydreamOrigin),
          or(
            like(jkaiMemories.content, 'On the daydream claim “%'),
            like(jkaiMemories.content, 'On the daydream claim "%'),
            sql`${jkaiMemories.id} in (
              select ${daydreamThoughts.reviewMemoryId}
              from ${daydreamThoughts}
              where ${daydreamThoughts.reviewMemoryId} is not null
            )`,
          ),
        ),
      )
      .returning({ id: jkaiMemories.id });

    const noteRows = await tx
      .update(jkaiMemories)
      .set({ daydreamOrigin: 'note', consolidatedAt: null })
      .where(
        and(
          isNull(jkaiMemories.daydreamOrigin),
          or(
            like(jkaiMemories.content, 'On the daydream suggestion "%'),
            sql`${jkaiMemories.id} in (
              select ${daydreamThoughts.noteMemoryId}
              from ${daydreamThoughts}
              where ${daydreamThoughts.noteMemoryId} is not null
            )`,
          ),
        ),
      )
      .returning({ id: jkaiMemories.id });

    return [rulingRows, noteRows] as const;
  });

  const contaminated = await db
    .selectDistinct({ themeId: daydreamMemoryThemeSources.themeId })
    .from(daydreamMemoryThemeSources)
    .innerJoin(jkaiMemories, eq(jkaiMemories.id, daydreamMemoryThemeSources.memoryId))
    .where(isOutsideDaydreamMemoryScope());
  const contaminatedThemeIds = contaminated.map((row) => row.themeId);

  let memoriesRequeued = 0;
  if (contaminatedThemeIds.length) {
    const validSources = await db
      .selectDistinct({ memoryId: daydreamMemoryThemeSources.memoryId })
      .from(daydreamMemoryThemeSources)
      .innerJoin(jkaiMemories, eq(jkaiMemories.id, daydreamMemoryThemeSources.memoryId))
      .where(
        and(
          inArray(daydreamMemoryThemeSources.themeId, contaminatedThemeIds),
          isDaydreamFindingMemory(),
          isNotNull(jkaiMemories.consolidatedAt),
        ),
      );
    const validMemoryIds = validSources.map((row) => row.memoryId);

    await db.transaction(async (tx) => {
      await tx.delete(daydreamMemoryThemes).where(inArray(daydreamMemoryThemes.id, contaminatedThemeIds));
      if (validMemoryIds.length) {
        const requeued = await tx
          .update(jkaiMemories)
          .set({ consolidatedAt: null })
          .where(inArray(jkaiMemories.id, validMemoryIds))
          .returning({ id: jkaiMemories.id });
        memoriesRequeued = requeued.length;
      }
    });
  }

  // `consolidatedAt` was introduced for Daydream but the original query marked
  // unrelated shared memories too. Clear those foreign markers; scoped reads
  // ensure they are not picked up again.
  const cleared = await db
    .update(jkaiMemories)
    .set({ consolidatedAt: null })
    .where(and(isNotNull(jkaiMemories.consolidatedAt), isOutsideDaydreamMemoryScope()))
    .returning({ id: jkaiMemories.id });

  return {
    originsBackfilled: rulings.length + notes.length,
    themesRemoved: contaminatedThemeIds.length,
    memoriesRequeued,
    foreignMarkersCleared: cleared.length,
  };
}

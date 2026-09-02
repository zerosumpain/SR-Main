// src/lib/daydream/memories.server.ts
//
// The query behind the Memory room. Split from `memories.ts` because the page
// imports that module's pure half, and anything reaching `$lib/db` from a
// component fails the BUILD (not the type-check) on
// `$env/dynamic/private` in the browser bundle.

import { desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import {
  daydreamMemoryConsolidations,
  daydreamMemoryThemes,
  daydreamMemoryThemeSources,
  daydreamPlaces,
  daydreamThoughts,
  jkaiMemories,
} from '$lib/db/schema';
import type {
  DaydreamMemory,
  DaydreamMemoryThemeView,
  MemoryConsolidationView,
  MemoryOrigin,
} from './memories';

/**
 * Every live memory, newest first, with where it came from.
 *
 * `supersededBy is null` is the same liveness filter used by consolidation and
 * the snapshot. The page includes consolidated rows for provenance; only the
 * small unconsolidated subset can temporarily enter a reasoning pack.
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
      consolidatedAt: jkaiMemories.consolidatedAt,
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

  const memoryIds = rows.map((r) => r.id);
  const links = memoryIds.length
    ? await db
        .select({
          memoryId: daydreamMemoryThemeSources.memoryId,
          themeId: daydreamMemoryThemeSources.themeId,
        })
        .from(daydreamMemoryThemeSources)
        .where(inArray(daydreamMemoryThemeSources.memoryId, memoryIds))
    : [];
  const themeIdsByMemory = new Map<string, string[]>();
  for (const link of links) {
    themeIdsByMemory.set(link.memoryId, [...(themeIdsByMemory.get(link.memoryId) ?? []), link.themeId]);
  }

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
      consolidatedAt: r.consolidatedAt?.toISOString() ?? null,
      themeIds: themeIdsByMemory.get(r.id) ?? [],
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

/** Active roll-ups, their raw sources, and the thoughts that actually cited them. */
export async function listDaydreamMemoryThemes(limit = 100): Promise<DaydreamMemoryThemeView[]> {
  const themes = await db
    .select({
      id: daydreamMemoryThemes.id,
      slug: daydreamMemoryThemes.slug,
      kind: daydreamMemoryThemes.kind,
      title: daydreamMemoryThemes.title,
      statement: daydreamMemoryThemes.statement,
      guidance: daydreamMemoryThemes.guidance,
      confidence: daydreamMemoryThemes.confidence,
      sourceCount: daydreamMemoryThemes.sourceCount,
      updatedAt: daydreamMemoryThemes.updatedAt,
    })
    .from(daydreamMemoryThemes)
    .where(eq(daydreamMemoryThemes.status, 'active'))
    .orderBy(desc(daydreamMemoryThemes.sourceCount), desc(daydreamMemoryThemes.updatedAt))
    .limit(Math.max(1, Math.min(200, limit)));
  if (themes.length === 0) return [];

  const ids = themes.map((t) => t.id);
  const [sourceLinks, thoughtRows, allMemories] = await Promise.all([
    db
      .select({
        themeId: daydreamMemoryThemeSources.themeId,
        memoryId: daydreamMemoryThemeSources.memoryId,
      })
      .from(daydreamMemoryThemeSources)
      .where(inArray(daydreamMemoryThemeSources.themeId, ids)),
    db
      .select({
        id: daydreamThoughts.id,
        title: daydreamThoughts.title,
        status: daydreamThoughts.status,
        evidence: daydreamThoughts.evidence,
        createdAt: daydreamThoughts.createdAt,
      })
      .from(daydreamThoughts)
      .where(sql`${daydreamThoughts.evidence} @> '[{"kind":"memory-theme"}]'::jsonb`)
      .orderBy(desc(daydreamThoughts.createdAt))
      .limit(500),
    // Reuse the origin recovery rather than rendering theme sources as an
    // anonymous second shape. Superseded source rows remain valuable audit
    // evidence, but listDaydreamMemories intentionally shows only live rows;
    // the direct fallback below covers one that was superseded after roll-up.
    listDaydreamMemories(500),
  ]);

  const sourceIds = [...new Set(sourceLinks.map((l) => l.memoryId))];
  const known = new Map(allMemories.map((m) => [m.id, m]));
  const missing = sourceIds.filter((id) => !known.has(id));
  if (missing.length) {
    const old = await db
      .select({
        id: jkaiMemories.id,
        category: jkaiMemories.category,
        content: jkaiMemories.content,
        confidence: jkaiMemories.confidence,
        createdAt: jkaiMemories.createdAt,
        consolidatedAt: jkaiMemories.consolidatedAt,
      })
      .from(jkaiMemories)
      .where(inArray(jkaiMemories.id, missing));
    for (const row of old) {
      known.set(row.id, {
        id: row.id,
        category: row.category,
        content: row.content,
        confidence: row.confidence,
        createdAt: row.createdAt.toISOString(),
        consolidatedAt: row.consolidatedAt?.toISOString() ?? null,
        themeIds: sourceLinks.filter((l) => l.memoryId === row.id).map((l) => l.themeId),
        origin: 'elsewhere',
        thoughtId: null,
        thoughtTitle: null,
        thoughtKind: null,
        verdict: null,
        likelihood: null,
        placeLabel: null,
      });
    }
  }

  const sourcesByTheme = new Map<string, DaydreamMemory[]>();
  for (const link of sourceLinks) {
    const memory = known.get(link.memoryId);
    if (memory) sourcesByTheme.set(link.themeId, [...(sourcesByTheme.get(link.themeId) ?? []), memory]);
  }

  const influencesByTheme = new Map<string, DaydreamMemoryThemeView['influenced']>();
  for (const thought of thoughtRows) {
    const cited = new Set(
      (thought.evidence ?? [])
        .filter((e) => e.kind === 'memory-theme' && ids.includes(e.id))
        .map((e) => e.id),
    );
    for (const themeId of cited) {
      influencesByTheme.set(themeId, [
        ...(influencesByTheme.get(themeId) ?? []),
        {
          thoughtId: thought.id,
          title: thought.title,
          status: thought.status,
          createdAt: thought.createdAt.toISOString(),
        },
      ]);
    }
  }

  return themes.map((t) => ({
    ...t,
    kind: t.kind === 'value' ? 'value' : 'lesson',
    updatedAt: t.updatedAt.toISOString(),
    sources: sourcesByTheme.get(t.id) ?? [],
    influenced: influencesByTheme.get(t.id) ?? [],
  }));
}

export async function latestMemoryConsolidation(): Promise<MemoryConsolidationView | null> {
  const [row] = await db
    .select()
    .from(daydreamMemoryConsolidations)
    .orderBy(desc(daydreamMemoryConsolidations.startedAt))
    .limit(1);
  if (!row) return null;
  return {
    localDay: row.localDay,
    status: row.status,
    model: row.model,
    memoriesReviewed: row.memoriesReviewed,
    themesCreated: row.themesCreated,
    themesUpdated: row.themesUpdated,
    memoriesLinked: row.memoriesLinked,
    memoriesIgnored: row.memoriesIgnored,
    promptTokens: row.promptTokens,
    completionTokens: row.completionTokens,
    error: row.error,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

export async function loadMemoryOverview(limit = 200) {
  const [memories, themes, lastConsolidation] = await Promise.all([
    listDaydreamMemories(limit),
    listDaydreamMemoryThemes(100),
    latestMemoryConsolidation(),
  ]);
  return { memories, themes, lastConsolidation };
}

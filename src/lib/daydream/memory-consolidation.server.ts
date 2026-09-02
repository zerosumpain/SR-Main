// src/lib/daydream/memory-consolidation.server.ts
//
// End-of-day memory consolidation: raw episodes in, durable lessons/values
// out, with a source edge for every claim the model distilled.

import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import {
  daydreamMemoryConsolidations,
  daydreamMemoryThemes,
  daydreamMemoryThemeSources,
  jkaiMemories,
} from '$lib/db/schema';
import { getLLMClient } from '$lib/llm/client';
import { resolveDaydreamModel } from './compose';
import { LOCAL_TZ, errMsg } from './types';
import {
  MAX_MEMORIES_PER_CONSOLIDATION,
  parseConsolidationPlan,
  themeSlug,
  type ExistingMemoryTheme,
  type MemoryForConsolidation,
} from './memory-consolidation';

export interface MemoryConsolidationResult {
  status: 'completed' | 'failed' | 'already_complete' | 'already_running';
  localDay: string;
  memoriesReviewed: number;
  themesCreated: number;
  themesUpdated: number;
  memoriesLinked: number;
  ignored: number;
  model: string | null;
  tokens: { prompt: number; completion: number };
  error: string | null;
}

export interface MemoryConsolidationStarted {
  localDay: string;
  startedAt: Date;
}

export interface MemoryConsolidationOptions {
  now?: Date;
  allowRepeat?: boolean;
  /**
   * Resolves an interactive caller as soon as the durable run row exists.
   * The model pass can then continue outside a browser request without racing
   * a poll against an older completed row for the same local day.
   */
  onStarted?: (run: MemoryConsolidationStarted) => void;
}

export function consolidationLocalDay(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: LOCAL_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

const SYSTEM = `You consolidate John's raw personal memories into durable principles that Daydreaming should respect in future.

Raw memories are episodes and statements. Your output is the more fundamental layer above them:
- a LESSON is a reusable expectation about context, cause, uncertainty, or what tends to matter;
- a VALUE is an explicitly demonstrated preference or principle John wants respected.

Rules:
1. Reply with ONE JSON object only: {"themes":[],"ignoredMemoryIds":[]}. No markdown.
2. Each theme is exactly {"existingThemeId":string|null,"kind":"lesson"|"value","title":string,"statement":string,"guidance":string,"confidence":"high"|"medium","sourceMemoryIds":string[]}.
3. Generalise away the incidental thought title, score, date, tool call, and review prose. Preserve the useful underlying condition. Do not merely shorten the raw sentence.
4. Do not overgeneralise one episode into "always" or a diagnosis. Use sometimes/may/likely when that is all the evidence supports.
5. A value requires an explicit preference, correction, or repeated choice by John. Do not turn a guessed preference into a value.
6. The guidance field says how a future daydream should change when the theme is relevant: what to consider, respect, avoid assuming, or connect.
7. Prefer updating an existing theme over creating a near-duplicate. Copy its id exactly into existingThemeId.
8. Every new memory id must appear in at least one sourceMemoryIds list OR ignoredMemoryIds. Ignore only ephemeral detail or a statement with no safe durable lesson. Never invent an id.
9. Fewer, broader themes are better, provided their sources genuinely support them.

Worked example:
Raw: "On the suggestion 'strong sleep did not translate into readiness': I had a beer last night impacting readiness."
Too specific: "On that readiness suggestion, John drank beer last night."
Good lesson: statement="Alcohol can lower readiness even when the preceding sleep looks strong." guidance="When sleep and readiness diverge, consider alcohol as one possible modifier without assuming it was the cause."`;

function renderInput(memories: MemoryForConsolidation[], themes: ExistingMemoryTheme[]): string {
  const existing = themes.length
    ? themes.map((t) => [
        `THEME ${t.id}`,
        `kind=${t.kind}; title=${JSON.stringify(t.title)}; confidence=${t.confidence}; sources=${t.sourceCount}`,
        `statement=${JSON.stringify(t.statement)}`,
        `guidance=${JSON.stringify(t.guidance)}`,
      ].join('\n')).join('\n\n')
    : '(none yet)';

  const raw = memories.map((m) => [
    `MEMORY ${m.id}`,
    `category=${m.category}; confidence=${m.confidence}; recorded=${m.createdAt.toISOString()}`,
    m.content.slice(0, 1_200),
  ].join('\n')).join('\n\n');

  return `EXISTING THEMES\n${existing}\n\nNEW RAW MEMORIES\n${raw}`;
}

async function pendingMemories(): Promise<MemoryForConsolidation[]> {
  return db
    .select({
      id: jkaiMemories.id,
      category: jkaiMemories.category,
      content: jkaiMemories.content,
      confidence: jkaiMemories.confidence,
      createdAt: jkaiMemories.createdAt,
    })
    .from(jkaiMemories)
    .where(and(isNull(jkaiMemories.supersededBy), isNull(jkaiMemories.consolidatedAt)))
    // Oldest first drains an initial backlog predictably; new memories cannot
    // permanently push an older one outside the bounded nightly prompt.
    .orderBy(jkaiMemories.createdAt)
    .limit(MAX_MEMORIES_PER_CONSOLIDATION);
}

async function activeThemes(): Promise<ExistingMemoryTheme[]> {
  return db
    .select({
      id: daydreamMemoryThemes.id,
      kind: daydreamMemoryThemes.kind,
      title: daydreamMemoryThemes.title,
      statement: daydreamMemoryThemes.statement,
      guidance: daydreamMemoryThemes.guidance,
      confidence: daydreamMemoryThemes.confidence,
      sourceCount: daydreamMemoryThemes.sourceCount,
    })
    .from(daydreamMemoryThemes)
    .where(eq(daydreamMemoryThemes.status, 'active'))
    .orderBy(desc(daydreamMemoryThemes.sourceCount), desc(daydreamMemoryThemes.updatedAt))
    .limit(100);
}

/** Run once per local day; failed attempts remain retryable inside the window. */
export async function runMemoryConsolidation(
  opts: MemoryConsolidationOptions = {},
): Promise<MemoryConsolidationResult> {
  const now = opts.now ?? new Date();
  const localDay = consolidationLocalDay(now);
  const empty: MemoryConsolidationResult = {
    status: 'completed',
    localDay,
    memoriesReviewed: 0,
    themesCreated: 0,
    themesUpdated: 0,
    memoriesLinked: 0,
    ignored: 0,
    model: null,
    tokens: { prompt: 0, completion: 0 },
    error: null,
  };

  const [previous] = await db
    .select({
      id: daydreamMemoryConsolidations.id,
      status: daydreamMemoryConsolidations.status,
      startedAt: daydreamMemoryConsolidations.startedAt,
    })
    .from(daydreamMemoryConsolidations)
    .where(eq(daydreamMemoryConsolidations.localDay, localDay))
    .limit(1);
  if (previous?.status === 'completed' && !opts.allowRepeat) {
    return { ...empty, status: 'already_complete' };
  }
  if (previous?.status === 'running' && now.getTime() - previous.startedAt.getTime() < 30 * 60_000) {
    return { ...empty, status: 'already_running' };
  }

  const [run] = await db
    .insert(daydreamMemoryConsolidations)
    .values({ localDay, status: 'running', startedAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: daydreamMemoryConsolidations.localDay,
      set: { status: 'running', error: null, startedAt: now, completedAt: null, updatedAt: now },
    })
    .returning({ id: daydreamMemoryConsolidations.id });

  opts.onStarted?.({ localDay, startedAt: now });

  try {
    const [memories, themes] = await Promise.all([pendingMemories(), activeThemes()]);
    if (memories.length === 0) {
      await db
        .update(daydreamMemoryConsolidations)
        .set({ status: 'completed', completedAt: now, updatedAt: now })
        .where(eq(daydreamMemoryConsolidations.id, run.id));
      return empty;
    }

    const modelContext = await resolveDaydreamModel();
    const { client, model } = await getLLMClient(modelContext);
    const response = await client.chat.completions.create({
      model,
      temperature: 0.2,
      max_tokens: 3_000,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: renderInput(memories, themes) },
      ],
    });
    const tokens = {
      prompt: response.usage?.prompt_tokens ?? 0,
      completion: response.usage?.completion_tokens ?? 0,
    };
    const raw = response.choices[0]?.message?.content ?? '';
    const plan = parseConsolidationPlan(raw, memories, themes);
    if (plan.error) throw new Error(plan.error);

    let themesCreated = 0;
    let themesUpdated = 0;
    let memoriesLinked = 0;

    await db.transaction(async (tx) => {
      const touchedThemeIds = new Set<string>();

      for (const proposed of plan.themes) {
        let themeId = proposed.existingThemeId;
        if (themeId) {
          const [updated] = await tx
            .update(daydreamMemoryThemes)
            .set({
              kind: proposed.kind,
              title: proposed.title,
              statement: proposed.statement,
              guidance: proposed.guidance,
              confidence: proposed.confidence,
              lastObservedAt: now,
              updatedAt: now,
            })
            .where(and(eq(daydreamMemoryThemes.id, themeId), eq(daydreamMemoryThemes.status, 'active')))
            .returning({ id: daydreamMemoryThemes.id });
          if (!updated) throw new Error(`existing theme disappeared before write: ${themeId}`);
          themesUpdated++;
        } else {
          const slug = themeSlug(proposed.title);
          const before = themes.find((t) => themeSlug(t.title) === slug);
          const [upserted] = await tx
            .insert(daydreamMemoryThemes)
            .values({
              slug,
              kind: proposed.kind,
              title: proposed.title,
              statement: proposed.statement,
              guidance: proposed.guidance,
              confidence: proposed.confidence,
              firstObservedAt: now,
              lastObservedAt: now,
              createdAt: now,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: daydreamMemoryThemes.slug,
              set: {
                kind: proposed.kind,
                title: proposed.title,
                statement: proposed.statement,
                guidance: proposed.guidance,
                confidence: proposed.confidence,
                status: 'active',
                lastObservedAt: now,
                updatedAt: now,
              },
            })
            .returning({ id: daydreamMemoryThemes.id });
          themeId = upserted.id;
          if (before) themesUpdated++;
          else themesCreated++;
        }

        touchedThemeIds.add(themeId);
        for (const memoryId of proposed.sourceMemoryIds) {
          const inserted = await tx
            .insert(daydreamMemoryThemeSources)
            .values({ themeId, memoryId, createdAt: now })
            .onConflictDoNothing({
              target: [daydreamMemoryThemeSources.themeId, daydreamMemoryThemeSources.memoryId],
            })
            .returning({ id: daydreamMemoryThemeSources.id });
          memoriesLinked += inserted.length;
        }
      }

      for (const themeId of touchedThemeIds) {
        const [count] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(daydreamMemoryThemeSources)
          .where(eq(daydreamMemoryThemeSources.themeId, themeId));
        await tx
          .update(daydreamMemoryThemes)
          .set({ sourceCount: count?.n ?? 0, updatedAt: now })
          .where(eq(daydreamMemoryThemes.id, themeId));
      }

      await tx
        .update(jkaiMemories)
        // Consolidation changes Daydream's read state, not the memory's
        // content. Leaving updatedAt alone prevents one nightly batch from
        // jumping 160 old raw memories to the front of general chat's shared
        // memory block.
        .set({ consolidatedAt: now })
        .where(inArray(jkaiMemories.id, memories.map((m) => m.id)));

      await tx
        .update(daydreamMemoryConsolidations)
        .set({
          status: 'completed',
          model,
          memoriesReviewed: memories.length,
          themesCreated,
          themesUpdated,
          memoriesLinked,
          memoriesIgnored: plan.ignoredMemoryIds.length,
          promptTokens: tokens.prompt,
          completionTokens: tokens.completion,
          completedAt: now,
          updatedAt: now,
        })
        .where(eq(daydreamMemoryConsolidations.id, run.id));
    });

    return {
      status: 'completed',
      localDay,
      memoriesReviewed: memories.length,
      themesCreated,
      themesUpdated,
      memoriesLinked,
      ignored: plan.ignoredMemoryIds.length,
      model,
      tokens,
      error: null,
    };
  } catch (error) {
    const message = errMsg(error);
    await db
      .update(daydreamMemoryConsolidations)
      .set({
        status: 'failed',
        model: null,
        memoriesReviewed: 0,
        themesCreated: 0,
        themesUpdated: 0,
        memoriesLinked: 0,
        memoriesIgnored: 0,
        promptTokens: 0,
        completionTokens: 0,
        error: message.slice(0, 1_000),
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(daydreamMemoryConsolidations.id, run.id));
    return { ...empty, status: 'failed', error: message };
  }
}

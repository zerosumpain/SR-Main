/**
 * The whole memory roll-up against Postgres, with the model boundary stubbed.
 *
 * Excluded from the ordinary merge gate with the other integration tests. Run:
 *   npx vitest run src/lib/daydream/memory-consolidation.integration.test.ts
 *
 * It uses a year-2099 local day and prefixed ids, then deletes only those rows.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq, inArray, like } from 'drizzle-orm';
import { db } from '$lib/db';
import {
  daydreamMemoryConsolidations,
  daydreamMemoryThemes,
  daydreamMemoryThemeSources,
  daydreamThoughts,
  jkaiMemories,
} from '$lib/db/schema';

const IDS = ['itest-dd-memory-beer', 'itest-dd-memory-review'];
const THEME_SLUG = 'itest-readiness-context';
const DAY = '2099-09-02';

vi.mock('./compose', () => ({
  resolveDaydreamModel: vi.fn(async () => ({ provider: 'openrouter', modelId: 'itest-model' })),
}));

vi.mock('$lib/llm/client', () => ({
  getLLMClient: vi.fn(async () => ({
    model: 'itest-model',
    client: {
      chat: {
        completions: {
          create: vi.fn(async () => ({
            usage: { prompt_tokens: 100, completion_tokens: 60 },
            choices: [{
              message: {
                content: JSON.stringify({
                  themes: [{
                    existingThemeId: null,
                    kind: 'lesson',
                    title: 'ITest readiness context',
                    statement: 'Alcohol can lower readiness even when the preceding sleep looks strong.',
                    guidance: 'Consider alcohol as one possible modifier when sleep and readiness diverge, without assuming causation.',
                    confidence: 'high',
                    sourceMemoryIds: IDS,
                  }],
                  ignoredMemoryIds: [],
                }),
              },
            }],
          })),
        },
      },
    },
  })),
}));

import { runMemoryConsolidation } from './memory-consolidation.server';
import { listDaydreamMemoryThemes } from './memories.server';
import { resolveEvidence } from './evidence';

let dbReady = false;

async function cleanup() {
  await db.delete(daydreamThoughts).where(like(daydreamThoughts.dedupeKey, 'itest-memory-consolidation:%'));
  const themes = await db
    .select({ id: daydreamMemoryThemes.id })
    .from(daydreamMemoryThemes)
    .where(eq(daydreamMemoryThemes.slug, THEME_SLUG));
  if (themes.length) {
    await db.delete(daydreamMemoryThemeSources).where(inArray(daydreamMemoryThemeSources.themeId, themes.map((t) => t.id)));
  }
  await db.delete(daydreamMemoryThemes).where(eq(daydreamMemoryThemes.slug, THEME_SLUG));
  await db.delete(daydreamMemoryConsolidations).where(eq(daydreamMemoryConsolidations.localDay, DAY));
  await db.delete(jkaiMemories).where(inArray(jkaiMemories.id, IDS));
}

beforeAll(async () => {
  try {
    await db.select({ id: daydreamMemoryThemes.id }).from(daydreamMemoryThemes).limit(1);
    dbReady = true;
  } catch {
    return;
  }
  await cleanup();
  await db.insert(jkaiMemories).values([
    {
      id: IDS[0],
      category: 'situations',
      content: 'I had a beer last night, which affected readiness after otherwise strong sleep.',
      confidence: 'high',
    },
    {
      id: IDS[1],
      category: 'situations',
      content: 'A detailed review could not confirm the exact readiness score from the available weekly summary.',
      confidence: 'medium',
    },
  ]);
});

afterAll(async () => {
  if (dbReady) await cleanup();
});

describe('nightly memory consolidation', () => {
  it('stores one theme, two source links, pack-ready guidance, and visible influence', async () => {
    if (!dbReady) return expect(dbReady).toBe(false);

    const result = await runMemoryConsolidation({ now: new Date('2099-09-02T21:45:00Z') });
    expect(result).toMatchObject({
      status: 'completed',
      memoriesReviewed: 2,
      themesCreated: 1,
      memoriesLinked: 2,
      ignored: 0,
    });

    const [theme] = await db
      .select()
      .from(daydreamMemoryThemes)
      .where(eq(daydreamMemoryThemes.slug, THEME_SLUG));
    expect(theme.sourceCount).toBe(2);
    expect(theme.guidance).toContain('without assuming');

    const raw = await db.select().from(jkaiMemories).where(inArray(jkaiMemories.id, IDS));
    expect(raw.every((m) => m.consolidatedAt instanceof Date)).toBe(true);

    const [audit] = await db
      .select()
      .from(daydreamMemoryConsolidations)
      .where(eq(daydreamMemoryConsolidations.localDay, DAY));
    expect(audit.memoriesIgnored).toBe(0);

    await db.insert(daydreamThoughts).values({
      kind: 'musing_health',
      title: 'ITest sleep and readiness diverged',
      explanation: 'The consolidated lesson supplied relevant context.',
      evidence: [{ kind: 'memory-theme', id: theme.id }],
      dedupeKey: 'itest-memory-consolidation:thought',
    });

    const [view] = (await listDaydreamMemoryThemes()).filter((t) => t.id === theme.id);
    expect(view.sources).toHaveLength(2);
    expect(view.influenced[0].title).toContain('sleep and readiness');

    const [evidence] = await resolveEvidence([{ kind: 'memory-theme', id: theme.id }]);
    expect(evidence.title).toContain('Lesson');
    expect(evidence.lines.some((line) => line.startsWith('Source memory'))).toBe(true);

    const second = await runMemoryConsolidation({ now: new Date('2099-09-02T22:15:00Z') });
    expect(second.status).toBe('already_complete');
  });
});

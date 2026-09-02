/**
 * The whole memory roll-up against Postgres, with the model boundary stubbed.
 *
 * Excluded from the ordinary merge gate with the other integration tests. Run:
 *   npx vitest run src/lib/daydream/memory-consolidation.integration.test.ts
 *
 * It uses a year-2099 local day and prefixed ids, then deletes only those rows.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq, inArray, isNull, like } from 'drizzle-orm';
import { db } from '$lib/db';
import {
  daydreamMemoryConsolidations,
  daydreamMemoryThemes,
  daydreamMemoryThemeSources,
  daydreamThoughts,
  jkaiMemories,
} from '$lib/db/schema';

const IDS = ['itest-dd-memory-beer', 'itest-dd-memory-review'];
const PARTIAL_IDS = ['itest-dd-memory-partial-valid', 'itest-dd-memory-partial-deferred'];
const GLOBAL_ID = 'itest-dd-memory-global-site-wide';
const THEME_SLUG = 'itest-readiness-context';
const PARTIAL_THEME_SLUG = 'itest-partial-capability';
const CONTAMINATED_THEME_SLUG = 'itest-global-contamination';
const DAY = '2099-09-02';
const PARTIAL_DAY = '2099-09-03';

vi.mock('./compose', () => ({
  resolveDaydreamModel: vi.fn(async () => ({
    provider: 'openrouter',
    modelId: 'itest-model',
  })),
}));

const mocks = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock('$lib/llm/client', () => ({
  getLLMClient: vi.fn(async () => ({
    model: 'itest-model',
    client: {
      chat: {
        completions: {
          create: mocks.create,
        },
      },
    },
  })),
}));

import { runMemoryConsolidation } from './memory-consolidation.server';
import { listDaydreamMemories, listDaydreamMemoryThemes } from './memories.server';
import { DAYDREAM_MEMORY_ORIGINS, repairDaydreamMemoryScope } from './memory-scope.server';
import { resolveEvidence } from './evidence';

let dbReady = false;
let heldMemoryIds: string[] = [];
const HELD_AT = new Date('2098-01-01T00:00:00Z');

function completion(content: unknown) {
  return {
    usage: { prompt_tokens: 100, completion_tokens: 60 },
    choices: [{ message: { content: JSON.stringify(content) } }],
  };
}

async function cleanup() {
  await db.delete(daydreamThoughts).where(like(daydreamThoughts.dedupeKey, 'itest-memory-consolidation:%'));
  const themes = await db
    .select({ id: daydreamMemoryThemes.id })
    .from(daydreamMemoryThemes)
    .where(inArray(daydreamMemoryThemes.slug, [THEME_SLUG, PARTIAL_THEME_SLUG, CONTAMINATED_THEME_SLUG]));
  if (themes.length) {
    await db.delete(daydreamMemoryThemeSources).where(
      inArray(
        daydreamMemoryThemeSources.themeId,
        themes.map((t) => t.id),
      ),
    );
  }
  await db
    .delete(daydreamMemoryThemes)
    .where(inArray(daydreamMemoryThemes.slug, [THEME_SLUG, PARTIAL_THEME_SLUG, CONTAMINATED_THEME_SLUG]));
  await db
    .delete(daydreamMemoryConsolidations)
    .where(inArray(daydreamMemoryConsolidations.localDay, [DAY, PARTIAL_DAY]));
  await db.delete(jkaiMemories).where(inArray(jkaiMemories.id, [...IDS, ...PARTIAL_IDS, GLOBAL_ID]));
}

beforeAll(async () => {
  mocks.create
    .mockReset()
    .mockResolvedValueOnce(
      completion({
        themes: [
          {
            existingThemeRef: null,
            kind: 'lesson',
            title: 'ITest readiness context',
            statement: 'Alcohol can lower readiness even when the preceding sleep looks strong.',
            guidance:
              'Consider alcohol as one possible modifier when sleep and readiness diverge, without assuming causation.',
            confidence: 'high',
            sourceMemoryRefs: ['M001', 'a6f4dcc1-2c76-400e-8fc2-9bfc24937ddc'],
          },
        ],
        ignoredMemoryRefs: ['M002'],
      }),
    )
    .mockResolvedValueOnce(
      completion({
        themes: [
          {
            existingThemeRef: null,
            kind: 'lesson',
            title: 'ITest readiness context',
            statement: 'Alcohol can lower readiness even when the preceding sleep looks strong.',
            guidance:
              'Consider alcohol as one possible modifier when sleep and readiness diverge, without assuming causation.',
            confidence: 'high',
            sourceMemoryRefs: ['M001', 'M002'],
          },
        ],
        ignoredMemoryRefs: [],
      }),
    );
  try {
    await db.select({ id: daydreamMemoryThemes.id }).from(daydreamMemoryThemes).limit(1);
    dbReady = true;
  } catch {
    return;
  }
  await cleanup();
  await repairDaydreamMemoryScope();
  const preExistingPending = await db
    .select({ id: jkaiMemories.id })
    .from(jkaiMemories)
    .where(
      and(
        isNull(jkaiMemories.consolidatedAt),
        inArray(jkaiMemories.daydreamOrigin, [...DAYDREAM_MEMORY_ORIGINS]),
      ),
    );
  heldMemoryIds = preExistingPending.map((memory) => memory.id);
  if (heldMemoryIds.length) {
    await db.update(jkaiMemories).set({ consolidatedAt: HELD_AT }).where(inArray(jkaiMemories.id, heldMemoryIds));
  }
  await db.insert(jkaiMemories).values([
    {
      id: IDS[0],
      category: 'situations',
      content: 'I had a beer last night, which affected readiness after otherwise strong sleep.',
      confidence: 'high',
      daydreamOrigin: 'note',
      consolidatedAt: new Date('2099-09-02T19:58:00Z'),
      createdAt: new Date('2099-09-02T20:00:00Z'),
    },
    {
      id: IDS[1],
      category: 'situations',
      content:
        'On the daydream claim "A strong sleep night has not translated into high readiness": Checked, and the available weekly summary could not settle the exact score.',
      confidence: 'medium',
      consolidatedAt: new Date('2099-09-02T19:58:30Z'),
      createdAt: new Date('2099-09-02T20:01:00Z'),
    },
    {
      id: GLOBAL_ID,
      category: 'preferences',
      content: 'A site-wide chat memory that must never enter Daydream consolidation.',
      confidence: 'high',
      consolidatedAt: new Date('2099-09-02T19:59:30Z'),
      createdAt: new Date('2099-09-02T19:59:00Z'),
    },
  ]);
  const [contaminated] = await db
    .insert(daydreamMemoryThemes)
    .values({
      slug: CONTAMINATED_THEME_SLUG,
      kind: 'value',
      title: 'ITest global contamination',
      statement: 'A theme incorrectly distilled from a memory elsewhere on the site.',
      guidance: 'This must be removed before it can influence a future Daydream.',
      confidence: 'high',
      sourceCount: 2,
    })
    .returning({ id: daydreamMemoryThemes.id });
  await db.insert(daydreamMemoryThemeSources).values([
    { themeId: contaminated.id, memoryId: GLOBAL_ID },
    { themeId: contaminated.id, memoryId: IDS[0] },
  ]);
});

afterAll(async () => {
  if (!dbReady) return;
  await cleanup();
  if (heldMemoryIds.length) {
    await db.update(jkaiMemories).set({ consolidatedAt: null }).where(inArray(jkaiMemories.id, heldMemoryIds));
  }
});

describe('nightly memory consolidation', () => {
  it('stores one theme, two source links, pack-ready guidance, and visible influence', async () => {
    if (!dbReady) return expect(dbReady).toBe(false);

    const started: Array<{ localDay: string; startedAt: Date }> = [];
    const result = await runMemoryConsolidation({
      now: new Date('2099-09-02T21:45:00Z'),
      onStarted: (run) => started.push(run),
    });
    expect(started).toEqual([{ localDay: DAY, startedAt: new Date('2099-09-02T21:45:00Z') }]);
    expect(result).toMatchObject({
      status: 'completed',
      memoriesReviewed: 2,
      themesCreated: 1,
      memoriesLinked: 2,
      ignored: 0,
    });
    expect(mocks.create).toHaveBeenCalledTimes(2);
    const firstPrompt = mocks.create.mock.calls[0][0].messages[1].content as string;
    expect(firstPrompt).toContain('MEMORY M001');
    expect(firstPrompt).not.toContain(IDS[0]);
    expect(firstPrompt).not.toContain(GLOBAL_ID);
    expect(firstPrompt).not.toContain('site-wide chat memory');

    const [theme] = await db.select().from(daydreamMemoryThemes).where(eq(daydreamMemoryThemes.slug, THEME_SLUG));
    expect(theme.sourceCount).toBe(2);
    expect(theme.guidance).toContain('without assuming');

    const raw = await db.select().from(jkaiMemories).where(inArray(jkaiMemories.id, IDS));
    expect(
      raw
        .map((memory) => [memory.id, memory.consolidatedAt instanceof Date] as const)
        .sort(([left], [right]) => left.localeCompare(right)),
    ).toEqual(IDS.map((id) => [id, true] as const).sort(([left], [right]) => left.localeCompare(right)));
    const [globalMemory] = await db.select().from(jkaiMemories).where(eq(jkaiMemories.id, GLOBAL_ID));
    expect(globalMemory.consolidatedAt).toBeNull();
    const badThemes = await db
      .select({ id: daydreamMemoryThemes.id })
      .from(daydreamMemoryThemes)
      .where(eq(daydreamMemoryThemes.slug, CONTAMINATED_THEME_SLUG));
    expect(badThemes).toHaveLength(0);

    const memoryRoom = await listDaydreamMemories();
    expect(memoryRoom.map((memory) => memory.id)).toEqual(expect.arrayContaining(IDS));
    expect(memoryRoom.map((memory) => memory.id)).not.toContain(GLOBAL_ID);

    const [audit] = await db
      .select()
      .from(daydreamMemoryConsolidations)
      .where(eq(daydreamMemoryConsolidations.localDay, DAY));
    expect(audit.memoriesIgnored).toBe(0);
    expect(audit.promptTokens).toBe(200);
    expect(audit.completionTokens).toBe(120);

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

    const second = await runMemoryConsolidation({
      now: new Date('2099-09-02T22:15:00Z'),
    });
    expect(second.status).toBe('already_complete');
  });

  it('commits valid partial progress and leaves unresolved memories pending', async () => {
    if (!dbReady) return expect(dbReady).toBe(false);

    await db.insert(jkaiMemories).values([
      {
        id: PARTIAL_IDS[0],
        category: 'preferences',
        content: 'Keep useful capabilities in trusted personal systems.',
        confidence: 'high',
        daydreamOrigin: 'note',
        createdAt: new Date('2099-09-03T20:00:00Z'),
      },
      {
        id: PARTIAL_IDS[1],
        category: 'situations',
        content: 'A separate detail should remain pending when the model does not account for it.',
        confidence: 'medium',
        daydreamOrigin: 'ruling',
        createdAt: new Date('2099-09-03T20:01:00Z'),
      },
    ]);
    const invalid = completion({
      themes: [
        {
          existingThemeRef: null,
          kind: 'value',
          title: 'ITest partial capability',
          statement: 'Trusted personal systems should preserve useful capabilities for their owner.',
          guidance: 'Consider why the owner relies on an established capability before removing it.',
          confidence: 'high',
          sourceMemoryRefs: ['M001', 'a6f4dcc1-2c76-400e-8fc2-9bfc24937ddc'],
        },
      ],
      ignoredMemoryRefs: [],
    });
    mocks.create.mockReset().mockResolvedValueOnce(invalid).mockResolvedValueOnce(invalid);

    const result = await runMemoryConsolidation({
      now: new Date('2099-09-03T21:45:00Z'),
    });
    expect(result).toMatchObject({
      status: 'completed',
      memoriesReviewed: 1,
      themesCreated: 1,
    });
    expect(result.error).toContain('Partial consolidation');

    const raw = await db.select().from(jkaiMemories).where(inArray(jkaiMemories.id, PARTIAL_IDS));
    expect(raw.find((memory) => memory.id === PARTIAL_IDS[0])?.consolidatedAt).toBeInstanceOf(Date);
    expect(raw.find((memory) => memory.id === PARTIAL_IDS[1])?.consolidatedAt).toBeNull();

    const [audit] = await db
      .select()
      .from(daydreamMemoryConsolidations)
      .where(eq(daydreamMemoryConsolidations.localDay, PARTIAL_DAY));
    expect(audit.status).toBe('completed');
    expect(audit.memoriesReviewed).toBe(1);
    expect(audit.error).toContain('remain pending for the next run');
  });
});

/**
 * Pair verdicts, against a real database.
 *
 * Two things here can only be checked with real rows, and both are silent when
 * wrong:
 *
 *   - The human/machine precedence. A nightly adjudication pass writes into the
 *     same table a person writes into, and if a machine verdict can overwrite a
 *     human one then the queue quietly un-decides itself every night — the same
 *     defect as the client-side dismiss this table replaces, just slower.
 *   - Repointing after a merge. Fold B into A and every "B is not C" verdict
 *     names an entity that no longer exists; the pair B|C can never be proposed
 *     again, A|C has no verdict, and the question comes back wearing a new name.
 *
 * Excluded from the merge gate (`*.integration.test.ts`). Skips cleanly with no
 * database. Run it deliberately:
 *   npx vitest run src/lib/jkai/intel/resolve/decisions.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { eq, like } from 'drizzle-orm';
import { db } from '$lib/db';
import { intelEntities, intelEntityTypes, intelMatchDecisions } from '$lib/db/schema';
import { recordDecision, loadDecisions, clearDecision, repointDecisions } from './decisions';
import { pairKeyOf } from './pair-key';

const TAG = 'itest-decisions';
let dbReady = false;
const ids = { typeId: '', a: '', b: '', c: '' };

async function cleanup() {
  const rows = await db
    .select({ id: intelEntities.id })
    .from(intelEntities)
    .where(like(intelEntities.name, `${TAG}%`));
  for (const r of rows) {
    await db.delete(intelMatchDecisions).where(eq(intelMatchDecisions.aEntityId, r.id));
    await db.delete(intelMatchDecisions).where(eq(intelMatchDecisions.bEntityId, r.id));
  }
  await db.delete(intelEntities).where(like(intelEntities.name, `${TAG}%`));
  await db.delete(intelEntityTypes).where(like(intelEntityTypes.name, `${TAG}%`));
}

beforeAll(async () => {
  try {
    await db.select({ id: intelEntities.id }).from(intelEntities).limit(1);
    dbReady = true;
  } catch {
    dbReady = false;
    return;
  }
  await cleanup();

  const [type] = await db
    .insert(intelEntityTypes)
    .values({ id: `${TAG}-type`, name: `${TAG} thing`, icon: '?', color: '#000' })
    .onConflictDoNothing()
    .returning({ id: intelEntityTypes.id });
  ids.typeId = type?.id ?? `${TAG}-type`;

  const rows = await db
    .insert(intelEntities)
    .values([
      { name: `${TAG} A`, typeId: ids.typeId },
      { name: `${TAG} B`, typeId: ids.typeId },
      { name: `${TAG} C`, typeId: ids.typeId },
    ])
    .returning({ id: intelEntities.id, name: intelEntities.name });
  ids.a = rows.find((r) => r.name.endsWith(' A'))!.id;
  ids.b = rows.find((r) => r.name.endsWith(' B'))!.id;
  ids.c = rows.find((r) => r.name.endsWith(' C'))!.id;
});

beforeEach(async () => {
  if (!dbReady) return;
  for (const [x, y] of [
    [ids.a, ids.b],
    [ids.a, ids.c],
    [ids.b, ids.c],
  ]) {
    await clearDecision(x, y);
  }
});

afterAll(async () => {
  if (dbReady) await cleanup();
});

describe('match decisions', () => {
  it('stores one row per unordered pair, whichever way it is written', async () => {
    if (!dbReady) return;
    await recordDecision({ aId: ids.a, bId: ids.b, verdict: 'different', decidedBy: 'human' });
    // The same pair the other way round is the same question.
    await recordDecision({ aId: ids.b, bId: ids.a, verdict: 'same', decidedBy: 'human' });

    const all = await loadDecisions();
    const d = all.get(pairKeyOf(ids.a, ids.b));
    expect(d?.verdict).toBe('same');
    const rows = await db
      .select()
      .from(intelMatchDecisions)
      .where(eq(intelMatchDecisions.pairKey, pairKeyOf(ids.a, ids.b)));
    expect(rows).toHaveLength(1);
  });

  it('refuses to let a machine overwrite a person', async () => {
    if (!dbReady) return;
    await recordDecision({ aId: ids.a, bId: ids.b, verdict: 'different', decidedBy: 'human' });
    await recordDecision({
      aId: ids.a,
      bId: ids.b,
      verdict: 'same',
      decidedBy: 'llm',
      rationale: 'they look alike to me',
    });

    const d = (await loadDecisions()).get(pairKeyOf(ids.a, ids.b));
    expect(d?.verdict).toBe('different');
    expect(d?.decidedBy).toBe('human');
  });

  it('lets a person overrule the machine', async () => {
    if (!dbReady) return;
    await recordDecision({ aId: ids.a, bId: ids.b, verdict: 'same', decidedBy: 'llm' });
    await recordDecision({ aId: ids.a, bId: ids.b, verdict: 'different', decidedBy: 'human' });

    const d = (await loadDecisions()).get(pairKeyOf(ids.a, ids.b));
    expect(d?.verdict).toBe('different');
    expect(d?.decidedBy).toBe('human');
  });

  it('moves a verdict onto the survivor when the other side is merged away', async () => {
    if (!dbReady) return;
    // "B is not C". Then B is folded into A.
    await recordDecision({ aId: ids.b, bId: ids.c, verdict: 'different', decidedBy: 'human' });
    const moved = await repointDecisions(ids.a, ids.b);
    expect(moved).toBe(1);

    const all = await loadDecisions();
    expect(all.get(pairKeyOf(ids.b, ids.c))).toBeUndefined();
    expect(all.get(pairKeyOf(ids.a, ids.c))?.verdict).toBe('different');
  });

  it('drops a verdict that would collapse onto itself', async () => {
    if (!dbReady) return;
    // "A is not B", then B is merged INTO A. "A is not A" says nothing.
    await recordDecision({ aId: ids.a, bId: ids.b, verdict: 'different', decidedBy: 'human' });
    await repointDecisions(ids.a, ids.b);
    expect((await loadDecisions()).get(pairKeyOf(ids.a, ids.b))).toBeUndefined();
  });

  it('drops a rewrite that contradicts a verdict already on the target pair', async () => {
    if (!dbReady) return;
    // A~C is answered one way and B~C the other. Merge B into A and the two
    // answers land on one pair; asking again is the only honest resolution.
    await recordDecision({ aId: ids.a, bId: ids.c, verdict: 'same', decidedBy: 'human' });
    await recordDecision({ aId: ids.b, bId: ids.c, verdict: 'different', decidedBy: 'human' });
    const moved = await repointDecisions(ids.a, ids.b);
    expect(moved).toBe(0);

    const all = await loadDecisions();
    expect(all.get(pairKeyOf(ids.b, ids.c))).toBeUndefined();
    // The pre-existing verdict on A~C is left exactly as it was.
    expect(all.get(pairKeyOf(ids.a, ids.c))?.verdict).toBe('same');
  });
});

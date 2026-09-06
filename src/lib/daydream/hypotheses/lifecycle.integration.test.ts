import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';

// Explicit opt-in, synthetic rows only, and a hard local database guard.
vi.mock('$env/dynamic/private', () => ({ env: process.env }));
const enabled = process.env.DAYDREAM_LOCAL_TESTS === '1';
const subject = `daydream-test-${randomUUID()}`;
const plan = {
  benefit: 'Compare the cost of small shopping trips.',
  alternatives: ['Basket quantities explain the total.'],
  support: 'Comparable baskets cost more on additional trips.',
  contradict: 'Comparable baskets cost the same.',
  missingEvidence: [{ need: 'Receipt item quantities', reason: 'Separate price from quantity.', route: 'build', acceptance: 'Item totals reconcile to the receipt.' }],
};

describe.skipIf(!enabled)('investigation lifecycle in isolated Postgres', () => {
  let db: typeof import('$lib/db').db;
  let schema: typeof import('$lib/db/schema');
  let tester: typeof import('./test');
  let id: string;

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (!['127.0.0.1', 'localhost', 'jkai-db'].includes(url.hostname) || url.pathname !== '/jkai_local') throw new Error('Requires the isolated JKAI preview database');
    ({ db } = await import('$lib/db'));
    schema = await import('$lib/db/schema');
    tester = await import('./test');
    const [row] = await db.insert(schema.daydreamHypotheses).values({
      subject, hypothesisKey: 'distinctPlaces~verifiedSpendMinor@0',
      metricA: 'distinctPlaces', metricB: 'verifiedSpendMinor', lagDays: 0,
      direction: 'positive', question: 'Synthetic: do extra shop visits increase spending?',
      rationale: 'Synthetic investigation for chronological replay.', investigationPlan: plan,
      proposedAt: new Date('2026-08-01T12:00:00Z'),
    }).returning({ id: schema.daydreamHypotheses.id });
    id = row.id;
  });

  afterAll(async () => {
    if (!db) return;
    await db.delete(schema.daydreamCapabilities).where(eq(schema.daydreamCapabilities.slug, subject));
    await db.delete(schema.daydreamHypotheses).where(eq(schema.daydreamHypotheses.subject, subject));
    await db.delete(schema.daydreamDayFeatures).where(eq(schema.daydreamDayFeatures.subject, subject));
  });

  async function seed(month: string, negative = false) {
    await db.insert(schema.daydreamDayFeatures).values(Array.from({ length: 28 }, (_, i) => ({
      subject, day: `${month}-${String(i + 1).padStart(2, '0')}`, distinctPlaces: i + 1,
      verifiedSpendMinor: negative ? 30000 - i * 1000 : i * 1000 + 1000,
    })));
  }

  it('moves from exploratory to supported to contradicted, retaining exact evidence', async () => {
    await seed('2026-07');
    let result = await tester.testDueHypotheses({ subject, now: new Date('2026-08-02T12:00:00Z') });
    expect(result.errors).toEqual([]);
    expect(result.inconclusive).toBe(1);

    await seed('2026-08');
    result = await tester.testDueHypotheses({ subject, now: new Date('2026-09-01T12:00:00Z') });
    expect(result.supported).toBe(1);

    result = await tester.testDueHypotheses({ subject, now: new Date('2026-09-16T12:00:00Z') });
    expect(result.tested).toBe(0); // No new evidence; a repeated tick adds no confidence.

    await seed('2026-09', true);
    result = await tester.testDueHypotheses({ subject, windowDays: 30, now: new Date('2026-10-01T12:00:00Z') });
    expect(result.wrongDirection).toBe(1);
    const { loadHypothesisDetail } = await import('./detail');
    const detail = await loadHypothesisDetail(id);
    expect(detail?.history.map((a) => a.verdict)).toEqual(['wrong_direction', 'supported', 'inconclusive']);
    expect(detail?.plan).toEqual(plan);
    expect(detail?.days.filter((d) => d.used)).toHaveLength(28);

    // Correcting today's source cannot rewrite a past assessment's inputs.
    await db.update(schema.daydreamDayFeatures).set({ verifiedSpendMinor: 1 }).where(eq(schema.daydreamDayFeatures.subject, subject));
    expect((await loadHypothesisDetail(id))?.days).toEqual(detail?.days);
  });

  it('records only one assessment when two workers start from the same state', async () => {
    const [question] = await db.insert(schema.daydreamHypotheses).values({
      subject, hypothesisKey: 'concurrency-fixture', metricA: 'distinctPlaces', metricB: 'verifiedSpendMinor',
      direction: 'positive', question: 'Synthetic concurrency fixture', rationale: 'No duplicate assessments.',
      proposedAt: new Date('2026-07-01T12:00:00Z'),
    }).returning({ id: schema.daydreamHypotheses.id });
    const results = await Promise.all([
      tester.testDueHypotheses({ subject, now: new Date('2026-09-01T12:00:00Z') }),
      tester.testDueHypotheses({ subject, now: new Date('2026-09-01T12:00:00Z') }),
    ]);
    expect(results.flatMap((r) => r.errors)).toEqual([]);
    const history = await db.select().from(schema.daydreamHypothesisAssessments)
      .where(eq(schema.daydreamHypothesisAssessments.hypothesisId, question.id));
    expect(history).toHaveLength(1);
  });

  it('carries the original evidence acceptance checks into self-improvement intake', async () => {
    const { investigationGapFacts, investigationRequirements } = await import('./gaps');
    const facts = await investigationGapFacts();
    const fact = facts.find((f) => f.key === `investigation:${id}:0`);
    expect(fact?.text).toContain('Item totals reconcile');
    const requirements = await investigationRequirements([fact!.key]);
    expect(requirements).toContain(id);
    expect(requirements).toContain('Item totals reconcile');
    expect(requirements).toContain('rerun this investigation');
    await db.insert(schema.daydreamCapabilities).values({
      slug: subject, kind: 'feature', title: 'Synthetic receipt extraction',
      need: 'Receipt quantities', value: 'Separate price from quantity', consumer: 'daydream',
      cites: [fact!.key], status: 'queued', score: 1,
    });
    const { collectCapabilityIdeas } = await import('../appetite/intake');
    const item = (await collectCapabilityIdeas(40)).find((i) => i.capabilitySlug === subject);
    expect(item?.detail).toContain('Item totals reconcile');
    expect(item?.detail).toContain(id);
  });
  it('preserves legacy conclusions and safely reapplies the migration', async () => {
    const [legacy] = await db.insert(schema.daydreamHypotheses).values({
      subject, hypothesisKey: 'legacy-fixture', metricA: 'distinctPlaces', metricB: 'verifiedSpendMinor',
      direction: 'positive', question: 'Synthetic legacy question', rationale: 'Migration fixture',
      verdict: 'refuted', summary: 'Original legacy wording', testedAt: new Date('2026-07-01'),
    }).returning({ id: schema.daydreamHypotheses.id });
    const migration = await readFile('scripts/migrations/2026-09-06-daydream-investigations.sql', 'utf8');
    await db.execute(sql.raw(migration));
    await db.execute(sql.raw(migration));
    const [question] = await db.select().from(schema.daydreamHypotheses).where(eq(schema.daydreamHypotheses.id, legacy.id));
    expect(question.verdict).toBe('inconclusive');
    const history = await db.select().from(schema.daydreamHypothesisAssessments).where(eq(schema.daydreamHypothesisAssessments.hypothesisId, legacy.id));
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ phase: 'legacy', verdict: 'refuted', summary: 'Original legacy wording', evidence: [] });
  });

});

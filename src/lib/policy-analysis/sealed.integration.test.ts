// SEALED RUNS, against a real Postgres.
//
// The unit tests prove the cipher and prove the field manifest is complete. Only
// this proves the thing that actually matters: that a sealed run's rows, as they
// sit in the database, contain none of the paper — and that an unsealed run's
// rows do, so the flag is demonstrably doing the work rather than the test
// passing for some other reason.
//
// Opt in: POLICY_LOCAL_TESTS=1 with an isolated database on 15435. `gate:test`
// excludes `*.integration.test.ts`, so this never runs against anything shared.
import { mkdtempSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { policyAnalyses, policyArtefacts, policyDocuments, policyStages, workflowRuns } from '$lib/db/schema';
import { artefact } from './contracts';
import { census } from './server/census';
import { readKey } from './server/seal';
import { createAnalysis, detail, loadArtefacts, neighbourSummaries, persistArtefacts, purge, remove, sealOf } from './server/store';

vi.mock('./server/research', () => ({ research: async () => ({ artefacts: [], warnings: [] }) }));

const url = process.env.DATABASE_URL ?? '';
const local = process.env.POLICY_LOCAL_TESTS === '1' && /^postgres(?:ql)?:\/\/[^@]+@(127\.0\.0\.1|localhost):15435\/jkai_local$/.test(url);

// A FRESH OWNER PER TEST. Intake caps an owner at three active analyses, which
// is the feature working; sharing one owner across six cases just makes the cap
// the thing the suite measures. Each case also keeps its own blast radius, so a
// failure leaves the others' rows alone.
let n = 0;
const nextOwner = () => `sealed-${Date.now()}-${n++}@example.test`;
const bytes = readFileSync('tests/fixtures/policy-analysis/policy.txt');
// A phrase that is in the fixture document and in nothing else, so finding it in
// a raw column is unambiguous.
const NEEDLE = 'The Council is accountable';
const TITLE = 'Unpublished ministerial draft — do not circulate';

const created: { owner: string; id: string }[] = [];
beforeAll(() => { process.env.POLICY_SEAL_KEY_DIR = mkdtempSync(path.join(tmpdir(), 'policy-seal-it-')); });
afterAll(async () => {
  for (const { owner, id } of created) await purge(owner, id).catch(() => {});
  delete process.env.POLICY_SEAL_KEY_DIR;
});

async function create(owner: string, sealed: boolean, title = TITLE) {
  const a = await createAnalysis(owner, {
    title, jurisdiction: 'England', policyArea: 'Housing', context: 'A confidential context line.',
    depth: 'standard' as const, model: null, thinkingLevel: null, concurrency: null, sealed,
    filename: 'policy.txt', mimeType: 'text/plain', bytes,
  });
  created.push({ owner, id: a.id });
  return a;
}

/** Everything Postgres holds for one analysis, as one string, read raw. */
async function rawDump(id: string): Promise<string> {
  const parts: string[] = [];
  for (const q of [
    sql`select to_jsonb(t) as j from policy_analyses t where id = ${id}::uuid`,
    sql`select to_jsonb(t) as j from policy_documents t where analysis_id = ${id}::uuid`,
    sql`select to_jsonb(t) as j from policy_stages t where analysis_id = ${id}::uuid`,
    sql`select to_jsonb(t) as j from policy_artefacts t where analysis_id = ${id}::uuid`,
    sql`select to_jsonb(t) as j from workflow_runs t where input_data ->> 'analysisId' = ${id}`,
  ]) {
    const r = (await db.execute(q)) as unknown as { rows: { j: unknown }[] };
    for (const row of r.rows ?? []) parts.push(JSON.stringify(row.j));
  }
  return parts.join('\n');
}

describe.skipIf(!local)('a sealed run on isolated Postgres', () => {
  it('writes none of the paper in the clear — and an unsealed run writes all of it', async () => {
    const owner = nextOwner();
    const open = await create(owner, false, 'An ordinary assessment');
    const shut = await create(owner, true);

    // The control. Without this the sealed assertion could pass because the
    // needle was never written at all.
    const openDump = await rawDump(open.id);
    expect(openDump).toContain('An ordinary assessment');
    expect(Buffer.from(openDump).toString()).toContain(bytes.toString('base64').slice(0, 40));

    const shutDump = await rawDump(shut.id);
    for (const secret of [TITLE, 'A confidential context line.', 'policy.txt', bytes.toString('base64').slice(0, 40)]) {
      expect(shutDump, `raw rows must not contain ${secret.slice(0, 30)}`).not.toContain(secret);
    }
    expect(shutDump).toContain('sealed:v1:');
  });

  it('reads back exactly what went in', async () => {
    const owner = nextOwner();
    const a = await create(owner, true);
    const seen = await detail(owner, a.id);
    expect(seen?.analysis.title).toBe(TITLE);
    expect(seen?.analysis.context).toBe('A confidential context line.');
    expect(seen?.documents[0]?.filename).toBe('policy.txt');
  });

  it('encrypts artefacts at the store seam and decrypts them at the other side', async () => {
    const a = await create(nextOwner(), true);
    const seal = await sealOf(a.id);
    const claim = artefact('s1_0_claim', 'claim', 'Accountability', `${NEEDLE} for delivery.`, { category: 'responsibility', notes: 'x' }, { origin: 'extracted_fact' });
    await db.transaction(async (tx) => { await persistArtefacts(tx, a.id, 1, [claim], seal); });

    const raw = (await db.execute(sql`select statement, label, data::text as d from policy_artefacts where analysis_id = ${a.id}::uuid`)) as unknown as { rows: { statement: string; label: string; d: string }[] };
    expect(raw.rows[0].statement).not.toContain(NEEDLE);
    expect(raw.rows[0].statement.startsWith('sealed:v1:')).toBe(true);
    expect(raw.rows[0].label).not.toContain('Accountability');
    expect(raw.rows[0].d).not.toContain('responsibility');

    const back = await loadArtefacts(a.id);
    expect(back[0].statement).toBe(`${NEEDLE} for delivery.`);
    expect(back[0].label).toBe('Accountability');
    expect(back[0].data).toEqual({ category: 'responsibility', notes: 'x' });
  });

  it('is never offered to another assessment as a neighbour', async () => {
    const owner = nextOwner();
    const shut = await create(owner, true, 'A sealed neighbour candidate');
    const other = await create(owner, false, 'The assessment doing the looking');
    // Only completed assessments are neighbours at all; make the sealed one look finished.
    await db.update(policyAnalyses).set({ status: 'completed', completedAt: new Date() }).where(eq(policyAnalyses.id, shut.id));
    const neighbours = await neighbourSummaries(owner, other.id);
    expect(neighbours.map((n) => n.id)).not.toContain(shut.id);
  });

  it('purges to eleven zeroes, with the key destroyed first', async () => {
    const owner = nextOwner();
    const a = await create(owner, true);
    expect(await readKey(a.id)).not.toBeNull();
    // A cross-policy finding on somebody ELSE's assessment, naming this one. No
    // cascade reaches it; before `remove()` was extended it survived every delete.
    const other = await create(owner, false, 'A neighbouring assessment');
    const seal = await sealOf(other.id);
    await db.transaction(async (tx) => {
      await persistArtefacts(tx, other.id, 11, [artefact('s11_0_x', 'cross_policy', 'Two duties, one budget', 'Both place an unfunded duty on the same council.', {
        pattern: 'common_actor_overload', otherAnalysisId: a.id, otherAnalysisTitle: TITLE, otherArtefactIds: [],
        actorId: null, interaction: 'x', consequence: 'x', severity: 0.5, evidenceLimits: 'x', action: 'x',
      }, {})], seal);
    });
    expect((await census(a.id)).find((p) => p.table.startsWith('policy_artefacts (other'))?.rows).toBe(1);

    const result = await purge(owner, a.id);
    expect(result?.keyDestroyed).toBe(true);
    expect(await readKey(a.id)).toBeNull();

    const probes = await census(a.id);
    expect(probes).toHaveLength(11);
    expect(probes.filter((p) => p.rows !== 0)).toEqual([]);

    // The queue envelope is gone too — `policy_stages.run_id` has no cascade, so
    // it used to orphan.
    const runs = await db.select().from(workflowRuns).where(sql`${workflowRuns.inputData} ->> 'analysisId' = ${a.id}`);
    expect(runs).toHaveLength(0);
    // And the neighbour's own assessment is otherwise untouched.
    expect((await db.select().from(policyAnalyses).where(eq(policyAnalyses.id, other.id)))).toHaveLength(1);
  });

  it('leaves an unsealed run purgeable too, with the receipt saying it was not sealed', async () => {
    const owner = nextOwner();
    const a = await create(owner, false, 'An ordinary assessment to remove');
    const result = await purge(owner, a.id);
    expect(result?.sealed).toBe(false);
    expect(result?.keyDestroyed).toBe(false);
    expect((await census(a.id)).filter((p) => p.rows !== 0)).toEqual([]);
    expect(await db.select().from(policyDocuments).where(eq(policyDocuments.analysisId, a.id))).toHaveLength(0);
    expect(await db.select().from(policyStages).where(eq(policyStages.analysisId, a.id))).toHaveLength(0);
    expect(await db.select().from(policyArtefacts).where(eq(policyArtefacts.analysisId, a.id))).toHaveLength(0);
  });
});

describe.skipIf(!local)('the ordering is structural, not conventional', () => {
  it('refuses to delete a sealed run’s rows while its key is alive', async () => {
    const owner = nextOwner();
    const a = await create(owner, true, 'A sealed run somebody tried to plain-delete');
    // `remove` is the delete `purge` calls AFTER shredding. Reached with the key
    // still there, it must refuse rather than leave readable ciphertext in every
    // backup with its key beside it.
    await expect(remove(owner, a.id)).rejects.toThrow(/purge/i);
    expect(await readKey(a.id)).not.toBeNull();
    expect(await db.select().from(policyAnalyses).where(eq(policyAnalyses.id, a.id))).toHaveLength(1);
    // And the supported path still works.
    expect((await purge(owner, a.id))?.keyDestroyed).toBe(true);
  });
});

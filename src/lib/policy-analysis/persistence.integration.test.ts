import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { chromium } from 'playwright';
import { db } from '$lib/db';
import { policyAnalyses, policyArtefacts, policyExecutions, policyStages, workflowRuns } from '$lib/db/schema';
import { claimNext, releaseExpiredLeases } from '$lib/workflows/run-queue';
import { fixtureModel } from '../../../tests/fixtures/policy-analysis/model';
import { TRIGGER } from './contracts';
import { createAnalysis, control, detail, loadArtefacts, ownedAnalysis } from './server/store';
import { executePolicyRun } from './server/worker';
import { PolicyError } from './validation';
const state = vi.hoisted(() => ({ fail: false, wait: null as null | (() => Promise<void>) }));
vi.mock('./server/provider', () => ({ modelCaller: () => async (stage: number, key: string, input: unknown) => {
  if (state.wait) await state.wait();
  if (state.fail) throw new PolicyError('contract', 'Synthetic malformed output; stage visibly failed.');
  return fixtureModel(stage, key, input);
} }));
vi.mock('./server/research', () => ({ research: async () => ({ artefacts: [], warnings: ['Synthetic test: external research unavailable.'] }) }));
const url = process.env.DATABASE_URL ?? '';
const local = process.env.POLICY_LOCAL_TESTS === '1' && /^postgres(?:ql)?:\/\/[^@]+@(127\.0\.0\.1|localhost):15435\/jkai_local$/.test(url);
const created: string[] = [];
let retainedFixtureId: string | null = null;
const owner = 'preview@example.test';
const bytes = readFileSync('tests/fixtures/policy-analysis/policy.txt');
// The LAN preview, named by env rather than written into a public repo.
const base = process.env.POLICY_PREVIEW_ORIGIN ?? 'http://localhost:5275';
async function create() {
  const a = await createAnalysis(owner, { title: 'Synthetic policy persistence fixture', jurisdiction: 'Synthetic jurisdiction', policyArea: 'Service access', context: null, depth: 'standard' as const, model: null, thinkingLevel: null, concurrency: null, filename: 'policy.txt', mimeType: 'text/plain', bytes });
  created.push(a.id); return a;
}
async function claim(id: string) {
  const stages = await db.select().from(policyStages).where(eq(policyStages.analysisId, id));
  const stage = stages.sort((a,b) => a.ordinal-b.ordinal).find((s) => s.status !== 'completed')!;
  await db.update(workflowRuns).set({ startedAt: new Date(0) }).where(eq(workflowRuns.id, stage.runId!));
  const claimed = await claimNext('policy-fixture-worker', 60_000, TRIGGER, stage.runId!);
  expect(claimed).not.toBeNull(); return claimed!;
}
async function advance(id: string) { await executePolicyRun(await claim(id), 'policy-fixture-worker'); }

describe.skipIf(!local)('policy pipeline on isolated Postgres', () => {
  afterAll(async () => {
    for (const id of created) {
      if (id === retainedFixtureId) continue;
      const stages = await db.select().from(policyStages).where(eq(policyStages.analysisId, id));
      await db.delete(policyAnalyses).where(eq(policyAnalyses.id, id));
      for (const stage of stages) if (stage.runId) await db.delete(workflowRuns).where(eq(workflowRuns.id, stage.runId));
      await db.execute(sql`delete from workflow_runs where trigger = ${TRIGGER} and input_data->>'analysisId' = ${id}`);
    }
  });
  it('creates via browser upload, survives browser closure and returns all persisted stages and traceable results', async () => {
    const browser = await chromium.launch({ headless: true });
    let id = '';
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      await page.goto(`${base}/policy-analysis`, { waitUntil: 'networkidle' });
      await page.getByLabel('Policy title', { exact: true }).fill('Synthetic policy browser fixture');
      await page.getByLabel('Upload a policy document', { exact: true }).setInputFiles({ name: 'fixture.txt', mimeType: 'text/plain', buffer: bytes });
      await page.getByRole('button', { name: 'Start analysis', exact: true }).click();
      await page.waitForURL('**/policy-analysis/*', { timeout: 60000 });
      id = new URL(page.url()).pathname.split('/').at(-1)!; created.push(id);
      await page.getByText('Partial work:', { exact: false }).waitFor();
      await page.close();
      for (let stage = 0; stage < 11; stage++) await advance(id);
      const result = await detail(owner, id);
      expect(result?.stages.every((s) => s.status === 'completed')).toBe(true);
      expect(result?.analysis.status).toBe('completed_with_gaps');
      expect(result?.artefacts.filter((a) => a.kind === 'test')).toHaveLength(12);
      expect(result?.artefacts.some((a) => a.kind === 'edge')).toBe(true);
      expect(await ownedAnalysis('another@example.test', id)).toBeNull();
      expect(await detail('another@example.test', id)).toBeNull();
      await expect(control('another@example.test', id, 'cancel')).rejects.toThrow('not found');
      const returnPage = await browser.newPage();
      for (const width of [1440, 390]) {
        await returnPage.setViewportSize({ width, height: 1000 });
        await returnPage.goto(`${base}/policy-analysis/${id}`, { waitUntil: 'networkidle' });
        await returnPage.getByText('completed with gaps', { exact: true }).waitFor();
        expect(await returnPage.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
        await returnPage.screenshot({ path: `/tmp/policy-results-${width}.png`, fullPage: true });
      }
      await returnPage.getByRole('button', { name: 'Inspect artefact and evidence (2)', exact: true }).first().click();
      await returnPage.getByRole('complementary', { name: 'Artefact and evidence inspector' }).waitFor();
      await returnPage.getByRole('button', { name: 'Knowledge graph', exact: true }).click();
      await returnPage.getByRole('button', { name: 'Open graph', exact: true }).click();
      await returnPage.getByRole('dialog').waitFor();
      await returnPage.screenshot({ path: '/tmp/policy-graph.png' });
      if (process.env.POLICY_KEEP_FIXTURE === '1') { retainedFixtureId = id; console.log(`Retained synthetic policy preview: ${base}/policy-analysis/${id}`); }
    } finally { await browser.close(); }
  }, 180_000);
  it('reclaims an expired lease and makes stage completion idempotent', async () => {
    const a = await create(); const first = await claim(a.id);
    await db.update(workflowRuns).set({ leaseExpiresAt: new Date(0) }).where(eq(workflowRuns.id, first.id));
    await releaseExpiredLeases();
    const reclaimed = await claim(a.id); expect(reclaimed.id).toBe(first.id);
    await executePolicyRun(reclaimed, 'policy-fixture-worker');
    const before = await loadArtefacts(a.id);
    await executePolicyRun(first, 'policy-fixture-worker');
    expect(await loadArtefacts(a.id)).toEqual(before);
    expect((await detail(owner, a.id))?.stages.filter((s) => s.status === 'completed')).toHaveLength(1);
    await control(owner, a.id, 'cancel');
  });
  it('persists partial failures after bounded retries, then resumes without losing ingestion', async () => {
    const a = await create(); await advance(a.id);
    const before = await loadArtefacts(a.id); state.fail = true;
    try { for (let i = 0; i < 3; i++) await advance(a.id); } finally { state.fail = false; }
    const failed = await detail(owner, a.id);
    expect(failed?.analysis.status).toBe('failed');
    expect(failed?.stages[1].status).toBe('failed');
    expect(failed?.stages[2].status).toBe('pending');
    expect(failed?.executions.filter((e) => e.status === 'failed')).toHaveLength(3);
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage(); await page.goto(`${base}/policy-analysis/${a.id}`);
      await page.getByRole('button', { name: 'Resume incomplete stages' }).waitFor();
      await page.getByText('Synthetic malformed output; stage visibly failed.', { exact: true }).first().waitFor();
      expect(await page.getByRole('status').innerText()).toBe('failed');
    } finally { await browser.close(); }

    expect(await loadArtefacts(a.id)).toEqual(before);
    await control(owner, a.id, 'resume'); await advance(a.id);
    expect((await detail(owner, a.id))?.stages[1].status).toBe('completed');
    expect((await loadArtefacts(a.id)).filter((a) => a.kind === 'passage')).toEqual(before);
    await control(owner, a.id, 'cancel');
  });
  it('fences a late model result after cancellation and safely resumes', async () => {
    const a = await create(); await advance(a.id);
    let release!: () => void; let entered!: () => void;
    const began = new Promise<void>((resolve) => { entered = resolve; });
    state.wait = async () => { entered(); await new Promise<void>((resolve) => { release = resolve; }); };
    const running = advance(a.id); await began;
    await control(owner, a.id, 'cancel'); release();
    try { await running; } finally { state.wait = null; }
    expect((await detail(owner, a.id))?.analysis.status).toBe('cancelled');
    const rows = await db.select().from(policyArtefacts).where(and(eq(policyArtefacts.analysisId, a.id), eq(policyArtefacts.stage, 1)));
    expect(rows).toHaveLength(0);
    await control(owner, a.id, 'resume'); await advance(a.id);
    expect((await detail(owner, a.id))?.stages[1].status).toBe('completed');
    await control(owner, a.id, 'cancel');
  });
});

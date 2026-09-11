// The persona library against real Postgres: what actually lands in the tables,
// and what the NEXT assessment is shown because of it.
//
// The unit tests pin the rules — who matches whom, what may overwrite what. Only
// this can pin the part that spans two runs and a transaction: that a completed
// assessment opens a dossier, that the next one reads it before profiling the
// same body, and that deleting the first leaves the persona standing with one
// fewer sighting.
//
// Opt-in and isolated, exactly as `persistence.integration.test.ts` is. The
// guard is deliberately a literal match on a loopback test database: nothing
// here should ever be capable of running against the dev or production one.
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { policyAnalyses, policyPersonaObservations, policyPersonas, policyStages, workflowRuns } from '$lib/db/schema';
import { claimNext } from '$lib/workflows/run-queue';
import { fixtureModel } from '../../../tests/fixtures/policy-analysis/model';
import { PERSONA_STAGE, STAGES, TRIGGER } from './contracts';
import type { PersonaPrior } from './personas';
import { createAnalysis, remove } from './server/store';
import { personaDetail } from './server/personas';
import { executePolicyRun } from './server/worker';

/** What the model was shown, so the prior can be asserted rather than assumed. */
const seen = vi.hoisted(() => ({ priors: [] as { stage: number; prior: PersonaPrior | null }[] }));
vi.mock('./server/provider', () => ({ modelCaller: () => async (stage: number, key: string, input: unknown) => {
  seen.priors.push({ stage, prior: ((input as { priorPersona?: PersonaPrior | null }).priorPersona) ?? null });
  return fixtureModel(stage, key, input);
} }));
vi.mock('./server/research', () => ({ research: async () => ({ artefacts: [], warnings: ['Synthetic test: external research unavailable.'] }) }));

const url = process.env.DATABASE_URL ?? '';
const local = process.env.POLICY_LOCAL_TESTS === '1' && /^postgres(?:ql)?:\/\/[^@]+@(127\.0\.0\.1|localhost):15435\/jkai_local$/.test(url);
const owner = 'persona-fixture@example.test';
const created: string[] = [];

const first = readFileSync('tests/fixtures/policy-analysis/policy.txt');
// A DIFFERENT document naming the same body: the same bytes would be read as a
// redraft of one paper rather than a second policy.
const second = Buffer.concat([first, Buffer.from('\n\nThis note is a separate policy about the same Council.\n')]);

async function run(title: string, bytes: Buffer) {
  const analysis = await createAnalysis(owner, { title, jurisdiction: 'Synthetic jurisdiction', policyArea: 'Service access', context: null, depth: 'standard' as const, model: null, thinkingLevel: null, concurrency: null, sealed: false, filename: 'policy.txt', mimeType: 'text/plain', bytes });
  created.push(analysis.id);
  for (let i = 0; i < STAGES.length; i++) {
    const stages = await db.select().from(policyStages).where(eq(policyStages.analysisId, analysis.id));
    const stage = stages.sort((a, b) => a.ordinal - b.ordinal).find((s) => s.status !== 'completed');
    if (!stage?.runId) break;
    await db.update(workflowRuns).set({ startedAt: new Date(0) }).where(eq(workflowRuns.id, stage.runId));
    const claimed = await claimNext('persona-fixture-worker', 60_000, TRIGGER, stage.runId);
    expect(claimed).not.toBeNull();
    await executePolicyRun(claimed!, 'persona-fixture-worker');
  }
  const [row] = await db.select().from(policyAnalyses).where(eq(policyAnalyses.id, analysis.id));
  return row;
}

describe.skipIf(!local)('the persona library across two assessments', () => {
  afterAll(async () => {
    for (const id of created) await remove(owner, id).catch(() => false);
    await db.delete(policyPersonas).where(eq(policyPersonas.owner, owner));
  });

  it('opens a dossier from the first assessment and reads it into the second', async () => {
    const one = await run('Persona fixture — first policy', first);
    expect(['completed', 'completed_with_gaps']).toContain(one.status);

    const opened = await db.select().from(policyPersonas).where(eq(policyPersonas.owner, owner));
    expect(opened.length).toBeGreaterThan(0);
    const council = opened.find((p) => /council/i.test(p.name)) ?? opened[0];
    expect(council.sightings).toBe(1);
    expect(council.dossier.length).toBeGreaterThan(0);

    const observations = await db.select().from(policyPersonaObservations).where(eq(policyPersonaObservations.personaId, council.id));
    expect(observations).toHaveLength(1);
    expect(observations[0].analysisId).toBe(one.id);
    // The track record is counted from the run's own plays, not taken on trust.
    expect(observations[0].plays.length).toBeGreaterThan(0);

    // Nothing before the library stage may have been shown a prior on run one.
    expect(seen.priors.filter((p) => p.prior)).toHaveLength(0);

    seen.priors.length = 0;
    const two = await run('Persona fixture — second policy', second);
    expect(['completed', 'completed_with_gaps']).toContain(two.status);

    // The profile stage of the SECOND run was shown what the first established.
    const atProfile = seen.priors.filter((p) => p.stage === 4 && p.prior);
    expect(atProfile.length).toBeGreaterThan(0);
    expect(atProfile[0].prior?.personaId).toBe(council.id);
    expect(atProfile[0].prior?.traits.length).toBeGreaterThan(0);
    // And the red team was shown the track record, minus this run's own plays.
    const atRedTeam = seen.priors.filter((p) => p.stage === 10 && p.prior);
    expect(atRedTeam.length).toBeGreaterThan(0);
    expect(atRedTeam[0].prior?.trackRecord.length).toBeGreaterThan(0);
    for (const play of atRedTeam[0].prior?.trackRecord ?? []) expect(play.policy).toBe('Persona fixture — first policy');

    const [after] = await db.select().from(policyPersonas).where(eq(policyPersonas.id, council.id));
    expect(after.sightings).toBe(2);
  }, 120_000);

  it('keeps the dossier when an assessment behind it is deleted', async () => {
    const detail = (await personaDetail(owner, (await db.select().from(policyPersonas).where(eq(policyPersonas.owner, owner)))[0].id))!;
    expect(detail.analyses.length).toBeGreaterThan(0);
    const dropped = detail.analyses[0].id;

    expect(await remove(owner, dropped)).toBe(true);

    const still = await personaDetail(owner, detail.persona.id);
    expect(still).not.toBeNull();
    // The observation cascades with the assessment; the persona does not.
    expect(still!.observations.some((o) => o.analysisId === dropped)).toBe(false);
    expect(still!.persona.dossier.length).toBeGreaterThan(0);
    expect(still!.persona.sightings).toBe(detail.persona.sightings - 1);
  }, 60_000);

  it('runs the library as the last stage, after the report is written', async () => {
    expect(STAGES[PERSONA_STAGE]).toBe('Actor persona library');
    const stages = await db.select().from(policyStages).where(eq(policyStages.analysisId, created.at(-1)!));
    expect(stages).toHaveLength(STAGES.length);
    expect(stages.find((s) => s.ordinal === PERSONA_STAGE)?.status).toBe('completed');
  });
});

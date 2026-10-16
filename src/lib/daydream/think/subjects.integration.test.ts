import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { inArray, sql } from 'drizzle-orm';

// Every read and write here is real, against an isolated local database: the
// subject lookups (jsonb containment on the evidence), the fold, the
// supersession, interest coverage, the reasons and the correlation ledger.
vi.mock('$env/dynamic/private', () => ({ env: process.env }));
import { db } from '$lib/db';
import { daydreamThoughts } from '$lib/db/schema';
import { foldInto, interestCoverage, loadSubjectNotes, recentSubjects, supersedeOnSubject } from './subjects.server';
import { readSeenAgain } from './subjects';
import { readReplaces } from './topics';
import { loadLedger, saveTests } from './ledger.server';
import { recordReason, loadTaste } from '../reasons.server';
import { setSetting } from '$lib/server/models/settings';
import { LEDGER_SETTING } from './ledger';

const database = process.env.DATABASE_URL ?? '';
const enabled = process.env.DAYDREAM_SUBJECT_TESTS === '1' && /(?:127\.0\.0\.1|localhost):15435\/daydream_insight_local$/.test(database);

const ids: string[] = [];
const NOW = new Date();
const ago = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

async function note(o: { kind?: string; title?: string; subject?: string; channel?: string; created?: Date; status?: string; feedback?: string | null; feedbackNote?: string | null }) {
  const id = `uiseed-subject-${randomUUID()}`;
  ids.push(id);
  await db.insert(daydreamThoughts).values({
    id,
    kind: o.kind ?? 'think_money_analysis',
    title: o.title ?? 'Sky TV monthly charge increased by £1.69',
    explanation: 'Read 1 card',
    narrative: 'From £38.00 to £39.69.',
    score: 1,
    components: { audited: 1 },
    evidence: [
      { kind: 'think-card', id: `spend:[]@${id}` },
      { kind: 'think-question', id: o.channel ?? 'money', note: 'x' },
      ...(o.subject ? [{ kind: 'think-subject', id: o.subject, note: 'subject' }] : []),
    ],
    dedupeKey: `think:test:${id}`,
    status: o.status ?? 'delivered',
    feedback: o.feedback ?? null,
    feedbackNote: o.feedbackNote ?? null,
    feedbackAt: o.feedback || o.feedbackNote ? NOW : null,
    proposedActions: [],
    createdAt: o.created ?? ago(1),
    updatedAt: NOW,
  });
  return id;
}

async function get(id: string) {
  const [r] = await db.select().from(daydreamThoughts).where(sql`${daydreamThoughts.id} = ${id}`);
  return r;
}

// File scope, so it runs after BOTH blocks — the cycle's rows are known only
// once it has written them.
afterAll(async () => {
  if (!enabled) return;
  if (ids.length) await db.delete(daydreamThoughts).where(inArray(daydreamThoughts.id, ids));
  await setSetting(LEDGER_SETTING, {});
});

describe.skipIf(!enabled)('subjects against the local database', () => {

  it('finds notes by subject in every status, and nothing else', async () => {
    const a = await note({ subject: 'merchant:sky', status: 'expired', created: ago(100) });
    const b = await note({ subject: 'merchant:sky' });
    await note({ subject: 'merchant:github' });
    await note({});
    const rows = await loadSubjectNotes(['merchant:sky'], NOW);
    expect(rows.map((r) => r.id).sort()).toEqual([a, b].sort());
    expect(rows.find((r) => r.id === a)).toMatchObject({ open: false, answered: false, key: 'merchant:sky' });
    expect(rows.find((r) => r.id === b)).toMatchObject({ open: true });
  });

  it('folds a repeat into the earlier note', async () => {
    const a = await note({ subject: 'merchant:postcode-lottery' });
    await foldInto(a, '2026-10-15', NOW);
    await foldInto(a, '2026-10-16', NOW);
    const r = await get(a);
    expect(readSeenAgain(r.proposedActions)).toEqual(['2026-10-15', '2026-10-16']);
    expect(r.recurrenceCount).toBeGreaterThanOrEqual(2);
  });

  it('archives the older notes under a revision, and records what it replaced', async () => {
    const old = await note({ subject: 'merchant:sky-2', created: ago(50) });
    const fresh = await note({ subject: 'merchant:sky-2', title: 'Sky rose again, to £41.50' });
    expect(await supersedeOnSubject(fresh, [{ id: old, title: 'Sky TV monthly charge increased by £1.69' }], NOW)).toBe(1);
    expect(await get(old)).toMatchObject({ status: 'archived', suppressedReason: `superseded: ${fresh}` });
    expect(readReplaces((await get(fresh)).proposedActions)).toEqual([{ id: old, title: 'Sky TV monthly charge increased by £1.69' }]);
  });

  it('lists recent subjects, and only topic subjects for a research cycle', async () => {
    await note({ kind: 'think_research', subject: 'topic:ember-1', channel: 'research', title: 'Blind names in Ember-1' });
    const all = await recentSubjects(NOW);
    const research = await recentSubjects(NOW, { prefix: 'topic:' });
    expect(all.some((s) => s.key === 'merchant:sky')).toBe(true);
    expect(research.every((s) => s.key.startsWith('topic:'))).toBe(true);
    expect(research.some((s) => s.key === 'topic:ember-1')).toBe(true);
  });

  it('counts his verdicts on an interest, reasons included', async () => {
    await note({ kind: 'think_research', subject: 'topic:barns-ness', channel: 'research', feedback: 'not_useful', created: ago(30) });
    await note({ kind: 'think_research', subject: 'topic:barns-ness', channel: 'research', feedback: 'not_useful', feedbackNote: 'already_knew', created: ago(10) });
    const cov = await interestCoverage(NOW);
    expect(cov.get('topic:barns-ness')).toMatchObject({ verdicts: [true, true] });
  });

  it('files "not now" with no verdict, and keeps the taste from "already knew"', async () => {
    const a = await note({ title: 'Steps are up this week' });
    const b = await note({ title: 'Read Wild Mind tonight', kind: 'think_research', channel: 'research' });
    await recordReason(a, 'already_knew');
    await recordReason(b, 'not_now');
    expect(await get(a)).toMatchObject({ feedback: 'not_useful', feedbackNote: 'already_knew', status: 'dismissed' });
    expect(await get(b)).toMatchObject({ feedback: null, feedbackNote: 'not_now', status: 'expired', suppressedReason: 'owner: not now' });
    const taste = await loadTaste(NOW, { researchOnly: false });
    expect(taste.some((t) => t.title === 'Steps are up this week' && t.reason === 'already_knew')).toBe(true);
    // A research cycle never sees a private note's title.
    expect((await loadTaste(NOW, { researchOnly: true })).some((t) => t.title === 'Steps are up this week')).toBe(false);
  });

  it('keeps the correlation ledger across saves', async () => {
    await setSetting(LEDGER_SETTING, {});
    const e = { a: 'sleepMinutes', b: 'recoveryScore', days: 90, n: 62, tests: [{ label: 'same day', r: 0.04, n: 62, p: 0.78 }], at: NOW.toISOString() };
    await saveTests([e]);
    await saveTests([{ ...e, a: 'steps', at: new Date(NOW.getTime() + 1000).toISOString() }]);
    const l = await loadLedger();
    expect(Object.keys(l).sort()).toEqual(['correlate:recoveryScore~sleepMinutes', 'correlate:recoveryScore~steps']);
  });
});

// ── One think cycle end to end: the model and the spend tool are stubbed, the
// rest — audit, subject rule, persistence, fold, supersession — is real.
const cycle = vi.hoisted(() => ({ reply: '', spend: 'SKY DIGITAL £39.69 [bank] 2026-10-10' }));
vi.mock('./reads', async (orig) => ({ ...(await orig<typeof import('./reads')>()), spendTool: async () => cycle.spend }));
vi.mock('$lib/llm/client', () => ({ getLLMClient: async () => ({ client: {}, model: 'stub' }) }));
vi.mock('../model', () => ({ resolveDaydreamModel: async () => ({ provider: 'openrouter', modelId: 'stub' }) }));
vi.mock('$lib/server/notify', () => ({ notifyOwner: async () => ({ raised: false, reason: 'test' }) }));
vi.mock('./profile', () => ({ buildProfileLines: async () => [] }));
vi.mock('$lib/llm/tool-loop', () => ({
  runToolLoop: async (o: { execute: (c: { name: string; args: Record<string, unknown> }) => Promise<string> }) => {
    await o.execute({ name: 'spend', args: { days: 30 } });
    return { reply: cycle.reply, rounds: 1, usage: { prompt: 0, completion: 0 } };
  },
}));

describe.skipIf(!enabled)('a think cycle against the local database', () => {
  const sky = (over: Record<string, unknown> = {}) =>
    JSON.stringify({ notes: [{ outcome: 'money_analysis', title: 'Sky TV went up by £1.69', body: 'Sky now takes £39.69 a month, up £1.69 from September.', cites: ['C1'], subject: 'merchant:Sky', ...over }] });

  it('writes the first note, folds the repeat, and revises on a new figure', async () => {
    const { runThink } = await import('./run');
    const t0 = new Date(NOW.getTime() + 60_000);
    // The slot decides the channel; a private one is all this needs.
    const at = (h: number) => {
      let d = new Date(t0.getTime() + h * 3_600_000);
      // Step to a private slot (research is slot mod 7 = 6).
      while (Math.floor(d.getTime() / (45 * 60_000)) % 7 === 6) d = new Date(d.getTime() + 45 * 60_000);
      return d;
    };

    cycle.reply = sky();
    const first = await runThink({ now: at(0) });
    expect(first.error).toBeNull();
    expect(first.notes.created).toBe(1);

    cycle.reply = sky({ title: 'Sky charge rose £1.69 this month' });
    const second = await runThink({ now: at(5) });
    expect(second.subjects.folded).toBe(1);
    expect(second.notes.created).toBe(0);

    cycle.spend = 'SKY DIGITAL £41.50 [bank] 2026-11-10';
    cycle.reply = sky({ title: 'Sky rose again, to £41.50', body: 'Sky now takes £41.50 a month, a second rise.', changed: 'a second rise, to £41.50' });
    const third = await runThink({ now: at(10) });
    expect(third.subjects).toMatchObject({ revised: 1, superseded: 1 });

    const rows = await db
      .select({ id: daydreamThoughts.id, status: daydreamThoughts.status, narrative: daydreamThoughts.narrative, actions: daydreamThoughts.proposedActions, title: daydreamThoughts.title })
      .from(daydreamThoughts)
      .where(sql`${daydreamThoughts.evidence} @> '[{"kind":"think-subject","id":"merchant:sky"}]'::jsonb and ${daydreamThoughts.kind} = 'think_money_analysis' and ${daydreamThoughts.title} like 'Sky%'`);
    for (const r of rows) ids.push(r.id);
    const orig = rows.find((r) => r.title === 'Sky TV went up by £1.69')!;
    const rev = rows.find((r) => r.title === 'Sky rose again, to £41.50')!;
    expect(orig.status).toBe('archived');
    expect(readSeenAgain(orig.actions)).toHaveLength(1);
    expect(rev.narrative).toMatch(/^What changed: a second rise, to £41\.50/);
    expect(readReplaces(rev.actions).map((r) => r.id)).toEqual([orig.id]);
  });
});

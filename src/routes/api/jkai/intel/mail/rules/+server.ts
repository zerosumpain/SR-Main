// Admission rules — propose, backtest, approve, decline.
//
//   GET                                every rule with its backtest
//   POST { action: 'seed' }            put the shipped proposal in place
//   POST { action: 'propose' }         ask the model for new proposals (validated + backtested here)
//   POST { action: 'backtest', key }   re-run one rule against the current mailbox
//   POST { action: 'activate', key }   the ONLY path to an active rule
//   POST { action: 'decline'|'pause', key }
//   POST { action: 'apply' }           run active rules over the pending queue now
//
// The order of operations in `propose` is the safety story: validate, then
// backtest, then judge, and only store what survives all three — with
// `status: 'proposed'` regardless. Nothing on this route can activate a rule
// except `activate`, and that refuses a rule with no backtest.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { intelNotes } from '$lib/db/schema';
import { validateRule, describeCondition, type MailRule } from '$lib/jkai/intel/mail-rules/spec';
import {
  listMailRules,
  proposeRule,
  activateRule,
  setRuleStatus,
  saveBacktest,
  seedMailRules,
  SEED_RULE,
  RELEVANCE_SEED_RULE,
} from '$lib/jkai/intel/mail-rules/store';
import { backtestRule, judgeBacktest, type CorpusNote } from '$lib/jkai/intel/mail-rules/backtest';
import { proposeMailRules } from '$lib/jkai/intel/mail-rules/propose';
import { applyMailRules } from '$lib/jkai/intel/mail-rules/apply';
import { ownerDecisions } from '$lib/jkai/intel/mail-decisions';

/** Every email note, for a replay. Bounded — a backtest over a corpus this size
 *  is already a second of work, and a larger one is a different problem. */
async function loadCorpus(): Promise<CorpusNote[]> {
  const rows = await db
    .select({
      id: intelNotes.id,
      title: intelNotes.title,
      rawContent: intelNotes.rawContent,
      metadata: intelNotes.metadata,
      observedAt: intelNotes.observedAt,
      createdAt: intelNotes.createdAt,
      graphState: intelNotes.graphState,
    })
    .from(intelNotes)
    .where(eq(intelNotes.source, 'email'))
    .limit(10_000);
  return rows as CorpusNote[];
}

export const GET: RequestHandler = async () => {
  const rules = await listMailRules();
  return json({
    rules: rules.map((r) => ({ ...r, explanation: describeCondition(r.condition) })),
    seedAvailable: ![SEED_RULE.key, RELEVANCE_SEED_RULE.key].every((k) => rules.some((r) => r.key === k)),
  });
};

export const POST: RequestHandler = async ({ request }) => {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Body must be JSON.' }, { status: 400 });
  }
  const action = String(body.action ?? '');
  const key = typeof body.key === 'string' ? body.key : '';

  if (action === 'seed') {
    const created = await seedMailRules();
    if (created) {
      // Backtest them immediately — a proposal the owner cannot see the numbers
      // for is a proposal they cannot responsibly approve.
      const [corpus, decisions] = await Promise.all([loadCorpus(), ownerDecisions()]);
      const now = Date.now();
      for (const seed of [SEED_RULE, RELEVANCE_SEED_RULE]) {
        await saveBacktest(seed.key, backtestRule(seed, corpus, decisions, { now }));
      }
    }
    return json({ created, rules: await listMailRules() });
  }

  if (action === 'propose') {
    const batch = await proposeMailRules();
    if (batch.error && !batch.proposals.length) return json({ error: batch.error }, { status: 422 });

    const [corpus, decisions] = await Promise.all([loadCorpus(), ownerDecisions()]);
    const now = Date.now();
    const accepted: MailRule[] = [];
    const refused: Array<{ key: string; reasons: string[] }> = [];

    for (const candidate of batch.proposals) {
      const validation = validateRule({ ...candidate, status: 'proposed' });
      if (!validation.ok) {
        refused.push({ key: String(candidate.key ?? '(no key)'), reasons: validation.errors });
        continue;
      }
      const rule = candidate as unknown as MailRule;
      const backtest = backtestRule(rule, corpus, decisions, { now });
      const judgement = judgeBacktest(rule, backtest, decisions.length);
      if (!judgement.offerable) {
        refused.push({ key: rule.key, reasons: judgement.refusals });
        continue;
      }
      const stored = await proposeRule({ ...rule, origin: 'model' }, backtest);
      if (stored.ok && stored.rule) accepted.push(stored.rule);
      else refused.push({ key: rule.key, reasons: stored.errors });
    }

    return json({ accepted, refused, tokens: batch.tokens, error: batch.error });
  }

  if (action === 'backtest') {
    const rule = (await listMailRules()).find((r) => r.key === key);
    if (!rule) return json({ error: `No rule called "${key}".` }, { status: 404 });
    const [corpus, decisions] = await Promise.all([loadCorpus(), ownerDecisions()]);
    const backtest = backtestRule(rule, corpus, decisions, { now: Date.now() });
    await saveBacktest(key, backtest);
    return json({ backtest, judgement: judgeBacktest(rule, backtest, decisions.length) });
  }

  if (action === 'activate') {
    const result = await activateRule(key);
    if (!result.ok) return json({ error: result.error }, { status: 400 });
    return json({ rule: result.rule });
  }

  if (action === 'decline' || action === 'pause') {
    const result = await setRuleStatus(key, action === 'decline' ? 'declined' : 'proposed');
    if (!result.ok) return json({ error: result.error }, { status: 400 });
    return json({ ok: true });
  }

  if (action === 'apply') {
    return json(await applyMailRules());
  }

  return json({ error: `Unknown action "${action}".` }, { status: 400 });
};

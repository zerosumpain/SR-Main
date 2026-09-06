// src/lib/daydream/hypotheses/propose.ts
//
// The step where the model decides what is worth looking at.
//
// This is the inversion the whole redesign is about. Everywhere else in this
// feature a rule decides there is something here and the model phrases it; here
// the model decides what question to ask and deterministic code answers it. The
// bargain is the rulesmith's, and it holds for the same reason: the model emits
// DATA over a fixed allow-list, never code and never a conclusion.
//
// What it is NOT given is the correlation matrix. That omission is the single
// most important line in this file. A proposer that sees the results first and
// then "proposes" the winners has not proposed anything — it has laundered an
// exhaustive sweep through a language model, and the q-values downstream would
// be corrected over a family of six when the real family was several hundred.
// It gets the metric catalogue, how much data exists for each, what it has
// already asked, and what John thought of previous questions. Nothing else.
//
// All model access goes through $lib/llm/client, never a provider SDK.

import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamDayFeatures, daydreamHypotheses, daydreamLeads } from '$lib/db/schema';
import { getLLMClient } from '$lib/llm/client';
import { resolveDaydreamModel } from '../compose';
import { SWEEP_METRICS } from '../stats/sweep';
import { DEFAULT_SUBJECT, errMsg } from '../types';
import { hypothesisKey, validateHypothesis, type HypothesisSpec } from './spec';
import { activeSteerNotes, renderSteers } from './steer';
import { raiseFault, unknownMetricsIn } from '../faults';
import { withActivity } from '$lib/context/activity';

export const MAX_TOKENS = 3000;

/** Plain-English descriptions. The model cannot read the schema. */
const METRIC_NOTES: Record<string, string> = {
  steps: 'steps walked that day',
  activeEnergyKj: 'active energy burned, kJ',
  meanHeartRate: 'average heart rate across the day, bpm',
  hrvMs: 'heart-rate variability, ms — higher is usually better recovered',
  restingHeartRate: 'resting heart rate overnight, bpm — lower is usually better',
  recoveryScore: "Whoop's recovery score, 0-100",
  strain: "Whoop's day strain, 0-21",
  sleepMinutes: 'minutes actually asleep',
  sleepPerformance: 'sleep achieved against sleep needed, %',
  sleepEfficiency: 'share of time in bed spent asleep, %',
  disturbanceCount: 'times sleep was disturbed',
  workouts: 'number of recorded workouts',
  activeMinutes: 'minutes of recorded activity',
  activityDistanceM: 'distance covered in recorded activity, m',
  minutesAtHome: 'minutes the trail placed him at home',
  minutesOut: 'minutes the trail placed him away from home',
  distinctPlaces: 'how many different known places he was at',
  firstOutAtMins: 'minutes after midnight he first left home',
  lastHomeAtMins: 'minutes after midnight he was last seen at home',
  calendarEvents: 'calendar events that day',
  calendarBusyMinutes: 'minutes of timed calendar commitments, overlaps merged',
  verifiedSpendMinor: 'evidenced spend that day in pence (receipts + bank when armed) — understates cash',
};

export interface ProposalBatch {
  proposals: HypothesisSpec[];
  /** Steer ids that shaped this batch, so one that has directed a fortnight of
   *  questions and produced nothing is visible rather than assumed to work. */
  steerIds: string[];
  /** Proposals thrown out, with the reason, so a proposer that has started
   *  emitting nonsense is visible rather than silently ignored. */
  rejected: Array<{ reason: string }>;
  tokens: number;
  error: string | null;
}

/**
 * What the proposer gets to see.
 *
 * Coverage per metric is included deliberately: without it the model proposes
 * questions about columns that are empty, every one comes back `underpowered`,
 * and the board fills with things that could never have been answered.
 */
export async function gatherContext(subject = DEFAULT_SUBJECT): Promise<string> {
  const parts: string[] = [];

  const [totals] = await db
    .select({
      days: sql<number>`count(*)::int`,
      from: sql<string>`min(${daydreamDayFeatures.day})::text`,
      to: sql<string>`max(${daydreamDayFeatures.day})::text`,
    })
    .from(daydreamDayFeatures).where(eq(daydreamDayFeatures.subject, subject));

  parts.push(`DATA: ${totals?.days ?? 0} days on record, ${totals?.from ?? '?'} to ${totals?.to ?? '?'}.`);

  // How many days each metric actually has. Counted in JS over one read rather
  // than nineteen COUNT queries — the table is one row per day, so the whole
  // thing is a few hundred rows even at a year's depth.
  const rows = await db.select().from(daydreamDayFeatures).where(eq(daydreamDayFeatures.subject, subject));
  const coverage = new Map<string, number>();
  for (const m of SWEEP_METRICS) coverage.set(m, 0);
  for (const r of rows) {
    for (const m of SWEEP_METRICS) {
      if ((r as unknown as Record<string, unknown>)[m] != null) {
        coverage.set(m, (coverage.get(m) ?? 0) + 1);
      }
    }
  }

  parts.push(
    'METRICS (name — what it is — days with a reading):\n' +
      SWEEP_METRICS.map(
        (m) => `- ${m} — ${METRIC_NOTES[m] ?? 'no description'} — ${coverage.get(m) ?? 0} days`,
      ).join('\n'),
  );

  // Registered SIGNALS — the open registry, the sensors and the self-built
  // tools — are askable too. Only what has enough days to be tested, best
  // attested first, capped so the menu stays a menu.
  const signals = await sweepableSignalMenu();
  if (signals.length) {
    parts.push(
      'SIGNALS (key — what it is — days with a reading). Use the key EXACTLY as written:\n' +
        signals.map((s) => `- ${s.key} — ${s.label} — ${s.observedDays} days`).join('\n'),
    );
  }

  const asked = await db
    .select({
      key: daydreamHypotheses.hypothesisKey,
      q: daydreamHypotheses.question,
      verdict: daydreamHypotheses.verdict,
      feedback: daydreamHypotheses.feedback,
    })
    .from(daydreamHypotheses)
    .where(eq(daydreamHypotheses.subject, subject))
    .orderBy(desc(daydreamHypotheses.proposedAt))
    .limit(60);

  if (asked.length) {
    parts.push(
      'ALREADY ASKED — do not repeat any of these:\n' +
        asked
          .map((a) => `- [${a.verdict ?? 'untested'}] ${a.q}${a.feedback ? ` (John: ${a.feedback})` : ''}`)
          .join('\n'),
    );
  }

  // Open lines of enquiry from the ponder engine's frontier. Like a steer,
  // this reorders attention and grants no new access — the metric allow-list
  // is unchanged, questions inside these sets are simply preferred. It is
  // what closes the leads loop: a lead owns the hypotheses inside its metric
  // set, so questions asked here are how a lead earns its keep or gets
  // abandoned.
  try {
    const openLeads = await db
      .select({
        title: daydreamLeads.title,
        metrics: daydreamLeads.metrics,
        score: daydreamLeads.score,
      })
      .from(daydreamLeads)
      .where(and(eq(daydreamLeads.subject, subject), eq(daydreamLeads.status, 'open')))
      .orderBy(desc(daydreamLeads.score))
      .limit(3);
    if (openLeads.length) {
      parts.push(
        'OPEN LINES OF ENQUIRY — prefer questions whose metrics sit inside one of these sets:\n' +
          openLeads
            .map((l) => `- ${l.title} [${((l.metrics ?? []) as string[]).join(', ')}]`)
            .join('\n'),
      );
    }
  } catch {
    // The frontier is optional context; proposing works without it.
  }

  // What he has asked for, if anything. Rendered last so it sits closest to the
  // request, and explicitly framed as preference over an unchanged allow-list.
  // Steers are notebook notes tagged `steer` now (D4). Same block, same weight.
  const steers = await activeSteerNotes();
  const steerBlock = renderSteers(steers as never);
  if (steerBlock) parts.push(steerBlock);

  const liked = asked.filter((a) => a.feedback === 'useful').map((a) => a.q);
  const disliked = asked.filter((a) => a.feedback === 'not_useful').map((a) => a.q);
  if (liked.length) parts.push(`John found these worth asking:\n${liked.map((q) => `- ${q}`).join('\n')}`);
  if (disliked.length) {
    parts.push(`John found these NOT worth asking:\n${disliked.map((q) => `- ${q}`).join('\n')}`);
  }

  return parts.join('\n\n');
}

const SYSTEM = `You choose what an assistant should investigate about John's own data.

You are given a catalogue of daily measurements and how many days each one has.
You are NOT given any correlations, and you must not guess at any. Your job is
to pick questions worth answering, not to answer them. Code will run the actual
statistics on whatever you propose and may well refute it — that is a fine
outcome and a refuted question is still a useful one.

Output ONLY a JSON array of objects, each exactly:
{
  "a": "<metric name>",
  "b": "<metric name>",
  "lagDays": 0 or 1,
  "direction": "positive" | "negative" | "either",
  "question": "one line, plain English, what you want to know",
  "rationale": "why this might hold, and why it would matter to him",
  "plan": {
    "benefit": "the decision this could improve",
    "alternatives": ["a plausible competing explanation"],
    "support": "what future observation would support the claim",
    "contradict": "what future observation would contradict it",
    "missingEvidence": [{"need": "specific missing evidence", "reason": "which explanation it distinguishes", "route": "lookup" | "observe" | "ask" | "connect" | "build", "acceptance": "how to check that the evidence is usable"}]
  }
}

lagDays 0 asks whether the two move together on the same day. lagDays 1 asks
whether "a" today predicts "b" tomorrow — use it when you think one causes the
other with a delay, and be careful which way round you put them.

direction is what you EXPECT. Say it plainly so the data can contradict you.

Rules:
- Only metric names from the METRICS list or keys from the SIGNALS list, exactly as written. Nothing else exists.
- Never propose a pair where one is computed from the other — resting heart rate
  against recovery score is not a discovery, it is how the score is defined.
- Prefer questions that CROSS domains: sleep against where he went, movement
  against recovery, time of leaving the house against how he slept. Two
  measurements from the same wearable are usually the same fact twice.
- Prefer metrics with plenty of days. A question about a metric with 15 days of
  data cannot be answered and wastes the slot.
- A good question is one whose answer would change something, and that he could
  not have worked out by looking at his own phone.

- Include a plan. Alternatives are hypotheses, not facts about the person.
- Missing evidence is optional (use []); ask for it only when it could change a decision.
- Prefer lookup of existing evidence, waiting for observations, or one focused question before a new connection or build.
- A build request must specify the evidence needed and how to validate it; it grants no access.
- Money-saving questions must distinguish prices from quantities, refunds and duplicate evidence of one payment.
- Existing results are exploratory; future observations are needed for prospective validation.

No prose, no code fence. If nothing is worth asking, output [].`;

export const MAX_SIGNALS_IN_MENU = 40;

/** The signals a hypothesis may name: sweepable, best attested first. */
async function sweepableSignalMenu(): Promise<Array<{ key: string; label: string; observedDays: number }>> {
  try {
    const { listSweepableSignals } = await import('../signals/registry');
    const { MIN_PAIRS } = await import('../stats/tests');
    const rows = await listSweepableSignals(MIN_PAIRS);
    return rows
      .filter((r) => !r.key.startsWith('feature:'))
      .sort((a, b) => b.observedDays - a.observedDays || a.key.localeCompare(b.key))
      .slice(0, MAX_SIGNALS_IN_MENU)
      .map((r) => ({ key: r.key, label: r.label, observedDays: r.observedDays }));
  } catch {
    return [];
  }
}

/** Ask for a batch of questions. Validation happens here; testing does not. */
export async function proposeHypotheses(
  maxProposals = 5,
  subject = DEFAULT_SUBJECT,
): Promise<ProposalBatch> {
  const result: ProposalBatch = { proposals: [], rejected: [], steerIds: [], tokens: 0, error: null };
  try {
    const context = await gatherContext(subject);
    const allowed = new Set<string>([...SWEEP_METRICS, ...(await sweepableSignalMenu()).map((s) => s.key)]);
    result.steerIds = (await activeSteerNotes()).map((s) => s.id);
    const model = await resolveDaydreamModel();
    const { client, model: modelId } = await getLLMClient(model);

    const res = await withActivity('daydream', () =>
      client.chat.completions.create({
        model: modelId,
        messages: [
          { role: 'system', content: SYSTEM },
          {
            role: 'user',
            content: `${context}\n\nPropose at most ${maxProposals} questions worth investigating.`,
          },
        ],
        temperature: 0.6,
        max_tokens: MAX_TOKENS,
      }),
    );
    result.tokens = (res.usage?.prompt_tokens ?? 0) + (res.usage?.completion_tokens ?? 0);

    const raw = (res.choices[0]?.message?.content ?? '')
      .trim()
      .replace(/^```(?:json)?/i, '')
      .replace(/```$/, '')
      .trim();
    if (!raw || raw === '[]') return result;

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      result.error = 'proposer did not return an array';
      return result;
    }

    const seen = new Set<string>();
    for (const item of parsed.slice(0, maxProposals)) {
      const v = validateHypothesis(item, allowed);
      if (!v.ok || !v.spec || !v.spec.plan) {
        result.rejected.push({ reason: v.reason ?? 'investigation plan required' });
        // A metric the proposer keeps asking for that nothing writes is the
        // fault ledger's business — the toolsmith reads it first.
        for (const m of unknownMetricsIn(v.reason ?? '')) {
          void raiseFault({ kind: 'metric_unknown', identifier: m, site: 'hypotheses/propose', detail: `the proposer asked for "${m}", which no day feature or signal provides`, subject });
        }
        continue;
      }
      // Two proposals for the same question in one batch is one question.
      const key = hypothesisKey(v.spec);
      if (seen.has(key)) {
        result.rejected.push({ reason: `duplicate of another proposal in this batch: ${key}` });
        continue;
      }
      seen.add(key);
      result.proposals.push(v.spec);
    }
  } catch (err) {
    result.error = errMsg(err);
  }
  return result;
}

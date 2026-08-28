// src/lib/daydream/provenance.ts
//
// Does the thing you think is feeding the reasoning actually feed it?
//
// The page could show 242 registered signals, thirteen healthy jobs and a
// graph with 4,911 entities, and none of that answers the only question worth
// asking: is any of it reaching the part that draws conclusions. The honest
// answer on production the day this was written is mostly NO, and nothing on
// the page said so:
//
//   • 185 Home Assistant sensors were registered and **0** were in the sweep,
//     because they had 2 observed days against a 14-day floor.
//   • 13 weather signals, **0** sweepable, 9 days.
//   • The intel graph reaches thoughts and the ponder pack and is **not**
//     wired to observations, the sweep or hypotheses at all — deliberately,
//     but invisibly.
//   • Of the whole mailbox, only receipts and bank rows reach a hypothesis,
//     through the single `verifiedSpendMinor` column. Security and admin mail
//     reach thoughts and stop there.
//
// So this measures each link and names its state. Nothing here asserts a
// connection: every `flowing` carries the count and the freshness that proves
// it, every `waiting` carries have-vs-need, and every `by_design` carries the
// reason the path is closed. A provenance panel that simply drew arrows would
// be worse than none — it would look like assurance while being decoration.

import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import {
  daydreamObservations,
  daydreamOffers,
  daydreamSignals,
  daydreamSpend,
  daydreamThoughts,
  intelInsights,
  heartbeatActions,
  heartbeatPulses,
} from '$lib/db/schema';
import { MIN_PAIRS } from './stats/tests';
import { SWEEP_METRICS } from './stats/sweep';

/** The four things a source can be doing. */
export type LinkState =
  /** Measured to be reaching this consumer, with the count that proves it. */
  | 'flowing'
  /** Wired, but under the minimum support the consumer requires. */
  | 'waiting'
  /** Reached it once and has not lately. */
  | 'stalled'
  /** Deliberately not wired. The reason is part of the answer. */
  | 'by_design';

export interface Link {
  to: string;
  state: LinkState;
  /** The measurement, in words. Never a bare adjective. */
  detail: string;
  /** For `waiting`: what it has and what it needs. */
  have?: number;
  need?: number;
}

export interface SourceRow {
  key: string;
  label: string;
  /** What this source IS, in one line. */
  blurb: string;
  /** Headline measurement for the source itself. */
  summary: string;
  links: Link[];
}

/** How long since a source last produced anything before it counts as stalled. */
export const STALE_DAYS = 3;

/** The reasons a path is deliberately closed. Written out because "not wired"
 *  without a reason reads as an oversight, and every one of these is a
 *  decision somebody made on purpose. */
const BY_DESIGN = {
  graphToHypotheses:
    'The proposer is shown a fixed vocabulary and never the correlations — that blind pre-registration is what makes a q-value mean anything over ~4 tests instead of ~276. Widening it to the graph would void the correction.',
  mailToHypotheses:
    'Only money reaches a hypothesis, through verifiedSpendMinor. Security and admin mail are events, not a daily series, so they inform thoughts rather than statistics.',
  mailToObservations:
    'The signal registry holds numeric series. An account-recovery email is an event; it becomes a thought, not a measurement.',
} as const;

function daysSince(d: Date | string | null): number | null {
  if (!d) return null;
  const t = d instanceof Date ? d.getTime() : Date.parse(String(d));
  if (!Number.isFinite(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
}

/**
 * Decide a link's state from what was measured. PURE — this is the function
 * that must never flatter the data, so it is the one that gets tested.
 */
export function assessLink(opts: {
  to: string;
  /** How much is reaching the consumer right now. */
  have: number;
  /** The consumer's minimum support, when it has one. */
  need?: number;
  /** Days since the source last produced anything. */
  ageDays?: number | null;
  flowingDetail: string;
  waitingDetail?: string;
}): Link {
  const { to, have, need, ageDays } = opts;

  if (need !== undefined && have < need) {
    return {
      to,
      state: 'waiting',
      have,
      need,
      detail:
        opts.waitingDetail ??
        `${have} of the ${need} needed — nothing from here is being used yet.`,
    };
  }
  if (have === 0) {
    return { to, state: 'waiting', have: 0, detail: 'Nothing has reached it yet.' };
  }
  if (ageDays != null && ageDays > STALE_DAYS) {
    return {
      to,
      state: 'stalled',
      detail: `${opts.flowingDetail} — but nothing new for ${ageDays} days.`,
    };
  }
  return { to, state: 'flowing', detail: opts.flowingDetail };
}

/** Latest pulse for a named action, for freshness. */
async function lastPulse(name: string) {
  const [row] = await db
    .select({ ts: heartbeatPulses.ts, outcome: heartbeatPulses.outcome, summary: heartbeatPulses.summary })
    .from(heartbeatPulses)
    .innerJoin(heartbeatActions, eq(heartbeatActions.id, heartbeatPulses.actionId))
    .where(eq(heartbeatActions.name, name))
    .orderBy(desc(heartbeatPulses.ts))
    .limit(1);
  return row ?? null;
}

/**
 * Measure every source→consumer link.
 *
 * One pass over the registry, the thought ledger's evidence refs, and a few
 * counts. Read on page load, so it is counts and not scans.
 */
export async function loadProvenance(): Promise<{
  sources: SourceRow[];
  minPairs: number;
  /** Total signals registered vs actually in the sweep — the headline. */
  registered: number;
  sweepable: number;
}> {
  const [signalRows, evidenceRows, offerCount, spendRows, insightCount, bridgedCount] =
    await Promise.all([
      db
        .select({
          source: daydreamSignals.source,
          registered: sql<number>`count(*)::int`,
          active: sql<number>`count(*) filter (where ${daydreamSignals.status} = 'active')::int`,
          sweepable: sql<number>`count(*) filter (where ${daydreamSignals.status} = 'active' and ${daydreamSignals.observedDays} >= ${MIN_PAIRS})::int`,
          bestDays: sql<number>`coalesce(max(${daydreamSignals.observedDays}), 0)::int`,
        })
        .from(daydreamSignals)
        .groupBy(daydreamSignals.source),

      // What the thoughts actually cite. This is the ledger's own record of
      // which sources reached a conclusion, so it cannot drift from reality.
      db
        .select({
          kind: sql<string>`e->>'kind'`,
          n: sql<number>`count(*)::int`,
          latest: sql<string>`max(${daydreamThoughts.createdAt})::text`,
        })
        .from(daydreamThoughts)
        .innerJoin(
          sql`lateral jsonb_array_elements(${daydreamThoughts.evidence}) e`,
          sql`true`,
        )
        .groupBy(sql`e->>'kind'`),

      db.select({ n: sql<number>`count(*)::int` }).from(daydreamOffers).then((r) => r[0]?.n ?? 0),

      db
        .select({
          n: sql<number>`count(*)::int`,
          latest: sql<string>`max(${daydreamSpend.day})`,
        })
        .from(daydreamSpend)
        .where(gte(daydreamSpend.day, new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)))
        .then((r) => r[0] ?? { n: 0, latest: null }),

      db
        .select({ n: sql<number>`count(*)::int` })
        .from(intelInsights)
        .then((r) => r[0]?.n ?? 0),

      db
        .select({ n: sql<number>`count(*)::int` })
        .from(daydreamThoughts)
        .where(sql`${daydreamThoughts.kind} like 'intel\\_%'`)
        .then((r) => r[0]?.n ?? 0),
    ]);

  const bySource = new Map(signalRows.map((r) => [r.source, r]));
  const evidence = new Map(evidenceRows.map((r) => [r.kind, r]));
  const ev = (k: string) => evidence.get(k)?.n ?? 0;
  const evAge = (k: string) => daysSince(evidence.get(k)?.latest ?? null);

  const [obsLatest] = await db
    .select({ day: sql<string>`max(${daydreamObservations.day})` })
    .from(daydreamObservations);

  const mailPulse = await lastPulse('daydream-mail');
  const intelPulse = await lastPulse('daydream-intel');

  /** A registry-backed source: HA, weather, journeys, the feature mirror. */
  const registrySource = (
    key: string,
    label: string,
    blurb: string,
    inHypothesisVocabulary: Link,
  ): SourceRow => {
    const r = bySource.get(key) ?? { registered: 0, active: 0, sweepable: 0, bestDays: 0 };
    return {
      key,
      label,
      blurb,
      summary: `${r.registered} registered · ${r.active} active · ${r.sweepable} in the sweep`,
      links: [
        assessLink({
          to: 'Observations',
          have: r.active,
          ageDays: daysSince(obsLatest?.day ?? null),
          // The freshness clause is omitted rather than rendered as "unknown".
          // A panel whose job is assurance should not pad a line with a word
          // that carries no information.
          flowingDetail:
            `${r.active} series recording` +
            (obsLatest?.day ? `, latest reading ${obsLatest.day}.` : '.'),
        }),
        assessLink({
          to: 'Sweep',
          have: r.sweepable,
          // The floor is per SIGNAL, so "have" is how many cleared it.
          need: r.registered > 0 && r.sweepable === 0 ? 1 : undefined,
          flowingDetail: `${r.sweepable} of ${r.active} have the ${MIN_PAIRS} days a correlation needs.`,
          waitingDetail:
            `None yet — the best of them has ${r.bestDays} of the ${MIN_PAIRS} days a correlation needs. ` +
            `Registering is not trusting; they join on their own.`,
        }),
        inHypothesisVocabulary,
      ],
    };
  };

  const sources: SourceRow[] = [
    registrySource(
      'ha',
      'Home Assistant',
      'Every entity state and numeric attribute discovery finds. Nothing here is hand-listed.',
      {
        to: 'Hypotheses',
        state: 'by_design',
        detail:
          'The proposer asks only about the fixed feature vocabulary. A sensor can be correlated by the sweep long before anyone may ask a question about it.',
      },
    ),
    registrySource('weather', 'Weather', 'Open-Meteo at each person’s own median daily position.', {
      to: 'Hypotheses',
      state: 'by_design',
      detail: 'Not in the proposer’s vocabulary; it reaches conclusions through the sweep.',
    }),
    registrySource('journey', 'Journeys', 'Door-to-door times on routes between two named places.', {
      to: 'Hypotheses',
      state: 'by_design',
      detail: 'Not in the proposer’s vocabulary; it reaches conclusions through the sweep.',
    }),
    registrySource(
      'feature',
      'Feature store',
      'One row per person per day — health, trail, diary and money on a common key.',
      assessLink({
        to: 'Hypotheses',
        have: SWEEP_METRICS.length,
        flowingDetail: `The proposer’s whole vocabulary: ${SWEEP_METRICS.length} metrics, and nothing else may be asked about.`,
      }),
    ),

    // ── The graph ──
    // Its daily ACTIVITY is now a registry source like any other (see
    // signals/graph.ts), so observations and the sweep are measured here
    // rather than declared closed. Only the proposer's vocabulary stays shut.
    {
      key: 'intel',
      label: 'Intelligence graph',
      blurb:
        'Entities, edges and the nightly rule-based insight detectors. Its daily activity — what was added, admitted and found — is published as signals.',
      summary:
        `${insightCount} findings stored · ${bridgedCount} became thoughts · ` +
        `${(bySource.get('graph')?.sweepable ?? 0)} of ${(bySource.get('graph')?.active ?? 0)} series in the sweep`,
      links: [
        assessLink({
          to: 'Observations',
          have: bySource.get('graph')?.active ?? 0,
          flowingDetail: `${bySource.get('graph')?.active ?? 0} daily series — entities and edges added, notes admitted, findings raised.`,
        }),
        assessLink({
          to: 'Sweep',
          have: bySource.get('graph')?.sweepable ?? 0,
          need: (bySource.get('graph')?.registered ?? 0) > 0 && (bySource.get('graph')?.sweepable ?? 0) === 0 ? 1 : undefined,
          flowingDetail: `${bySource.get('graph')?.sweepable ?? 0} have the ${MIN_PAIRS} days a correlation needs. Rates only — a cumulative total would correlate with anything that trends.`,
          waitingDetail: `Registered, and the best has ${bySource.get('graph')?.bestDays ?? 0} of the ${MIN_PAIRS} days a correlation needs.`,
        }),
        { to: 'Hypotheses', state: 'by_design', detail: BY_DESIGN.graphToHypotheses },
        assessLink({
          to: 'Thoughts',
          have: bridgedCount,
          ageDays: daysSince(intelPulse?.ts ?? null),
          flowingDetail: `${bridgedCount} findings bridged into the ledger. Last run: ${intelPulse?.summary ?? 'never'}`,
        }),
        assessLink({
          to: 'Ponder pack',
          have: ev('intel-entity') + ev('intel'),
          flowingDetail: `${ev('intel-entity')} entity references and ${ev('intel')} findings cited by thoughts.`,
        }),
      ],
    },

    // ── The mailbox, split by what each lane actually reaches ──
    {
      key: 'mail-money',
      label: 'Email — receipts & bank',
      blurb: 'The only part of the mailbox that becomes a number on a day.',
      summary: `${spendRows.n} verified rows in 30 days${spendRows.latest ? ` · latest ${spendRows.latest}` : ''}`,
      links: [
        assessLink({
          to: 'Feature store',
          have: spendRows.n,
          ageDays: daysSince(spendRows.latest),
          flowingDetail: `Summed into verifiedSpendMinor — ${spendRows.n} rows in the last 30 days.`,
        }),
        assessLink({
          to: 'Hypotheses',
          have: spendRows.n,
          flowingDetail: 'Askable as verifiedSpendMinor, the one email-derived metric in the vocabulary.',
        }),
        assessLink({
          to: 'Thoughts',
          have: ev('spend'),
          ageDays: evAge('spend'),
          flowingDetail: `${ev('spend')} transactions cited as evidence.`,
        }),
      ],
    },
    {
      key: 'mail-events',
      label: 'Email — security, money admin, official post',
      blurb: 'Account recovery, payment failures, tax and NHS. Rules over the subject line and the sender.',
      summary: mailPulse?.summary ?? 'never run',
      links: [
        { to: 'Observations', state: 'by_design', detail: BY_DESIGN.mailToObservations },
        { to: 'Hypotheses', state: 'by_design', detail: BY_DESIGN.mailToHypotheses },
        assessLink({
          to: 'Thoughts',
          have: ev('email'),
          ageDays: evAge('email'),
          flowingDetail: `${ev('email')} emails cited as evidence on the ledger.`,
        }),
      ],
    },
    {
      key: 'mail-offers',
      label: 'Email — offers',
      blurb: 'Vouchers extracted from bulk mail, matched against places you go.',
      summary: `${offerCount} offers indexed`,
      links: [
        { to: 'Hypotheses', state: 'by_design', detail: BY_DESIGN.mailToHypotheses },
        assessLink({
          to: 'Thoughts',
          have: offerCount,
          flowingDetail: `${offerCount} indexed and available to the near-an-offer detector.`,
        }),
      ],
    },

    // ── The diary ──
    {
      key: 'calendar',
      label: 'Calendar',
      blurb: 'Events and busy minutes, after anything you have chosen to ignore.',
      summary: `${ev('calendar')} diary references cited by thoughts`,
      links: [
        assessLink({
          to: 'Feature store',
          have: ev('calendar'),
          flowingDetail: 'calendarEvents and calendarBusyMinutes, per day.',
        }),
        assessLink({
          to: 'Hypotheses',
          have: 2,
          flowingDetail: 'Askable as calendarEvents and calendarBusyMinutes.',
        }),
      ],
    },
  ];

  const registered = signalRows.reduce((a, r) => a + r.registered, 0);
  const sweepable = signalRows.reduce((a, r) => a + r.sweepable, 0);
  return { sources, minPairs: MIN_PAIRS, registered, sweepable };
}

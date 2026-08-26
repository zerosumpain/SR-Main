// src/lib/daydream/leads/run.ts
//
// Working through the frontier, one bounded round at a time.
//
// "Constant model-backed decision making during less active periods" is the
// ask, and the danger in it is not cost — it is a loop with no floor. This
// repository has a documented history of exactly that: four heartbeat watchers
// ran away, one to 43,115 ticks, and the builder looped to iteration 11 with a
// cap of 2. So every bound here is explicit, checked in code rather than
// promised in a prompt, and recorded in the trace:
//
//   • At most MAX_LEADS_PER_RUN leads get a round. Not "the ones that look
//     interesting" — a hard slice off a ranked frontier.
//   • At most MAX_ROUNDS_PER_LEAD rounds in a lead's whole life, so a lead
//     cannot become immortal by staying marginally interesting.
//   • Every step is written to the trace with its token cost, so an expensive
//     round is visible afterwards rather than inferred from a bill.
//   • Pruning is arithmetic over the lead's own results, with no second model
//     call — which is what makes abandoning a line affordable enough to do.

import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamHypotheses, daydreamLeadSteps, daydreamLeads } from '$lib/db/schema';
import { DEFAULT_SUBJECT, errMsg } from '../types';
import { rankLeads, scoreLead, shouldAbandon, type LeadStats } from './score';

/** How many lines of enquiry advance in one run. */
export const MAX_LEADS_PER_RUN = 3;

/**
 * A hard ceiling on a lead's whole life.
 *
 * Separate from the barren-round test on purpose. That one retires a line that
 * has stopped producing; this one retires a line that never stops producing
 * just enough to survive, which is the shape a runaway actually takes.
 */
export const MAX_ROUNDS_PER_LEAD = 20;

export interface RoundResult {
  leadsConsidered: number;
  leadsAdvanced: number;
  leadsAbandoned: number;
  leadsRetired: number;
  stepsWritten: number;
  errors: string[];
}

export const EMPTY_ROUND: RoundResult = {
  leadsConsidered: 0, leadsAdvanced: 0, leadsAbandoned: 0,
  leadsRetired: 0, stepsWritten: 0, errors: [],
};

async function trace(
  leadId: string,
  round: number,
  kind: string,
  note: string,
  detail: Record<string, unknown> = {},
  tokens = 0,
): Promise<void> {
  await db.insert(daydreamLeadSteps).values({ leadId, round, kind, note, detail, tokens });
}

/** Recount a lead's results from the hypotheses that actually belong to it. */
async function statsFor(
  lead: typeof daydreamLeads.$inferSelect,
): Promise<LeadStats> {
  // A lead owns the hypotheses whose metric pair sits inside its allow-list.
  // Derived rather than stored, so a lead cannot inflate its own record.
  const metrics = (lead.metrics ?? []) as string[];
  let spawned = 0;
  let held = 0;
  if (metrics.length >= 2) {
    const [row] = await db
      .select({
        spawned: sql<number>`count(*)::int`,
        held: sql<number>`count(*) filter (where ${daydreamHypotheses.verdict} = 'supported')::int`,
      })
      .from(daydreamHypotheses)
      .where(
        and(
          eq(daydreamHypotheses.subject, lead.subject),
          inArray(daydreamHypotheses.metricA, metrics),
          inArray(daydreamHypotheses.metricB, metrics),
        ),
      );
    spawned = row?.spawned ?? 0;
    held = row?.held ?? 0;
  }
  return {
    hypothesesSpawned: spawned,
    hypothesesHeld: held,
    barrenRounds: lead.barrenRounds,
    roundsRun: lead.roundsRun,
    lastRoundAt: lead.lastRoundAt,
    fromSteer: lead.steerId != null,
  };
}

/**
 * Advance the frontier by one run.
 *
 * Rescoring happens for every open lead — it is arithmetic and costs nothing —
 * but only the top few actually get a round. That separation is what makes the
 * frontier a frontier rather than a queue: a lead can climb without being run,
 * and be run the moment it reaches the top.
 */
export async function runExplorationRound(
  opts: { subject?: string; now?: Date; maxLeads?: number } = {},
): Promise<RoundResult> {
  const subject = opts.subject ?? DEFAULT_SUBJECT;
  const now = opts.now ?? new Date();
  const maxLeads = Math.min(opts.maxLeads ?? MAX_LEADS_PER_RUN, MAX_LEADS_PER_RUN);
  const result: RoundResult = { ...EMPTY_ROUND, errors: [] };

  const open = await db
    .select()
    .from(daydreamLeads)
    .where(and(eq(daydreamLeads.subject, subject), eq(daydreamLeads.status, 'open')));
  result.leadsConsidered = open.length;
  if (open.length === 0) return result;

  // ── Rescore everything. Free, and it is what lets a lead climb unrun. ──
  const scored: Array<{ lead: typeof open[number]; stats: LeadStats; score: number }> = [];
  for (const lead of open) {
    try {
      const stats = await statsFor(lead);
      const { score, components } = scoreLead(stats, now);
      await db
        .update(daydreamLeads)
        .set({
          score,
          scoreComponents: components,
          hypothesesSpawned: stats.hypothesesSpawned,
          hypothesesHeld: stats.hypothesesHeld,
          updatedAt: now,
        })
        .where(eq(daydreamLeads.id, lead.id));
      scored.push({ lead: { ...lead, score }, stats, score });
    } catch (err) {
      result.errors.push(`score ${lead.id}: ${errMsg(err)}`);
    }
  }

  // ── Retire what has run out, before spending anything on it. ──
  const survivors: typeof scored = [];
  for (const s of scored) {
    try {
      if (s.lead.roundsRun >= MAX_ROUNDS_PER_LEAD) {
        await db
          .update(daydreamLeads)
          .set({ status: 'parked', updatedAt: now })
          .where(eq(daydreamLeads.id, s.lead.id));
        await trace(s.lead.id, s.lead.roundsRun, 'prune', `parked after ${s.lead.roundsRun} rounds — lifetime cap`, {
          roundsRun: s.lead.roundsRun,
          cap: MAX_ROUNDS_PER_LEAD,
        });
        result.leadsRetired++;
        result.stepsWritten++;
        continue;
      }

      if (shouldAbandon(s.stats, s.lead.abandonAfterBarrenRounds)) {
        await db
          .update(daydreamLeads)
          .set({ status: 'abandoned', updatedAt: now })
          .where(eq(daydreamLeads.id, s.lead.id));
        // The numbers that made the decision, so it can be argued with.
        await trace(s.lead.id, s.lead.roundsRun, 'prune',
          `abandoned after ${s.stats.barrenRounds} barren rounds`,
          {
            barrenRounds: s.stats.barrenRounds,
            threshold: s.lead.abandonAfterBarrenRounds,
            spawned: s.stats.hypothesesSpawned,
            held: s.stats.hypothesesHeld,
          });
        result.leadsAbandoned++;
        result.stepsWritten++;
        continue;
      }

      survivors.push(s);
    } catch (err) {
      result.errors.push(`prune ${s.lead.id}: ${errMsg(err)}`);
    }
  }

  // ── Advance the top few. A hard slice, not a judgement call. ──
  const frontier = rankLeads(survivors.map((s) => ({ ...s, roundsRun: s.lead.roundsRun }))).slice(0, maxLeads);

  for (const s of frontier) {
    try {
      const round = s.lead.roundsRun + 1;
      // Barren is measured against what this lead has held SO FAR; the round
      // that follows either adds to it or increments the barren count.
      const producedBefore = s.stats.hypothesesHeld;
      await trace(s.lead.id, round, 'plan',
        `round ${round}: ${s.stats.hypothesesSpawned} questions so far, ${producedBefore} held`,
        { score: s.score, metrics: s.lead.metrics });

      await db
        .update(daydreamLeads)
        .set({ roundsRun: round, lastRoundAt: now, updatedAt: now })
        .where(eq(daydreamLeads.id, s.lead.id));

      result.leadsAdvanced++;
      result.stepsWritten++;
    } catch (err) {
      result.errors.push(`advance ${s.lead.id}: ${errMsg(err)}`);
    }
  }

  return result;
}

/**
 * Close the loop after the hypothesis engine has run.
 *
 * Called once verdicts exist: a lead whose latest round produced a supported
 * hypothesis resets its barren counter, and one that did not increments it.
 * Split from `runExplorationRound` because the verdicts arrive in a different
 * activity, and pretending otherwise would mean counting a round barren before
 * its questions had been answered.
 */
export async function settleRounds(subject = DEFAULT_SUBJECT): Promise<number> {
  const open = await db
    .select()
    .from(daydreamLeads)
    .where(and(eq(daydreamLeads.subject, subject), eq(daydreamLeads.status, 'open')));

  let settled = 0;
  for (const lead of open) {
    const stats = await statsFor(lead);
    const gained = stats.hypothesesHeld > lead.hypothesesHeld;
    await db
      .update(daydreamLeads)
      .set({
        barrenRounds: gained ? 0 : lead.barrenRounds + 1,
        hypothesesHeld: stats.hypothesesHeld,
        hypothesesSpawned: stats.hypothesesSpawned,
        updatedAt: new Date(),
      })
      .where(eq(daydreamLeads.id, lead.id));
    await trace(lead.id, lead.roundsRun, 'judge',
      gained ? 'round paid off' : 'round produced nothing new',
      { held: stats.hypothesesHeld, was: lead.hypothesesHeld });
    settled++;
  }
  return settled;
}

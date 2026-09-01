// src/lib/daydream/leads/detail.ts
//
// How a line of enquiry is actually going.
//
// The Discoveries tab could say a lead had run 6 rounds, spawned 11 questions
// and held 2, and there was nowhere to go from there. Those five numbers are a
// summary of a process that is already recorded in full: `run.ts` writes a
// `daydream_lead_steps` row at every plan, spawn, read, judge and prune, with
// the reasoning and the tokens attached, precisely so the loop can be audited
// rather than trusted. Nothing read that table. This is the reader.
//
// Same shape and same argument as `hypotheses/detail.ts`, one level up: that
// one opens a verdict onto the days behind it, this one opens a lead onto the
// rounds behind it.
//
// ── Why the questions are DERIVED, not looked up ──────────────────────────
//
// There is no `lead_id` on `daydream_hypotheses`. A lead owns the questions
// whose metric pair sits inside its own allow-list, which is how `statsFor` in
// run.ts already counts them — deliberately, so a lead cannot inflate its own
// record by claiming a question outside its range. This uses exactly that rule,
// so the questions listed here and the `hypothesesSpawned` figure on the row
// can never disagree.

import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamHypotheses, daydreamLeadSteps, daydreamLeads } from '$lib/db/schema';

export interface LeadStep {
  round: number;
  /** 'plan' | 'spawn' | 'read' | 'judge' | 'prune'. */
  kind: string;
  note: string;
  detail: Record<string, unknown>;
  tokens: number;
  at: string;
}

export interface LeadQuestion {
  id: string;
  question: string;
  verdict: string | null;
  summary: string | null;
  r: number | null;
  qValue: number | null;
  pairs: number | null;
  proposedAt: string;
  testedAt: string | null;
}

export interface LeadDetail {
  id: string;
  title: string;
  rationale: string;
  status: string;
  metrics: string[];
  score: number;
  /** Every input to `score`, named — never show an unexplained number. */
  scoreComponents: Record<string, number>;
  roundsRun: number;
  barrenRounds: number;
  abandonAfterBarrenRounds: number;
  hypothesesSpawned: number;
  hypothesesHeld: number;
  fromSteer: boolean;
  createdAt: string;
  lastRoundAt: string | null;
  steps: LeadStep[];
  questions: LeadQuestion[];
  /** Tokens the trace accounts for. The honest cost figure: Codex reports no
   *  price, so pounds would read 0.00 whatever the work was. */
  tokens: number;
  /**
   * True when the lead has run rounds but written no steps.
   *
   * Worth saying out loud rather than rendering as an empty list. A lead that
   * advanced without tracing did its thinking somewhere unreviewable, and that
   * is a fault in the loop rather than a quiet week — the same distinction the
   * hub draws everywhere else between "nothing happened" and "nothing was
   * recorded".
   */
  traceMissing: boolean;
}

export async function loadLeadDetail(leadId: string): Promise<LeadDetail | null> {
  const [lead] = await db
    .select()
    .from(daydreamLeads)
    .where(eq(daydreamLeads.id, leadId))
    .limit(1);
  if (!lead) return null;

  const metrics = (lead.metrics ?? []) as string[];

  const [steps, questions] = await Promise.all([
    db
      .select()
      .from(daydreamLeadSteps)
      .where(eq(daydreamLeadSteps.leadId, leadId))
      // Newest round first, but the steps WITHIN a round in the order they
      // happened — a plan that reads after the judge it produced is unreadable.
      .orderBy(desc(daydreamLeadSteps.round), asc(daydreamLeadSteps.createdAt))
      .limit(200),
    metrics.length >= 2
      ? db
          .select({
            id: daydreamHypotheses.id,
            question: daydreamHypotheses.question,
            verdict: daydreamHypotheses.verdict,
            summary: daydreamHypotheses.summary,
            r: daydreamHypotheses.r,
            qValue: daydreamHypotheses.qValue,
            pairs: daydreamHypotheses.pairs,
            proposedAt: daydreamHypotheses.proposedAt,
            testedAt: daydreamHypotheses.testedAt,
          })
          .from(daydreamHypotheses)
          .where(
            and(
              eq(daydreamHypotheses.subject, lead.subject),
              inArray(daydreamHypotheses.metricA, metrics),
              inArray(daydreamHypotheses.metricB, metrics),
            ),
          )
          .orderBy(desc(daydreamHypotheses.proposedAt))
          .limit(60)
      : Promise.resolve([]),
  ]);

  return {
    id: lead.id,
    title: lead.title,
    rationale: lead.rationale,
    status: lead.status,
    metrics,
    score: lead.score,
    scoreComponents: (lead.scoreComponents ?? {}) as Record<string, number>,
    roundsRun: lead.roundsRun,
    barrenRounds: lead.barrenRounds,
    abandonAfterBarrenRounds: lead.abandonAfterBarrenRounds,
    hypothesesSpawned: lead.hypothesesSpawned,
    hypothesesHeld: lead.hypothesesHeld,
    fromSteer: lead.steerId != null,
    createdAt: lead.createdAt.toISOString(),
    lastRoundAt: lead.lastRoundAt?.toISOString() ?? null,
    steps: steps.map((s) => ({
      round: s.round,
      kind: s.kind,
      note: s.note,
      detail: (s.detail ?? {}) as Record<string, unknown>,
      tokens: s.tokens,
      at: s.createdAt.toISOString(),
    })),
    questions: questions.map((q) => ({
      id: q.id,
      question: q.question,
      verdict: q.verdict,
      summary: q.summary,
      r: q.r,
      qValue: q.qValue,
      pairs: q.pairs,
      proposedAt: q.proposedAt.toISOString(),
      testedAt: q.testedAt?.toISOString() ?? null,
    })),
    tokens: steps.reduce((sum, s) => sum + s.tokens, 0),
    traceMissing: lead.roundsRun > 0 && steps.length === 0,
  };
}

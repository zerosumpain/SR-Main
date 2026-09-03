// src/lib/daydream/engine-proposals.ts
//
// Daydream proposes improvements to ITSELF, from its own statistics.
//
// Deterministic — no model writes any of this — and proposal-only: each is a
// backlog item of kind `engine`, which the toolsmith never picks and the
// proposer never turns into a PR. They sit on the ledger for the owner. The
// thresholds are the ones the review named (2026-09-02); each is a constant
// so it can be argued with.

import { and, desc, eq, gte, isNotNull, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamLeads, daydreamThoughts } from '$lib/db/schema';
import { DETECTORS } from './detectors';
import { loadDetectorRows } from './ledger';

export const SILENT_DETECTOR_DAYS = 30;
export const LOW_USEFUL_RATE = 0.3;
export const MIN_VOTES_FOR_RATE = 5;
export const ABANDONED_LEADS_SHARING = 2;
export const HIGH_UNCERTAIN_RATE = 0.4;
export const REVIEW_WINDOW_DAYS = 30;

export interface EngineProposal {
  title: string;
  detail: string;
  kind: 'engine';
  priority: number;
  evidence: string;
}

/** PURE: the thresholds applied to already-gathered numbers, so they are testable. */
export function proposeFrom(input: {
  now: Date;
  detectorLastFired: Map<string, Date | null>;
  detectorKinds: string[];
  kindVotes: Array<{ kind: string; useful: number; notUseful: number }>;
  abandonedMetricCounts: Array<{ metric: string; leads: number }>;
  review: { uncertain: number; total: number };
}): EngineProposal[] {
  const out: EngineProposal[] = [];
  const cutoff = input.now.getTime() - SILENT_DETECTOR_DAYS * 86_400_000;
  for (const kind of input.detectorKinds) {
    const last = input.detectorLastFired.get(kind) ?? null;
    if (last && last.getTime() >= cutoff) continue;
    out.push({
      title: `Detector ${kind} has been silent for ${SILENT_DETECTOR_DAYS} days`,
      detail: `${kind} has produced no thought since ${last ? last.toISOString().slice(0, 10) : 'it shipped'}. Either its readiness gate never opens (check what it is waiting for on the Engine room) or the pattern it looks for does not occur in this household. Consider loosening the gate, widening its inputs, or retiring it.`,
      kind: 'engine',
      priority: 3,
      evidence: `no daydream_thoughts row of kind ${kind} in ${SILENT_DETECTOR_DAYS} days`,
    });
  }
  for (const v of input.kindVotes) {
    const votes = v.useful + v.notUseful;
    if (votes < MIN_VOTES_FOR_RATE) continue;
    const rate = v.useful / votes;
    if (rate >= LOW_USEFUL_RATE) continue;
    out.push({
      title: `Kind ${v.kind} is rated useful only ${Math.round(rate * 100)}% of the time`,
      detail: `${v.useful} useful against ${v.notUseful} not useful over ${votes} verdicts. The kind weight already pushes it down; a rate this low over this many votes says the detector is measuring the wrong thing. Consider a stricter minimum-support gate, a different evidence source, or routing the kind to the briefing.`,
      kind: 'engine',
      priority: 2,
      evidence: `${v.useful}/${votes} useful`,
    });
  }
  for (const a of input.abandonedMetricCounts) {
    if (a.leads < ABANDONED_LEADS_SHARING) continue;
    out.push({
      title: `Every lead about ${a.metric} has died barren`,
      detail: `${a.leads} lines of enquiry naming ${a.metric} were abandoned after their barren rounds. Either the series is too thin to test or the questions it invites are unanswerable with what is stored. Consider a source that writes ${a.metric} daily, or removing it from the proposer's menu.`,
      kind: 'engine',
      priority: 2,
      evidence: `${a.leads} abandoned leads share metric ${a.metric}`,
    });
  }
  if (input.review.total >= MIN_VOTES_FOR_RATE) {
    const rate = input.review.uncertain / input.review.total;
    if (rate > HIGH_UNCERTAIN_RATE) {
      out.push({
        title: `The reviewer cannot tell ${Math.round(rate * 100)}% of the time`,
        detail: `${input.review.uncertain} of ${input.review.total} verdicts in ${REVIEW_WINDOW_DAYS} days were uncertain (retrieval failures excluded — those are faults). A reviewer that mostly cannot tell is either asked claims the sources cannot settle or is missing a reader. Consider tightening what reaches review, or giving it the reader the faults ask for.`,
        kind: 'engine',
        priority: 2,
        evidence: `${input.review.uncertain}/${input.review.total} uncertain`,
      });
    }
  }
  return out;
}

export async function engineProposals(now = new Date()): Promise<EngineProposal[]> {
  const since = new Date(now.getTime() - REVIEW_WINDOW_DAYS * 86_400_000);
  const [lastByKind, detectors, abandoned, review] = await Promise.all([
    db
      .select({ kind: daydreamThoughts.kind, last: sql<Date | null>`max(${daydreamThoughts.createdAt})` })
      .from(daydreamThoughts)
      .groupBy(daydreamThoughts.kind),
    loadDetectorRows(),
    db
      .select({ metrics: daydreamLeads.metrics })
      .from(daydreamLeads)
      .where(eq(daydreamLeads.status, 'abandoned')),
    db
      .select({
        uncertain: sql<number>`count(*) filter (where ${daydreamThoughts.reviewVerdict} = 'uncertain' and coalesce(${daydreamThoughts.suppressedReason}, '') <> 'needs_source')::int`,
        total: sql<number>`count(*)::int`,
      })
      .from(daydreamThoughts)
      .where(and(isNotNull(daydreamThoughts.reviewAt), gte(daydreamThoughts.reviewAt, since))),
  ]);
  const detectorLastFired = new Map<string, Date | null>();
  for (const r of lastByKind) detectorLastFired.set(r.kind, r.last ? new Date(r.last) : null);
  const metricCounts = new Map<string, number>();
  for (const a of abandoned) for (const m of (a.metrics ?? []) as string[]) metricCounts.set(m, (metricCounts.get(m) ?? 0) + 1);
  return proposeFrom({
    now,
    detectorLastFired,
    detectorKinds: DETECTORS.map((d) => d.kind),
    kindVotes: detectors.map((d) => ({ kind: d.kind, useful: d.useful, notUseful: d.notUseful })),
    abandonedMetricCounts: [...metricCounts.entries()].map(([metric, leads]) => ({ metric, leads })).sort((a, b) => b.leads - a.leads),
    review: { uncertain: review[0]?.uncertain ?? 0, total: review[0]?.total ?? 0 },
  }).sort((a, b) => a.priority - b.priority);
}

// `desc` is imported for callers that extend the sorts; keep the import honest.
void desc;

// Detectors the model wrote.
//
// One Detector in the registry that stands for all the active model-authored
// rules. It behaves exactly like a hand-written one — same Candidate shape,
// same dedupe discipline, same scoring pipeline, same delivery limits — because
// the point of the expression language is that a model-authored rule is not a
// special case downstream. Everything after this file treats them identically.
//
// The `kind` on the candidates is the RULE's kind, not this detector's, so
// per-kind weights, cooldowns and `never this kind` all work per rule rather
// than muting every model-authored rule at once. That distinction matters: one
// bad rule should not silence the mechanism.

import { evaluateRule, renderTemplate } from '../rules/evaluate';
import { extractFacts, subjectPlaceLabel } from '../rules/facts';
import type { RuleSpec } from '../rules/spec';
import {
  notReady,
  ready,
  type Candidate,
  type DaydreamSnapshot,
  type Detector,
} from '../snapshot-types';

/**
 * Active rules for this tick.
 *
 * Set by the detect activity before the pass runs rather than fetched here,
 * because a Detector is a pure function over a snapshot and must stay one —
 * making this file reach for the database would put I/O inside the layer whose
 * whole value is that it has none.
 */
let activeRules: RuleSpec[] = [];

export function setActiveRules(rules: RuleSpec[]): void {
  activeRules = rules;
}

export function getActiveRules(): RuleSpec[] {
  return activeRules;
}

/** ISO week, so a `week` dedupe recurs weekly rather than daily. */
function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function dedupeKeyFor(
  spec: RuleSpec,
  snapshot: DaydreamSnapshot,
  placeId: string | null,
): string {
  switch (spec.dedupe) {
    case 'day':
      return `${spec.kind}:${snapshot.localDate}`;
    case 'week':
      return `${spec.kind}:${isoWeek(snapshot.now)}`;
    case 'place':
      return `${spec.kind}:${placeId ?? '_nowhere'}`;
    case 'place-day':
    default:
      return `${spec.kind}:${placeId ?? '_nowhere'}:${snapshot.localDate}`;
  }
}

export const ruleDriven: Detector = {
  kind: 'rule_driven',
  description:
    'Runs the rules the model proposed and you approved. Each fires under its own kind, so weights, cooldowns and muting work per rule.',

  readiness(s: DaydreamSnapshot) {
    if (activeRules.length === 0) {
      return notReady(0, 1, 'approved rules', 'no model-authored rule has been approved yet');
    }
    const eligible = activeRules.filter((r) => s.trailSpanDays >= r.minTrailDays).length;
    return eligible > 0
      ? ready(eligible, 1, 'approved rules in support')
      : notReady(
          0,
          1,
          'approved rules in support',
          `${activeRules.length} approved, none has enough trail yet`,
        );
  },

  detect(s: DaydreamSnapshot): Candidate[] {
    if (activeRules.length === 0) return [];

    const facts = extractFacts(s);
    const place = subjectPlaceLabel(s);
    const out: Candidate[] = [];

    for (const spec of activeRules) {
      // Each rule's own support gate, exactly as a hand-written detector has.
      if (s.trailSpanDays < spec.minTrailDays) continue;

      const outcome = evaluateRule(spec, facts);
      if (!outcome.fired) continue;

      out.push({
        kind: spec.kind,
        title: renderTemplate(spec.title, facts, place),
        explanation: renderTemplate(spec.explanation, facts, place),
        rawScore: outcome.score,
        components: outcome.components,
        // The evidence is the fact vector that fired it. A model-authored rule
        // has no richer evidence to offer, and claiming otherwise would let the
        // composer write about something nothing checked.
        evidence: [
          { kind: 'rule', id: spec.kind, note: spec.description },
          ...(place.id ? [{ kind: 'place', id: place.id, note: place.label ?? '' }] : []),
        ],
        placeId: place.id,
        dedupeKey: dedupeKeyFor(spec, s, place.id),
        proposedActions: [],
      });
    }

    // Bounded like every other detector. A pile of approved rules all firing at
    // once is still one tick's worth of attention.
    return out.sort((a, b) => b.rawScore - a.rawScore).slice(0, 3);
  },
};

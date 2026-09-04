// src/lib/daydream/thought-groups.ts
//
// How the feed is organised, and what a group is allowed to claim about itself.
//
// The feed was one flat list in reverse-chronological order, with each row
// wearing its raw `kind` slug — `unknown_place`, `musing_health`,
// `context_meets_health`. That is the engine's vocabulary, not a reader's, and
// at 45 thoughts across 8 kinds the list said nothing about what the engine
// spends its attention on.
//
// So: families (what sort of thing is this), likelihood bands (how sure was
// it), and per-group statistics computed from the ledger rather than asserted.
//
// PURE, and separate from the component, because the two things that must not
// drift are the family a kind belongs to and the arithmetic in a group header.
// A header that says "68% useful" over four votes is a lie of a specific and
// familiar kind, and the only defence is a function you can test.

export interface ThoughtFamily {
  id: string;
  label: string;
  /** One line on what produced this family, for the group header. */
  blurb: string;
}

export const FAMILIES: Record<string, ThoughtFamily> = {
  places: {
    id: 'places',
    label: 'Places',
    blurb: 'Somewhere you keep going that has no name yet. Naming one teaches every other detector.',
  },
  mail: {
    id: 'mail',
    label: 'Mail',
    blurb: 'Account security, money admin, official post — rules over the subject line and the sender, never a model.',
  },
  musings: {
    id: 'musings',
    label: 'Musings',
    blurb: 'Crossings the ponder engine found between domains. The model phrases these; every claim cites a card, or the whole musing is dropped.',
  },
  graph: {
    id: 'graph',
    label: 'Knowledge graph',
    blurb: "Findings bridged from the intel graph's own rule-based detectors.",
  },
  rules: {
    id: 'rules',
    label: 'Your rules',
    blurb: 'Rules the engine proposed and you approved. Facts are an allow-list of scalars; a rule can never reach a coordinate.',
  },
  build: {
    id: 'build',
    label: 'Build',
    blurb: 'What the site should be able to do and cannot. Proposed by the appetite scan against an inventory of what already exists; every one cites the evidence that produced it.',
  },
  patterns: {
    id: 'patterns',
    label: 'Patterns',
    blurb: 'Detectors over movement, health and the diary. Each one declares the history it needs and stays silent below it.',
  },
};

/**
 * Which family a kind belongs to.
 *
 * Prefix-matched rather than enumerated, because the kind space is open by
 * design — `musing_<theme>`, `mail_<category>` and `intel_<kind>` all grow
 * without anyone editing a list, and a family that had to be updated for each
 * new theme would silently drop them into "other".
 */
export function familyOf(kind: string): ThoughtFamily {
  if (kind.startsWith('musing_')) return FAMILIES.musings;
  if (kind.startsWith('mail_')) return FAMILIES.mail;
  if (kind.startsWith('intel_')) return FAMILIES.graph;
  if (kind.startsWith('capability_')) return FAMILIES.build;
  if (kind.startsWith('rule_') || kind === 'rule_driven') return FAMILIES.rules;
  // Both spellings: the detector was renamed in August and the old rows stayed.
  if (kind === 'unknown_place' || kind === 'unknown_frequent_place') return FAMILIES.places;
  return FAMILIES.patterns;
}

/**
 * The mono kicker a family wears on every line and cell.
 *
 * A MARK, not a colour. Colour on the hub is priority and is decided in one
 * place (`priority.ts`); a second colour axis for category would make every
 * card carry two hues and neither would be readable. Six short words in the
 * label face do the job the raw slug never did.
 */
export const FAMILY_MARK: Record<string, string> = {
  places: 'PLACE',
  mail: 'MAIL',
  musings: 'MUSE',
  graph: 'GRAPH',
  build: 'BUILD',
  rules: 'RULE',
  patterns: 'PATTERN',
};

export function familyMark(kind: string): string {
  return FAMILY_MARK[familyOf(kind).id] ?? 'PATTERN';
}

/** The order families appear down the feed matrix — by what a reader acts on
 *  first, not by count. Counts change hourly; a matrix whose rows reorder
 *  hourly cannot be learned. */
export const FAMILY_ORDER = ['musings', 'mail', 'places', 'graph', 'build', 'patterns', 'rules'] as const;

/**
 * The four states a thought can be in from the reader's side.
 *
 * The engine has nine statuses; a reader has four questions — did it reach
 * me, is it waiting on me, did the engine hold it back, or is it dealt with.
 * `actioned` files with `archived`: a place question already answered is not
 * waiting on anyone.
 */
export type FeedState = 'sent' | 'undecided' | 'held' | 'filed';

export const FEED_STATES: Array<{ id: FeedState; label: string; statuses: string[] }> = [
  { id: 'undecided', label: 'Undecided', statuses: ['new'] },
  { id: 'sent', label: 'Sent', statuses: ['delivered', 'seen'] },
  { id: 'held', label: 'Held', statuses: ['suppressed'] },
  { id: 'filed', label: 'Filed', statuses: ['archived', 'dismissed', 'actioned', 'snoozed', 'expired'] },
];

export function feedStateOf(status: string): FeedState {
  for (const s of FEED_STATES) if (s.statuses.includes(status)) return s.id;
  // An unknown status is the one a reader most needs to see, not the one to hide.
  return 'undecided';
}

export function statusesFor(state: FeedState): string[] {
  return FEED_STATES.find((s) => s.id === state)?.statuses ?? [];
}

/** A reader's name for a kind — the family, plus whatever the suffix said. */
export function kindLabel(kind: string): string {
  if (kind.startsWith('musing_')) return kind.slice(7).replace(/_/g, ' ');
  if (kind.startsWith('mail_')) return kind.slice(5).replace(/_/g, ' ');
  if (kind.startsWith('intel_')) return kind.slice(6).replace(/_/g, ' ');
  return kind.replace(/_/g, ' ');
}

export interface LikelihoodBand {
  id: 'strong' | 'likely' | 'marginal' | 'held';
  label: string;
  /** What the band means in terms of the threshold, for a tooltip. */
  meaning: string;
}

/**
 * How confident the engine was, RELATIVE TO ITS OWN BAR.
 *
 * Deliberately not fixed cut-offs on the raw score. The threshold is a moving
 * target — it opens at 0.75 and falls towards 0.45 as feedback accumulates —
 * so "0.7" means "held back" in a cold start and "comfortably through" later.
 * A band that ignored that would relabel every historical thought every time
 * the threshold moved.
 */
export function likelihoodBand(score: number, threshold: number): LikelihoodBand {
  const margin = score - threshold;
  if (margin < 0) {
    return { id: 'held', label: 'held back', meaning: `scored ${score.toFixed(2)}, below the ${threshold.toFixed(2)} bar` };
  }
  if (margin >= 0.15) {
    return { id: 'strong', label: 'strong', meaning: `${score.toFixed(2)}, well clear of the ${threshold.toFixed(2)} bar` };
  }
  if (margin >= 0.05) {
    return { id: 'likely', label: 'likely', meaning: `${score.toFixed(2)}, clear of the ${threshold.toFixed(2)} bar` };
  }
  return { id: 'marginal', label: 'marginal', meaning: `${score.toFixed(2)}, only just over the ${threshold.toFixed(2)} bar` };
}

/**
 * The SUBJECT a date-scoped key is about.
 *
 * `free_window:2026-09-04`, `pattern_break:<place>:2026-09-02` and
 * `mail:burst:security:2026-09-01` are one card a day by design — a filed
 * card must not swallow next week's event. But a feed that lists three
 * Thursdays as three rows is the same subject three times, so the feed rolls
 * rows up by this key and keeps the newest as the face. Keys with no date
 * segment are their own subject.
 */
export function subjectKey(dedupeKey: string): string {
  return dedupeKey.replace(/:(\d{4}-\d{2}-\d{2}|\d{4}-W\d{2})$/, '');
}

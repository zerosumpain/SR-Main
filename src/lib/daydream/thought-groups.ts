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


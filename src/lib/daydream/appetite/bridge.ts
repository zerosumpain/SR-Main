// src/lib/daydream/appetite/bridge.ts
//
// A capability lead, as an ordinary daydream thought.
//
// The same wire `intel-bridge.ts` is: the ledger is where ideas live, and a
// thought is how one of them asks for attention. Going through
// `persistCandidates` rather than inventing a second delivery path means a
// lead meets the identical threshold, kind weights, mutes, cooldowns, dedupe
// and route table as every location thought — so "the engine would like to
// build X" still has to clear "worth saying at all".
//
// The kind is `capability_<kind>`, which is what makes the feedback loop work.
// Weights are learned PER KIND, so rating the source proposals highly and the
// tool proposals poorly moves two different numbers, and the engine's appetite
// bends toward what the owner actually wanted. A single `capability` kind
// would have averaged that signal into nothing.
//
// PURE — no database, no clock. The row goes in, a candidate comes out.

import type { Candidate } from '../snapshot-types';
import { MIN_BRIDGE_SCORE, type CapabilityKind } from './spec';

export interface BridgeInput {
  slug: string;
  kind: CapabilityKind;
  title: string;
  need: string;
  value: string;
  consumer: string;
  cites: string[];
  score: number;
  components: Record<string, number>;
  recurrence: number;
}

/** What the lead is, said in three words, so a briefing line is readable
 *  without the card. Deterministic — this is not the model's phrasing. */
const LEAD_IN: Readonly<Record<CapabilityKind, string>> = {
  data_source: 'New source',
  news_source: 'New feed',
  watch: 'New watch',
  tool: 'New tool',
  feature: 'New feature',
};

export function capabilityToCandidate(row: BridgeInput): Candidate | null {
  const title = row.title.trim();
  const need = row.need.trim();
  const value = row.value.trim();
  if (!title || !need || !value) return null;
  if (row.score < MIN_BRIDGE_SCORE) return null;

  // Assembled from recorded fields, in a fixed order. `narrative.ts`'s rule:
  // a sentence nobody can trace back to a column is a sentence that will one
  // day be wrong and unfalsifiable.
  const explanation = [
    need,
    value,
    `Cited ${row.cites.length} line${row.cites.length === 1 ? '' : 's'} of evidence` +
      (row.recurrence > 1 ? `, and arrived at on ${row.recurrence} separate nights` : '') +
      '.',
  ].join(' ');

  return {
    kind: `capability_${row.kind}`,
    title: `${LEAD_IN[row.kind]}: ${title}`.slice(0, 200),
    explanation: explanation.slice(0, 1000),
    rawScore: Math.max(0, Math.min(1, row.score)),
    components: { ...row.components, recurrence: row.recurrence, cites: row.cites.length },
    evidence: [
      { kind: 'capability', id: row.slug, note: `${title} — for ${row.consumer}` },
      ...row.cites.slice(0, 6).map((c) => ({ kind: 'appetite', id: c })),
    ],
    // The ledger's identity, so tomorrow night's re-proposal updates the
    // standing thought instead of spawning a sibling.
    dedupeKey: `capability:${row.slug}`,
    proposedActions: [
      { kind: 'open', label: 'Open the appetite ledger', payload: '/jkai/daydreams/improvement#appetite' },
    ],
  };
}

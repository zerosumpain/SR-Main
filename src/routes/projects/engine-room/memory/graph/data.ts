// data.ts — the graph leaf's measurements, reshaped into chart rows.
//
// Every figure here is lifted from GRAPH_FACTS in ../../lib/memory, which states them as
// prose. Nothing is added: 40 / 1.7 / 0.25 seconds, eight of the top fifty, a rank
// correlation of 0.92 and the twenty-five-pair nightly cap all appear verbatim there.
// The prose cannot be parsed into numbers, so it is transcribed once, here, and imported.

import { GRAPH_FACTS } from '../../lib/memory';

/** Source rows, so a reader of this file can check the transcription. */
export const SRC_RANKING = GRAPH_FACTS[0];
export const SRC_CAP = GRAPH_FACTS[1];
export const SRC_STALE = GRAPH_FACTS[2];

export type Verdict = 'past' | 'shipped' | 'rejected';

export interface Approach {
  id: string;
  label: string;
  /** Seconds to compute the ranking. */
  secs: number;
  /** How many of the top N changed place against the exact answer. */
  moved: number;
  /** Rank correlation with the exact answer; null where the answer is the exact one. */
  corr: number | null;
  verdict: string;
  state: Verdict;
  /** Shown on hover/focus. */
  how: string;
}

/** The size of the ranking the fidelity loss was measured over. */
export const TOP_N = 50;

export const APPROACHES: Approach[] = [
  {
    id: 'stored',
    label: 'Exact, as stored',
    secs: 40,
    moved: 0,
    corr: null,
    verdict: 'Replaced',
    state: 'past',
    how: 'The exact ranking, over the original data structure.',
  },
  {
    id: 'relaid',
    label: 'Exact, relaid',
    secs: 1.7,
    moved: 0,
    corr: null,
    verdict: 'Shipped, cached for a minute',
    state: 'shipped',
    how: 'Same algorithm, same answer bit for bit. Only the data layout changed.',
  },
  {
    id: 'sampled',
    label: 'Sampled',
    secs: 0.25,
    moved: 8,
    corr: 0.92,
    verdict: 'Rejected',
    state: 'rejected',
    how: 'An approximation. Fastest of the three, and the only one that answers differently.',
  },
];

/** The most pairs the nightly pass may merge. A cap on damage, not on throughput. */
export const NIGHTLY_CAP = 25;

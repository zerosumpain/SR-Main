// The Codegraph surfaces, ordered by where they sit in the loop.
//
// Same shape as the Intel workbench next door, deliberately: two graphs with
// two different nav idioms would be two things to learn. Ordered by stage, not
// by how often each is used, so the row reads as a sequence.
//
// The loop here is: what the graph holds → what it served → what should be
// forgotten. That last stage is the one Intel does not have and this one needs,
// because a code memory goes stale in a way a memory about people does not:
// the file it describes gets deleted.

export interface CodegraphCounts {
  nodes: number;
  lessons: number;
  episodes: number;
  verified: number;
  stale: number;
  retired: number;
  servesLast7d: number;
  emptyLast7d: number;
}

export interface CodegraphSurface {
  href: string;
  label: string;
  stage: string;
  /** The question this surface answers. One sentence, no hedging. */
  question: string;
  /** When to reach for it INSTEAD of the neighbouring surface. */
  ratherThan: string;
  count?: keyof CodegraphCounts;
  /** A count above this reads as a backlog rather than a statistic. */
  warnAbove?: number;
}

export const SURFACES: CodegraphSurface[] = [
  {
    href: '/jkai/codegraph',
    label: 'Map',
    stage: '01 explore',
    question: 'The ER map — which files carry history, and what changes alongside what.',
    ratherThan:
      'Go here to see the SHAPE of the graph. Ask is for getting an answer out of it; this is for seeing what is in it.',
    count: 'nodes',
  },
  {
    href: '/jkai/codegraph/ask',
    label: 'Ask',
    stage: '02 query',
    question: 'Run CGQL by hand and see exactly what a build would be handed.',
    ratherThan:
      'Use this to check what a query returns BEFORE trusting it in a build. The map shows structure; this shows the served text.',
  },
  {
    href: '/jkai/codegraph/review',
    label: 'Review',
    stage: '03 review + forget',
    question: 'Read what the graph holds, and retire whatever no longer applies.',
    ratherThan:
      'Both reading and forgetting live here on purpose: you decide to retire a thing while you are looking at it, not on a separate screen.',
    count: 'stale',
    warnAbove: 25,
  },
  {
    href: '/jkai/codegraph/relevance',
    label: 'Relevance',
    stage: '04 rank',
    question: 'What would be pulled into the next build, and why that order?',
    ratherThan:
      'Serves is what DID happen. This is what WOULD happen, and which term of the score decided it — the only place a bad ranking is visible before builds get worse.',
  },
  {
    href: '/jkai/codegraph/serves',
    label: 'Serves',
    stage: '05 measure',
    question: 'Every retrieval, including the ones that found nothing — is this actually being used?',
    ratherThan:
      'The honest usage record. Nothing else here can tell you whether the graph is earning its place.',
    count: 'servesLast7d',
  },
];

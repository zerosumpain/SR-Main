// The Intel surfaces, ordered by where they sit in the loop.
//
// Deliberately NOT ordered by how often each is used: the nav renders this
// array left-to-right, and a row reading 04, 04, 02, 03, 05, 01 tells you
// nothing about sequence. Stage order is what makes it legible as a loop.
//
// In a plain .ts module rather than the component so the landing page can render
// the same definitions as a full explainer without importing the nav — and so
// the wording of "what is this FOR" lives in exactly one place. Changing a
// question here changes it in both the nav and the landing loop.

export interface IntelCounts {
  entities: number;
  notes: number;
  pending: number;
  alerts: number;
  dossiers: number;
  events: number;
  watched: number;
  unconnected: number;
}

export interface IntelSurface {
  href: string;
  label: string;
  /** Where it sits in the loop — the thing that was missing entirely. */
  stage: string;
  /** The question this surface answers. One sentence, no hedging. */
  question: string;
  /** When to reach for it INSTEAD of the neighbouring surface. */
  ratherThan: string;
  count?: keyof IntelCounts;
  /** A count above this reads as a backlog rather than a statistic. */
  warnAbove?: number;
}

export const SURFACES: IntelSurface[] = [
  {
    href: '/jkai/intel/notes',
    label: 'Notes',
    stage: '01 capture',
    question: 'The raw sources everything else was read from — and where new ones are added.',
    ratherThan:
      'Go here to add knowledge or to check what a claim was actually based on. Deleting a note removes the intel that only it supported.',
    count: 'notes',
  },
  {
    href: '/jkai/intel/review',
    label: 'Triage',
    stage: '02 triage',
    question: 'Confirm or reject what extraction guessed, one keystroke at a time.',
    ratherThan:
      'About INDIVIDUAL entities: is this real, and is it what it says it is? Quality is about the graph as a whole.',
    count: 'pending',
    warnAbove: 40,
  },
  {
    href: '/jkai/intel/quality',
    label: 'Quality',
    stage: '03 repair',
    question: 'Repair the graph itself — duplicates, a sprawling taxonomy, fragments that never join up.',
    ratherThan:
      'Structural problems that corrupt every metric downstream. Triage judges one entity; this judges the shape of the whole.',
    count: 'unconnected',
    warnAbove: 60,
  },
  {
    href: '/jkai/intel',
    label: 'Graph',
    stage: '04 explore',
    question: 'What is connected to what — and what stands out that you did not ask about?',
    ratherThan:
      'Start here. Use Entities instead when you already know the name you are looking for.',
  },
  {
    href: '/jkai/intel/entities',
    label: 'Entities',
    stage: '04 explore',
    question: 'Find, sort, filter and bulk-edit the things the graph knows about.',
    ratherThan:
      'The list view of the same data as the Graph. Use it to ACT on many things at once; use the Graph to see how they relate.',
    count: 'entities',
  },
  {
    href: '/jkai/intel/timeline',
    label: 'Timeline',
    stage: '04 explore',
    question: 'What happened when — and who was active inside a given window?',
    ratherThan:
      'Use it when the question has a WHEN in it. Brushing a window filters the graph beside it, which is the part a list of dates cannot do.',
    count: 'events',
  },
  {
    href: '/jkai/intel/search',
    label: 'Recall',
    stage: '04 explore',
    question: 'Search every source by meaning rather than by keyword.',
    ratherThan:
      'Use it when you remember the idea but not the words. The Graph answers structure; this answers text.',
  },
  {
    href: '/jkai/intel/dossiers',
    label: 'Dossiers',
    stage: '05 collect',
    question: 'What are you working on? A case file holding the working set for one line of enquiry.',
    ratherThan:
      'The graph is everything you know; a dossier is the handful of it that matters this month, with your own questions attached.',
    count: 'dossiers',
  },
  {
    href: '/jkai/intel/alerts',
    label: 'Alerts',
    stage: '06 act',
    question: 'What the graph decided was worth telling you, unprompted.',
    ratherThan: 'Findings that came looking for you, rather than ones you went looking for.',
    count: 'alerts',
  },
];

/** The loop, in order, for the landing-page explainer. */
export const STAGES = ['01 capture', '02 triage', '03 repair', '04 explore', '05 collect', '06 act'];

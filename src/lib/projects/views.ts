// The /projects index read three ways, the way the landing page reads its live
// numbers: as a sentence, as a place, or as notes. This is the contract every
// view takes (identically), plus the pure helpers that turn the page's cards
// into it. No DOM and no Svelte runtime, so views.test.ts can pin the rules.
//
// The choice itself is the landing page's: the same three words, the same
// `sr_hero_view` cookie (Path=/), the same default ($lib/landing/hero-view).
// A visitor who reads the home page as a place walks into a town of projects.

import type { Snippet } from 'svelte';

/** One hand-built or agent-built card, as data (the list itself is src/routes/projects/cards.ts). */
export interface ProjectCard {
  /** Visibility key. Must match the key the server reports for this project. */
  key: string;
  href: string;
  /** Accessible name for the card's full-bleed link. */
  label: string;
  /** The accent eyebrow — `Field Study №6`, `Tool`, `Reference`. */
  kind: string;
  /** The muted counterpart on the line below the eyebrow. */
  tag: string;
  title: string;
  blurb: string;
  /** The mono strip along the foot of the card. */
  chips: string;
  /**
   * A finished product rather than a study or a toy — the card is marked in ink
   * instead of accent so it reads as a different KIND of thing at a glance, not
   * as a more important one. Each view marks it in its own way.
   */
  product?: true;
  /**
   * Hidden from the public outright: no visibility key, no public/private
   * toggle and no Share button, because there is no state in which this card
   * should be seen by anyone but the owner. Cards carrying it live in
   * `./owner-cards.server.ts` and are NOT in PROJECT_CARDS — see the note
   * there for why the visibility toggle is the wrong instrument for them.
   */
  ownerOnly?: true;
  /**
   * `href` leaves the site for a service that runs elsewhere (on the tailnet),
   * so the card has no /projects page of its own. Owner-only cards only:
   * `owner-cards.test.ts` holds every other card to its /projects address.
   */
  external?: true;
}

/** What kind of thing a card is, read off its eyebrow. */
export type ProjectFamily = 'study' | 'game' | 'tool' | 'agent';

/** One project on the index, in whichever view: a card plus what the page knows about it. */
export interface ProjectEntry extends ProjectCard {
  /** Built by hand (the curated cards) or by an agent from one prompt. */
  section: 'hand' | 'agent';
  family: ProjectFamily;
  /** The owner's view only: false marks a card the public cannot see. Always true for the public. */
  isPublic: boolean;
  /** 1-based position on the page, hand-built first: footnote numbers, plot numbers, line numbers. */
  n: number;
}

export interface ProjectCounts {
  /** Everything on the index for this viewer. */
  bench: number;
  studies: number;
  games: number;
  tools: number;
  agent: number;
  /** Cards the owner can see that the public cannot (0 for the public). */
  hidden: number;
}

/** The props every /projects view takes, identically. */
export interface ProjectsViewProps {
  hand: ProjectEntry[];
  agent: ProjectEntry[];
  /** Whether to draw the agent-built section at all (it has entries, or the owner is looking). */
  showAgent: boolean;
  counts: ProjectCounts;
  /** The owner is looking: private chips, toggles, Share and Remove are in play. */
  owner: boolean;
  /** "Sun 11 Oct", the owner's day, for a dateline or a date stamp. */
  dateline: string;
  /**
   * The owner's controls for one entry (visibility, Share, Remove). Renders
   * nothing for the public. A view places it in each entry's foot, ABOVE the
   * entry's full-bleed link (position: relative; z-index: 1 or more), and may
   * recolour it through `--pc-ctl-ink`, `--pc-ctl-line`, `--pc-ctl-hot`.
   */
  controls: Snippet<[ProjectEntry]>;
  /**
   * The "read it as: sentence · place · notes" switch. A view renders it once,
   * in its top band, and colours it through `--pvs-dim` (the label and dots),
   * `--pvs-ink` (the words) and `--pvs-on` (the chosen word).
   */
  switcher: Snippet;
}

/** The family a card belongs to, from its eyebrow (`Field Study №6`, `Game`, `Tool`…). */
export function familyOf(kind: string, section: ProjectEntry['section']): ProjectFamily {
  if (section === 'agent') return 'agent';
  if (/field\s*study/i.test(kind)) return 'study';
  if (/game|simulation/i.test(kind)) return 'game';
  return 'tool';
}

/** The page's cards as entries, numbered in reading order. */
export function toEntries(
  hand: ProjectCard[],
  agent: ProjectCard[],
  isPublic: (key: string) => boolean,
): { hand: ProjectEntry[]; agent: ProjectEntry[] } {
  let n = 0;
  const entry = (c: ProjectCard, section: ProjectEntry['section']): ProjectEntry => ({
    ...c,
    section,
    family: familyOf(c.kind, section),
    // An owner-only card has no visibility key; it is hidden from the public by construction.
    isPublic: c.ownerOnly ? false : isPublic(c.key),
    n: ++n,
  });
  return { hand: hand.map((c) => entry(c, 'hand')), agent: agent.map((c) => entry(c, 'agent')) };
}

export function countEntries(hand: ProjectEntry[], agent: ProjectEntry[]): ProjectCounts {
  const all = [...hand, ...agent];
  const of = (f: ProjectFamily) => all.filter((e) => e.family === f).length;
  return {
    bench: all.length,
    studies: of('study'),
    games: of('game'),
    tools: of('tool'),
    agent: agent.length,
    hidden: all.filter((e) => !e.isPublic).length,
  };
}

const SMALL = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

/** A count said the way prose says it: words to twelve, figures after. */
export function sayCount(n: number): string {
  return n >= 0 && n < SMALL.length ? SMALL[n] : String(n);
}

/** `one game` / `three games` / `no tools`. Irregular plurals pass their own. */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${sayCount(n)} ${n === 1 ? one : many}`;
}
